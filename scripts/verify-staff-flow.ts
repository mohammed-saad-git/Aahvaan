/**
 * P4 verification: the staff board and the two-device demo chain.
 *
 *   npm run verify:staff
 *
 * Uses the REAL application code and the REAL secure RPCs:
 *   - `loadStaffDashboard()`            (the loader the board page calls)
 *   - `buildStaffDashboardView()`       (the view model the board renders)
 *   - `call_next_queue_entry` / `transition_queue_entry`  (what the staff
 *     server actions call — the browser never touches the database)
 *   - an anonymous Realtime subscription, exactly like the patient's browser
 *
 * It proves: staff action -> database -> Realtime -> patient's derived view, and
 * that the staff counters move with it. Everything it creates is removed again,
 * and any seeded entry it calls is requeued, so the demo data is left intact.
 *
 * Exits 0 on success, 1 on failure, 2 when credentials are missing.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { QueueEntryRow } from "../lib/database.types.ts";
import { loadPatientQueueSnapshot } from "../lib/patient/load.ts";
import {
  applyRealtimeQueueChange,
  buildPatientQueueView,
} from "../lib/patient/queue.ts";
import { loadStaffDashboard } from "../lib/staff/load.ts";
import { buildStaffDashboardView } from "../lib/staff/queue.ts";
import { createPrivilegedSupabaseClient } from "../lib/supabase/server.ts";

const GENERAL_OPD_ID = "33333333-3333-4333-8333-000000000001";
const SEEDED_CALLED_TOKEN = 8;
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

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) {
    return (data[0] as T | undefined) ?? null;
  }
  if (data && typeof data === "object") {
    return data as T;
  }
  return null;
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
  console.log("\nAahvaan — P4 staff board verification\n");

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

  // One throwaway entry, driven through the entire lifecycle and then deleted.
  const join = await admin.rpc("join_queue", {
    p_department_id: GENERAL_OPD_ID,
    p_display_name: "P4 Verification Patient (auto-cleanup)",
    p_phone: null,
    p_preferred_language: "en",
  });

  if (join.error) {
    console.error(`  BLOCKED — could not join the queue: ${join.error.message}\n`);
    return 1;
  }

  const testEntry = firstRow<QueueEntryRow>(join.data);
  if (!testEntry) {
    console.error("  BLOCKED — join_queue returned no entry\n");
    return 1;
  }

  console.log(
    `  Throwaway entry: token ${testEntry.token_number} (deleted at the end)\n`,
  );

  const events: QueueEntryRow[] = [];
  let realtimeChannel: ReturnType<typeof anon.channel> | null = null;
  let calledByStaff: string | null = null;

  try {
    let board: Awaited<ReturnType<typeof loadStaffDashboard>> = null;

    await check("Staff board loads the demo clinic context", async () => {
      board = await loadStaffDashboard(GENERAL_OPD_ID);

      if (!board) {
        throw new Error("loadStaffDashboard returned null");
      }
      if (board.clinic.name !== "CityCare Hospital") {
        throw new Error(`unexpected clinic: ${board.clinic.name}`);
      }
      if (board.selectedDepartment.name !== "General OPD") {
        throw new Error(`unexpected department: ${board.selectedDepartment.name}`);
      }
      if (board.departments.length !== 5) {
        throw new Error(`expected 5 departments, got ${board.departments.length}`);
      }
      if (board.usedFallbackDepartment) {
        throw new Error("the requested department should have been honoured");
      }

      const view = buildStaffDashboardView(board.entries);

      return `${board.clinic.name} / ${board.selectedDepartment.name}; ${board.entries.length} rows for ${board.tokenDate}; waiting=${view.stats.waiting} called=${view.stats.called} inConsultation=${view.stats.inConsultation} completed=${view.stats.completedToday}`;
    });

    await check("Waiting queue is in the exact order Call Next will follow", async () => {
      if (!board) {
        throw new Error("no board loaded");
      }

      const view = buildStaffDashboardView(board.entries);
      const first = view.waitingQueue[0];

      if (view.waitingQueue.length === 0) {
        throw new Error("expected waiting patients in the demo data");
      }
      if (!first?.priority) {
        throw new Error(
          `expected the priority patient first, got token ${first?.tokenNumber}`,
        );
      }

      for (let index = 1; index < view.waitingQueue.length; index += 1) {
        const previous = view.waitingQueue[index - 1];
        const current = view.waitingQueue[index];

        if (previous.priority === current.priority) {
          const previousJoined = Date.parse(previous.joinedAt);
          const currentJoined = Date.parse(current.joinedAt);

          if (previousJoined > currentJoined) {
            throw new Error(
              `arrival order broken between token ${previous.tokenNumber} and ${current.tokenNumber}`,
            );
          }
        }
      }

      const tokens = view.waitingQueue.map((entry) => entry.tokenNumber);

      return `order [${tokens.join(", ")}] with priority token ${first.tokenNumber} first`;
    });

    await check("Current patient is the called patient, with its room", async () => {
      if (!board) {
        throw new Error("no board loaded");
      }

      const view = buildStaffDashboardView(board.entries);
      const current = view.currentPatient;

      if (!current) {
        throw new Error("expected the called patient to be the current patient");
      }
      if (current.status !== "CALLED") {
        throw new Error(`expected CALLED, got ${current.status}`);
      }
      if (current.tokenNumber !== SEEDED_CALLED_TOKEN) {
        throw new Error(
          `expected token ${SEEDED_CALLED_TOKEN}, got ${current.tokenNumber}`,
        );
      }
      if (!current.roomLabel) {
        throw new Error("expected a room label on the called patient");
      }

      return `token ${current.tokenNumber} (${current.status}) in ${current.roomLabel}`;
    });
    await check("Call Next advances the queue and the patient is notified", async () => {
      // One subscription, created/bound/subscribed in a single synchronous chain.
      const channel = anon.channel(`staff-verify-${Date.now()}`);
      realtimeChannel = channel;

      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "queue_entries",
          filter: `department_id=eq.${GENERAL_OPD_ID}`,
        },
        (payload) => {
          const row = (payload.new ?? null) as QueueEntryRow | null;
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
                  `Realtime reported ${status}${err ? `: ${err.message}` : ""}`,
                ),
              );
            }
          });
        }),
        REALTIME_TIMEOUT_MS,
        "Realtime never reported SUBSCRIBED",
      );

      await sleep(1_000);

      const before = buildStaffDashboardView(
        (await loadStaffDashboard(GENERAL_OPD_ID))!.entries,
      );

      // Exactly what the dashboard's Call Next button does.
      const call = await admin.rpc("call_next_queue_entry", {
        p_department_id: GENERAL_OPD_ID,
        p_room_label: "Room 7",
      });

      if (call.error) {
        throw new Error(`call_next_queue_entry failed: ${call.error.message}`);
      }

      const called = firstRow<QueueEntryRow>(call.data);
      if (!called) {
        throw new Error("Call Next returned no entry");
      }
      calledByStaff = called.id;

      const event = await waitFor(
        () => events.find((item) => item.id === called.id),
        REALTIME_TIMEOUT_MS,
      );

      if (!event) {
        const seen = events.map(
          (item) => `${String(item.id).slice(0, 8)}:${item.status}`,
        );
        throw new Error(
          `no Realtime event arrived for the called patient (token ${called.token_number}, id=${String(called.id).slice(0, 8)}). Received ${events.length} event(s): ${seen.join(" | ") || "none"}`,
        );
      }

      // What the patient's phone shows, built from the received event with the
      // same functions the patient page uses.
      const patientSnapshot = await loadPatientQueueSnapshot(called.id);
      if (!patientSnapshot) {
        throw new Error("could not load the called patient's snapshot");
      }

      const patientView = buildPatientQueueView(
        applyRealtimeQueueChange(patientSnapshot, event),
      );

      if (patientView.status !== "CALLED") {
        throw new Error(`patient should be CALLED, got ${patientView.status}`);
      }
      if (patientView.headline !== "You're up next") {
        throw new Error(`unexpected patient headline: ${patientView.headline}`);
      }
      if (patientView.roomLabel !== "Room 7") {
        throw new Error(
          `patient should see Room 7, got ${patientView.roomLabel}`,
        );
      }

      const after = buildStaffDashboardView(
        (await loadStaffDashboard(GENERAL_OPD_ID))!.entries,
      );

      if (after.stats.waiting !== before.stats.waiting - 1) {
        throw new Error(
          `waiting should drop by one: ${before.stats.waiting} -> ${after.stats.waiting}`,
        );
      }
      if (after.stats.called !== before.stats.called + 1) {
        throw new Error(
          `called should rise by one: ${before.stats.called} -> ${after.stats.called}`,
        );
      }

      // Put the seeded entry back exactly where it was.
      const requeue = await admin.rpc("transition_queue_entry", {
        p_queue_entry_id: called.id,
        p_action: "REQUEUE",
      });
      if (requeue.error) {
        throw new Error(`requeue failed: ${requeue.error.message}`);
      }

      return `called token ${called.token_number} -> patient shows "${patientView.headline}" in ${patientView.roomLabel}; staff waiting ${before.stats.waiting}->${after.stats.waiting}, called ${before.stats.called}->${after.stats.called}`;
    });
    await check("Start and complete reach the patient and move the counters", async () => {
      const snapshotBefore = await loadPatientQueueSnapshot(testEntry.id);
      if (!snapshotBefore) {
        throw new Error("could not load the patient snapshot before the transition");
      }
      if (snapshotBefore.entry.status !== "WAITING") {
        throw new Error(
          `the throwaway entry should still be WAITING, got ${snapshotBefore.entry.status}`,
        );
      }

      const before = buildStaffDashboardView(
        (await loadStaffDashboard(GENERAL_OPD_ID))!.entries,
      );

      const call = await admin.rpc("transition_queue_entry", {
        p_queue_entry_id: testEntry.id,
        p_action: "CALL",
        p_room_label: "Room 9",
      });
      if (call.error) {
        throw new Error(`CALL failed: ${call.error.message}`);
      }

      const start = await admin.rpc("transition_queue_entry", {
        p_queue_entry_id: testEntry.id,
        p_action: "START_CONSULTATION",
      });
      if (start.error) {
        throw new Error(`START_CONSULTATION failed: ${start.error.message}`);
      }

      const complete = await admin.rpc("transition_queue_entry", {
        p_queue_entry_id: testEntry.id,
        p_action: "COMPLETE",
      });
      if (complete.error) {
        throw new Error(`COMPLETE failed: ${complete.error.message}`);
      }

      const completedEvent = await waitFor(
        () =>
          events.find(
            (item) => item.id === testEntry.id && item.status === "COMPLETED",
          ),
        REALTIME_TIMEOUT_MS,
      );

      if (!completedEvent) {
        throw new Error("no Realtime event arrived for the completed patient");
      }

      // Replay the patient's screen: the snapshot it loaded, then each event in
      // the order it arrived.
      const calledEvent = events.find(
        (item) => item.id === testEntry.id && item.status === "CALLED",
      );
      const startedEvent = events.find(
        (item) => item.id === testEntry.id && item.status === "IN_CONSULTATION",
      );

      if (!calledEvent || !startedEvent) {
        throw new Error(
          "the patient did not receive the called / in-consultation events",
        );
      }

      const afterCalled = applyRealtimeQueueChange(snapshotBefore, calledEvent);
      const afterStarted = applyRealtimeQueueChange(afterCalled, startedEvent);
      const afterCompleted = applyRealtimeQueueChange(
        afterStarted,
        completedEvent,
      );

      const calledView = buildPatientQueueView(afterCalled);
      const startedView = buildPatientQueueView(afterStarted);
      const completedView = buildPatientQueueView(afterCompleted);

      if (calledView.headline !== "You're up next") {
        throw new Error(`expected "You're up next", got "${calledView.headline}"`);
      }
      if (startedView.headline !== "You're with the doctor") {
        throw new Error(
          `expected "You're with the doctor", got "${startedView.headline}"`,
        );
      }
      if (completedView.headline !== "Visit completed") {
        throw new Error(
          `expected "Visit completed", got "${completedView.headline}"`,
        );
      }

      const after = buildStaffDashboardView(
        (await loadStaffDashboard(GENERAL_OPD_ID))!.entries,
      );

      if (after.stats.waiting !== before.stats.waiting - 1) {
        throw new Error(
          `waiting should drop by one: ${before.stats.waiting} -> ${after.stats.waiting}`,
        );
      }
      if (after.stats.completedToday !== before.stats.completedToday + 1) {
        throw new Error(
          `completed should rise by one: ${before.stats.completedToday} -> ${after.stats.completedToday}`,
        );
      }
      if (after.stats.inConsultation !== 0) {
        throw new Error(
          `no consultation should remain open, got ${after.stats.inConsultation}`,
        );
      }

      return `patient saw "${calledView.headline}" -> "${startedView.headline}" -> "${completedView.headline}"; waiting ${before.stats.waiting}->${after.stats.waiting}, completed ${before.stats.completedToday}->${after.stats.completedToday}`;
    });
  } finally {
    // Remove everything this run created, and restore any seeded entry the staff
    // action touched, so the demo data is exactly as seeded.
    if (calledByStaff && calledByStaff !== testEntry.id) {
      await admin.rpc("transition_queue_entry", {
        p_queue_entry_id: calledByStaff,
        p_action: "REQUEUE",
      });
    }

    await admin.from("consultations").delete().eq("queue_entry_id", testEntry.id);
    await admin.from("queue_entries").delete().eq("id", testEntry.id);
    await admin.from("patients").delete().eq("id", testEntry.patient_id);

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
    console.log("\n  P4 staff board is NOT verified.\n");
    return 1;
  }

  console.log(
    "\n  P4 verified: board -> staff action -> database -> Realtime -> patient view.\n",
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

