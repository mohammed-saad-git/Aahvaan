/**
 * P3 verification: the patient data path, end to end.
 *
 *   npm run verify:patient
 *
 * Uses the REAL application code, not a reimplementation:
 *   - `loadPatientQueueSnapshot()`  (the loader the queue page calls)
 *   - `applyRealtimeQueueChange()`  (the reducer the browser calls on an event)
 *   - `buildPatientQueueView()`     (the view model the screen renders)
 *
 * It joins a throwaway patient, subscribes to Realtime with the PUBLISHABLE key
 * exactly as the patient's browser does, performs a real staff action through the
 * secure RPC, then asserts the patient's derived view actually changed because of
 * the received event. Everything it creates is deleted afterwards.
 *
 * Exits 0 on success, 1 on failure, 2 when credentials are missing.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { QueueEntryRow } from "../lib/database.types.ts";
import { loadPatientQueueSnapshot } from "../lib/patient/load.ts";
import {
  applyRealtimeQueueChange,
  buildPatientQueueView,
  type PatientQueueSnapshot,
  type PatientQueueView,
} from "../lib/patient/queue.ts";
import { createPrivilegedSupabaseClient } from "../lib/supabase/server.ts";

const GENERAL_OPD_ID = "33333333-3333-4333-8333-000000000001";
const TEST_PATIENT_NAME = "P3 Verification Patient (auto-cleanup)";
const REALTIME_TIMEOUT_MS = 15_000;

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function check(
  name: string,
  run: () => Promise<string>,
): Promise<boolean> {
  try {
    const detail = await run();
    results.push({ name, ok: true, detail });
    console.log(`  PASS  ${name}\n        ${detail}`);
    return true;
  } catch (error) {
    results.push({ name, ok: false, detail: errorMessage(error) });
    console.log(`  FAIL  ${name}\n        ${errorMessage(error)}`);
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  get: () => T | undefined | null,
  ms: number,
): Promise<T | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = get();
    if (value) {
      return value;
    }
    await sleep(200);
  }
  return null;
}

function firstRow(data: unknown): QueueEntryRow | null {
  if (Array.isArray(data)) {
    return (data[0] as QueueEntryRow | undefined) ?? null;
  }
  if (data && typeof data === "object") {
    return data as QueueEntryRow;
  }
  return null;
}

function describe(view: PatientQueueView): string {
  return `status=${view.status} headline="${view.headline}" ahead=${view.peopleAhead} eta="${view.eta.label}"`;
}

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

const SUPABASE_URL = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const PUBLISHABLE_KEY = readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SECRET_KEY = readEnv("SUPABASE_SECRET_KEY");

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function main(): Promise<number> {
  console.log("\nQueueCare — P3 patient flow verification\n");

  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) {
    console.log(
      "  BLOCKED — Supabase credentials are not configured. See .env.local.\n",
    );
    return 2;
  }

  const admin = createPrivilegedSupabaseClient();
  const anon: SupabaseClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  async function createTestEntry(label: string): Promise<QueueEntryRow> {
    const { data, error } = await admin.rpc("join_queue", {
      p_department_id: GENERAL_OPD_ID,
      p_display_name: `${TEST_PATIENT_NAME} ${label}`,
      p_phone: null,
      p_preferred_language: "en",
    });

    if (error) {
      throw new Error(`join_queue failed: ${error.message}`);
    }

    const row = firstRow(data);
    if (!row) {
      throw new Error("join_queue returned no entry");
    }

    return row;
  }

  let entryA: QueueEntryRow;
  let entryB: QueueEntryRow;

  try {
    entryA = await createTestEntry("A");
    entryB = await createTestEntry("B");
  } catch (error) {
    console.error(`  BLOCKED — ${errorMessage(error)}\n`);
    return 1;
  }

  console.log(
    `  Throwaway entries: A=token ${entryA.token_number}, B=token ${entryB.token_number} (both deleted at the end)\n`,
  );

  let calledByStaff: string | null = null;
  let realtimeChannel: ReturnType<typeof anon.channel> | null = null;

  try {
    let snapshotB: PatientQueueSnapshot | null = null;

    await check("The queue page loader returns a complete snapshot", async () => {
      snapshotB = await loadPatientQueueSnapshot(entryB.id);

      if (!snapshotB) {
        throw new Error("loader returned null for a valid entry");
      }
      if (snapshotB.entry.id !== entryB.id) {
        throw new Error("snapshot describes the wrong entry");
      }
      if (snapshotB.clinicName !== "CityCare Hospital") {
        throw new Error(`unexpected clinic: ${snapshotB.clinicName}`);
      }
      if (snapshotB.departmentName !== "General OPD") {
        throw new Error(`unexpected department: ${snapshotB.departmentName}`);
      }
      if (!snapshotB.queue.some((item) => item.id === entryB.id)) {
        throw new Error("the patient's own entry is missing from the queue");
      }

      // Privacy: nothing that crosses to the browser may carry patient identity.
      const serialized = JSON.stringify(snapshotB.queue);
      for (const leak of ["patient_id", "phone", "display_name", "priority_reason"]) {
        if (serialized.includes(leak)) {
          throw new Error(`snapshot payload leaks "${leak}" to the browser`);
        }
      }

      return `clinic + department resolved; ${snapshotB.queue.length} active entries; payload carries no patient identity`;
    });

    await check("Position and ETA are derived from live queue data", async () => {
      if (!snapshotB) {
        throw new Error("no snapshot available");
      }

      const view = buildPatientQueueView(snapshotB);

      if (view.status !== "WAITING") {
        throw new Error(`expected a WAITING entry, got ${view.status}`);
      }
      if (view.peopleAhead < 1) {
        throw new Error(
          `expected patients ahead of the newest entry, got ${view.peopleAhead}`,
        );
      }
      if (!Number.isFinite(view.eta.minMinutes) || !Number.isFinite(view.eta.maxMinutes)) {
        throw new Error("ETA bounds are not finite numbers");
      }
      if (!/min|hr|No wait/.test(view.eta.label)) {
        throw new Error(`unexpected ETA label: ${view.eta.label}`);
      }

      return describe(view);
    });

    await check("Consultation history feeds the ETA instead of the fallback", async () => {
      if (!snapshotB) {
        throw new Error("no snapshot available");
      }
      if (snapshotB.recentConsultationMinutes.length === 0) {
        throw new Error(
          "no consultation history was loaded, so the ETA would silently use its fallback",
        );
      }

      const view = buildPatientQueueView(snapshotB);

      if (view.eta.usedFallback) {
        throw new Error("ETA fell back to the default despite history being present");
      }
      if (!Number.isFinite(view.eta.averageMinutes) || view.eta.averageMinutes <= 0) {
        throw new Error(`implausible average: ${view.eta.averageMinutes}`);
      }

      return `${snapshotB.recentConsultationMinutes.length} recent durations -> average ${view.eta.averageMinutes} min -> "${view.eta.label}"`;
    });
    await check("Realtime delivers a staff change and the position improves", async () => {
      if (!snapshotB) {
        throw new Error("no snapshot available");
      }

      // IMPORTANT: create, bind and subscribe in one synchronous chain. A channel
      // created and then subscribed much later can end up attached to an idle
      // socket that still reports SUBSCRIBED but never delivers events.
      const channel = anon.channel(`patient-flow-verify-${Date.now()}`);
      const events: QueueEntryRow[] = [];
      realtimeChannel = channel;

      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "queue_entries",
          filter: `department_id=eq.${GENERAL_OPD_ID}`,
        },
        (payload) => {
          const row = payload.new as QueueEntryRow | undefined;
          if (row) {
            events.push(row);
          }
        },
      );

      await withTimeout(
        new Promise<void>((resolve, reject) => {
          channel.subscribe((status, err) => {
            if (status === "SUBSCRIBED") {
              resolve();
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              reject(
                new Error(
                  `Realtime channel reported ${status}${err ? `: ${err.message}` : ""}`,
                ),
              );
            }
          });
        }),
        REALTIME_TIMEOUT_MS,
        "Realtime never reported SUBSCRIBED",
      );

      await sleep(1_000); // let the server finish registering the subscription

      const before = buildPatientQueueView(snapshotB);

      const call = await admin.rpc("call_next_queue_entry", {
        p_department_id: GENERAL_OPD_ID,
        p_room_label: "Room 9",
      });

      if (call.error) {
        throw new Error(`staff action failed: ${call.error.message}`);
      }

      const called = firstRow(call.data);
      if (!called) {
        throw new Error("Call Next returned no entry, so Realtime was not exercised");
      }
      calledByStaff = called.id;

      const event = await waitFor(
        () => events.find((item) => item.id === called.id),
        REALTIME_TIMEOUT_MS,
      );

      if (!event) {
        throw new Error(
          `SUBSCRIBED, but no queue_entries event arrived within ${REALTIME_TIMEOUT_MS / 1000}s for the staff change`,
        );
      }

      const after = buildPatientQueueView(
        applyRealtimeQueueChange(snapshotB, event),
      );

      if (called.id === snapshotB.entry.id) {
        // Nobody was ahead: this patient was the one called. Still a real update.
        if (after.status !== "CALLED") {
          throw new Error(`expected CALLED, got ${after.status}`);
        }
        if (after.headline !== "You're up next") {
          throw new Error(`unexpected headline: ${after.headline}`);
        }
      } else {
        if (after.peopleAhead !== before.peopleAhead - 1) {
          throw new Error(
            `expected people ahead to drop from ${before.peopleAhead} to ${before.peopleAhead - 1}, got ${after.peopleAhead}`,
          );
        }
        if (after.eta.label === before.eta.label) {
          throw new Error(`the ETA did not change (still "${before.eta.label}")`);
        }
      }

      return `event received for token ${called.token_number} (status ${event.status}) | before: ${describe(before)} | after: ${describe(after)}`;
    });

    await check("A staff action on this patient reaches their own view", async () => {
      const { data: current, error } = await admin
        .from("queue_entries")
        .select("status")
        .eq("id", entryA.id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      // Be robust: Call Next above may already have called this entry.
      const status = (current as { status: string } | null)?.status ?? "WAITING";
      const action = status === "WAITING" ? "CALL" : "START_CONSULTATION";
      const expectedStatus = status === "WAITING" ? "CALLED" : "IN_CONSULTATION";
      const expectedHeadline =
        status === "WAITING" ? "You're up next" : "You're with the doctor";

      const call = await admin.rpc("transition_queue_entry", {
        p_queue_entry_id: entryA.id,
        p_action: action,
        p_room_label: "Room 9",
      });

      if (call.error) {
        throw new Error(`${action} failed: ${call.error.message}`);
      }

      const row = firstRow(call.data);
      if (!row) {
        throw new Error("no row returned");
      }

      const ownSnapshot = await loadPatientQueueSnapshot(entryA.id);
      if (!ownSnapshot) {
        throw new Error("could not reload this patient's snapshot");
      }

      const view = buildPatientQueueView(
        applyRealtimeQueueChange(ownSnapshot, row),
      );

      if (view.status !== expectedStatus) {
        throw new Error(`expected ${expectedStatus}, got ${view.status}`);
      }
      if (view.headline !== expectedHeadline) {
        throw new Error(`unexpected headline: ${view.headline}`);
      }
      if (view.showEta) {
        throw new Error("this patient must not still be shown a wait estimate");
      }
      if (status === "WAITING" && view.roomLabel !== "Room 9") {
        throw new Error(`expected the room to be shown, got ${view.roomLabel}`);
      }

      return `${action} -> ${describe(view)} room=${view.roomLabel ?? "n/a"}`;
    });
  } finally {
    // Remove everything this script created, and put any seeded entry that
    // Call Next touched back into the queue.
    if (
      calledByStaff &&
      calledByStaff !== entryA.id &&
      calledByStaff !== entryB.id
    ) {
      await admin.rpc("transition_queue_entry", {
        p_queue_entry_id: calledByStaff,
        p_action: "REQUEUE",
      });
    }

    for (const entry of [entryA, entryB]) {
      await admin.from("consultations").delete().eq("queue_entry_id", entry.id);
      await admin.from("queue_entries").delete().eq("id", entry.id);
      await admin.from("patients").delete().eq("id", entry.patient_id);
    }

    if (realtimeChannel) {
      await anon.removeChannel(realtimeChannel);
    }
  }

  const failed = results.filter((result) => !result.ok);

  console.log("\n" + "-".repeat(72));
  console.log(
    `  ${results.length - failed.length}/${results.length} checks passed`,
  );

  if (failed.length > 0) {
    console.log("\n  FAILED:");
    for (const result of failed) {
      console.log(`   - ${result.name}\n     ${result.detail}`);
    }
    console.log("\n  P3 patient flow is NOT verified.\n");
    return 1;
  }

  console.log(
    "\n  P3 verified: join -> token -> position -> ETA -> live Realtime update.\n",
  );
  return 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error("\nverification crashed:", errorMessage(error), "\n");
    process.exit(1);
  });

