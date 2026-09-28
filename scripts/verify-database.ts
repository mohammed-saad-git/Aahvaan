/**
 * P1 database + Realtime verification.
 *
 *   npm run verify:db
 *
 * Proves, against the real project, that:
 *   1. the database is reachable;
 *   2. the demo seed exists;
 *   3. queue entries are queryable;
 *   4. queue ordering is correct (staff priority first, then arrival);
 *   5. priority entries are identifiable;
 *   6. illegal status transitions are rejected by the database;
 *   7. "Call Next" is atomic under concurrency;
 *   8. a patient-style Realtime subscription actually RECEIVES a queue_entries
 *      change event — not merely "SUBSCRIBED".
 *
 * Exits 0 when everything passes, 1 when a check fails, 2 when credentials are
 * missing. The test mutates two demo entries and restores them via the single
 * allowed requeue (CALLED -> WAITING), so it is safe to re-run.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { QueueEntryRow } from "../lib/database.types.ts";

/* ------------------------------------------------------------------ helpers */

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

/**
 * Renders a Supabase URL with the project ref redacted, so verification output
 * never contains a credential value.
 */
function maskedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.hostname.split(".");
    const domain = parts.length > 1 ? parts.slice(1).join(".") : parts[0];
    return `${parsed.protocol}//<project-ref>.${domain}`;
  } catch {
    return "<unparseable-url>";
  }
}

/** PostgREST may return a composite function result as an object or single-row array. */
function firstRow(data: unknown): QueueEntryRow | null {
  if (Array.isArray(data)) {
    return (data[0] as QueueEntryRow | undefined) ?? null;
  }
  if (data && typeof data === "object") {
    return data as QueueEntryRow;
  }
  return null;
}

/* ------------------------------------------------------------------- config */

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CLINIC_ID = "22222222-2222-4222-8222-222222222222";
const GENERAL_OPD_ID = "33333333-3333-4333-8333-000000000001";
const DOCTOR_ID = "44444444-4444-4444-8444-000000000001";

const COMPLETED_ENTRY_ID = "55555555-5555-4555-8555-000000000001";
const PRIORITY_ENTRY_ID = "55555555-5555-4555-8555-000000000006";

/** Today's General OPD waiting order: priority token 006 first, then arrival. */
const EXPECTED_WAITING_TOKEN_ORDER = [6, 3, 4, 5, 7];

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

const SUPABASE_URL = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const PUBLISHABLE_KEY = readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SECRET_KEY = readEnv("SUPABASE_SECRET_KEY");

function createClients(): { admin: SupabaseClient; anon: SupabaseClient } {
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  } as const;

  return {
    admin: createClient(SUPABASE_URL, SECRET_KEY, options),
    anon: createClient(SUPABASE_URL, PUBLISHABLE_KEY, options),
  };
}

/**
 * Resolves "today" from the database rather than the local machine clock: the
 * seed writes token_date using the database's current_date, and the two can
 * disagree around midnight when the client and the project sit in different
 * time zones.
 */
async function resolveSeedDate(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin
    .from("queue_entries")
    .select("token_date")
    .eq("department_id", GENERAL_OPD_ID)
    .order("token_date", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  const row = (data?.[0] ?? null) as { token_date: string } | null;
  if (!row) {
    throw new Error(
      "no General OPD queue entries found — apply supabase/seed.sql",
    );
  }

  return row.token_date;
}

async function main(): Promise<number> {
  console.log("\nQueueCare — P1 database + Realtime verification\n");

  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) {
    console.log("  BLOCKED — Supabase credentials are not configured.\n");
    console.log("  Missing from the environment:");
    if (!SUPABASE_URL) {
      console.log("    - NEXT_PUBLIC_SUPABASE_URL");
    }
    if (!PUBLISHABLE_KEY) {
      console.log("    - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    }
    if (!SECRET_KEY) {
      console.log("    - SUPABASE_SECRET_KEY");
    }
    console.log(
      "\n  Fill these into .env.local (gitignored), then re-run `npm run verify:db`.",
    );
    console.log(
      "  NOTHING was verified: without credentials the database is unreachable,",
    );
    console.log("  so schema, RPCs, RLS and Realtime all remain unproven.\n");
    return 2;
  }

  const { admin, anon } = createClients();
  console.log(`  Target: ${maskedUrl(SUPABASE_URL)}\n`);

  let seedDate = "";

  await check("Database connectivity", async () => {
    // A real GET. A HEAD request returned no body, which hid "table does not
    // exist" errors and made this check pass against an empty schema.
    const { error } = await admin.from("organizations").select("id").limit(1);

    if (!error) {
      return "connected; organizations is readable with the secret key";
    }

    const code = (error as { code?: string }).code;
    const message = error.message.toLowerCase();
    const authFailure =
      code === "401" ||
      message.includes("invalid api key") ||
      message.includes("jwt") ||
      message.includes("unauthorized");

    if (authFailure) {
      throw new Error(`credentials rejected: ${error.message}`);
    }

    // A schema-level error still proves the request reached PostgREST AND
    // authenticated — connectivity is real, the schema just is not applied yet.
    return `connected and authenticated (PostgREST replied: ${error.message})`;
  });

  await check("Required tables exist and are queryable", async () => {
    const tables = [
      "organizations",
      "clinics",
      "departments",
      "patients",
      "staff_users",
      "queue_entries",
      "consultations",
    ] as const;

    const unreadable: string[] = [];

    for (const table of tables) {
      // Real GET, not HEAD: HEAD responses suppressed the error and made this
      // check report success against a completely empty schema.
      const { error } = await admin.from(table).select("*").limit(1);

      if (error) {
        unreadable.push(`${table}: ${error.message}`);
      }
    }

    if (unreadable.length > 0) {
      throw new Error(
        `missing or unreadable tables — apply supabase/migrations/0001_init.sql: ${unreadable.join("; ")}`,
      );
    }

    return `all 7 tables present: ${tables.join(", ")}`;
  });

  await check("Seed data exists", async () => {
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("name")
      .eq("id", ORGANIZATION_ID)
      .maybeSingle();

    if (orgError) {
      throw new Error(orgError.message);
    }
    if (!org) {
      throw new Error(
        "CityCare Health Network not found — apply supabase/seed.sql",
      );
    }

    const { data: departments, error: departmentError } = await admin
      .from("departments")
      .select("name")
      .eq("clinic_id", CLINIC_ID);

    if (departmentError) {
      throw new Error(departmentError.message);
    }

    const names = (departments ?? [])
      .map((row) => String((row as { name: string }).name))
      .sort();

    if (names.length !== 5) {
      throw new Error(
        `expected 5 departments, found ${names.length}: ${names.join(", ")}`,
      );
    }

    return `${(org as { name: string }).name}; departments: ${names.join(", ")}`;
  });

  await check("Queue entries are queryable", async () => {
    seedDate = await resolveSeedDate(admin);

    const { data, error } = await admin
      .from("queue_entries")
      .select("token_number, status")
      .eq("department_id", GENERAL_OPD_ID)
      .eq("token_date", seedDate);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data ?? []) as Array<{ token_number: number; status: string }>;
    if (rows.length !== 8) {
      throw new Error(
        `expected 8 General OPD entries for ${seedDate}, found ${rows.length}`,
      );
    }

    const statuses = [...new Set(rows.map((row) => row.status))].sort();
    return `8 General OPD entries for ${seedDate}; statuses present: ${statuses.join(", ")}`;
  });

  await check("Queue ordering is correct (priority first, then arrival)", async () => {
    const { data, error } = await admin
      .from("queue_entries")
      .select("token_number")
      .eq("department_id", GENERAL_OPD_ID)
      .eq("token_date", seedDate)
      .eq("status", "WAITING")
      .order("priority", { ascending: false })
      .order("joined_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    const tokens = (data ?? []).map(
      (row) => (row as { token_number: number }).token_number,
    );

    const expected = EXPECTED_WAITING_TOKEN_ORDER.join(", ");
    const actual = tokens.join(", ");

    if (actual !== expected) {
      throw new Error(`expected waiting order [${expected}], got [${actual}]`);
    }

    return `waiting order is [${actual}] — priority token 006 first, then arrival order`;
  });

  await check("Priority queue behavior", async () => {
    const { data, error } = await admin
      .from("queue_entries")
      .select("token_number, priority, priority_reason")
      .eq("id", PRIORITY_ENTRY_ID)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    if (!data) {
      throw new Error(`priority entry ${PRIORITY_ENTRY_ID} not found`);
    }

    const row = data as {
      token_number: number;
      priority: boolean;
      priority_reason: string | null;
    };

    if (row.priority !== true) {
      throw new Error(`token ${row.token_number} is not flagged priority`);
    }
    if (!row.priority_reason) {
      throw new Error(`token ${row.token_number} has no priority_reason`);
    }

    return `token ${row.token_number} has priority=true with a recorded reason`;
  });

  await check("Valid status transitions are accepted", async () => {
    // Walks the entire legal happy path on a temporary patient, created through
    // join_queue so that RPC is exercised too. Everything is deleted afterwards
    // so the seeded demo data — and the ETA window — stay exactly as shipped.
    const joined = await admin.rpc("join_queue", {
      p_department_id: GENERAL_OPD_ID,
      p_display_name: "Verification Patient (auto-cleanup)",
      p_phone: null,
      p_preferred_language: "en",
    });

    if (joined.error) {
      throw new Error(`join_queue failed: ${joined.error.message}`);
    }

    const created = firstRow(joined.data);
    if (!created) {
      throw new Error("join_queue returned no queue entry");
    }

    const applyAction = async (
      action: string,
      expectedStatus: string,
    ): Promise<QueueEntryRow> => {
      const result = await admin.rpc("transition_queue_entry", {
        p_queue_entry_id: created.id,
        p_action: action,
      });

      if (result.error) {
        throw new Error(
          `legal action ${action} was rejected: ${result.error.message}`,
        );
      }

      const row = firstRow(result.data);
      if (!row) {
        throw new Error(`${action} returned no queue entry`);
      }
      if (row.status !== expectedStatus) {
        throw new Error(
          `${action} produced ${row.status}, expected ${expectedStatus}`,
        );
      }

      return row;
    };

    const steps: string[] = [];

    try {
      if (created.status !== "WAITING") {
        throw new Error(
          `expected WAITING immediately after joining, got ${created.status}`,
        );
      }
      steps.push(`join -> WAITING (token ${created.token_number})`);

      const calledRow = await applyAction("CALL", "CALLED");
      if (!calledRow.called_at) {
        throw new Error("CALLED transition did not set called_at");
      }
      steps.push("CALL -> CALLED (called_at set)");

      const startedRow = await applyAction(
        "START_CONSULTATION",
        "IN_CONSULTATION",
      );
      if (!startedRow.consultation_started_at) {
        throw new Error("START_CONSULTATION did not set consultation_started_at");
      }

      const { data: openConsultation, error: openError } = await admin
        .from("consultations")
        .select("ended_at")
        .eq("queue_entry_id", created.id)
        .maybeSingle();

      if (openError) {
        throw new Error(openError.message);
      }
      if (!openConsultation) {
        throw new Error(
          "START_CONSULTATION did not create a consultations audit row",
        );
      }
      steps.push("START_CONSULTATION -> IN_CONSULTATION (audit row opened)");

      const completedRow = await applyAction("COMPLETE", "COMPLETED");
      if (!completedRow.completed_at) {
        throw new Error("COMPLETE transition did not set completed_at");
      }

      const { data: closedConsultation, error: closedError } = await admin
        .from("consultations")
        .select("ended_at")
        .eq("queue_entry_id", created.id)
        .maybeSingle();

      if (closedError) {
        throw new Error(closedError.message);
      }
      if (!(closedConsultation as { ended_at: string | null } | null)?.ended_at) {
        throw new Error(
          "COMPLETE did not close the consultation (ended_at still null)",
        );
      }
      steps.push("COMPLETE -> COMPLETED (completed_at set, audit row closed)");

      return steps.join(" | ");
    } finally {
      await admin.from("consultations").delete().eq("queue_entry_id", created.id);
      await admin.from("queue_entries").delete().eq("id", created.id);
      await admin.from("patients").delete().eq("id", created.patient_id);
    }
  });

  await check("Invalid state transitions are rejected", async () => {
    // Token 003 is the first non-priority waiting patient in the demo data.
    const waitingEntryId = "55555555-5555-4555-8555-000000000003";
    const rejected: string[] = [];

    // (a) COMPLETED is terminal: it cannot be called again.
    const callCompleted = await admin.rpc("transition_queue_entry", {
      p_queue_entry_id: COMPLETED_ENTRY_ID,
      p_action: "CALL",
    });
    if (callCompleted.error) {
      rejected.push(`COMPLETED -> CALLED via RPC rejected`);
    }

    // (b) A waiting patient cannot be completed without being seen first.
    const completeWaiting = await admin.rpc("transition_queue_entry", {
      p_queue_entry_id: waitingEntryId,
      p_action: "COMPLETE",
    });
    if (completeWaiting.error) {
      rejected.push(`WAITING -> COMPLETED via RPC rejected`);
    }

    // (c) The trigger must block illegal states even for a privileged writer
    //     that bypasses the RPC entirely.
    const rawUpdate = await admin
      .from("queue_entries")
      .update({ status: "WAITING" })
      .eq("id", COMPLETED_ENTRY_ID);
    if (rawUpdate.error) {
      rejected.push(`COMPLETED -> WAITING via raw privileged UPDATE rejected`);
    }

    // Confirm nothing actually changed.
    const { data: after, error: readError } = await admin
      .from("queue_entries")
      .select("status")
      .eq("id", COMPLETED_ENTRY_ID)
      .maybeSingle();

    if (readError) {
      throw new Error(readError.message);
    }
    if ((after as { status: string } | null)?.status !== "COMPLETED") {
      throw new Error(
        "the completed entry was mutated despite the guard — data integrity is broken",
      );
    }

    if (rejected.length !== 3) {
      throw new Error(
        `only ${rejected.length} of 3 illegal writes were rejected: ${rejected.join("; ") || "none"}`,
      );
    }

    return rejected.join("; ");
  });

  await check("call_next_queue_entry is atomic under concurrency", async () => {
    const [first, second] = await Promise.all([
      admin.rpc("call_next_queue_entry", {
        p_department_id: GENERAL_OPD_ID,
        p_staff_user_id: DOCTOR_ID,
      }),
      admin.rpc("call_next_queue_entry", {
        p_department_id: GENERAL_OPD_ID,
        p_staff_user_id: DOCTOR_ID,
      }),
    ]);

    if (first.error) {
      throw new Error(`first concurrent call failed: ${first.error.message}`);
    }
    if (second.error) {
      throw new Error(`second concurrent call failed: ${second.error.message}`);
    }

    const a = firstRow(first.data);
    const b = firstRow(second.data);

    try {
      if (!a || !b) {
        throw new Error(
          `expected two different entries, got ${a ? `token ${a.token_number}` : "null"} and ${b ? `token ${b.token_number}` : "null"}`,
        );
      }

      if (a.id === b.id) {
        throw new Error(
          `both concurrent calls returned the SAME entry (token ${a.token_number}) — Call Next is not atomic`,
        );
      }

      if (a.status !== "CALLED" || b.status !== "CALLED") {
        throw new Error(
          `expected both entries to be CALLED, got ${a.status} and ${b.status}`,
        );
      }

      // Together they must be the priority token (006) and the next arrival
      // (003): proves ordering is honoured inside the atomic advance.
      const tokens = [a.token_number, b.token_number].sort((x, y) => x - y);
      if (tokens[0] !== 3 || tokens[1] !== 6) {
        throw new Error(
          `expected the priority token 6 and the next arrival token 3, got [${tokens.join(", ")}]`,
        );
      }

      return `two simultaneous Call Next calls returned token ${tokens[0]} and token ${tokens[1]} — no patient was called twice`;
    } finally {
      // Restore both entries via the single allowed requeue (CALLED -> WAITING).
      for (const entry of [a, b]) {
        if (entry?.id) {
          await admin.rpc("transition_queue_entry", {
            p_queue_entry_id: entry.id,
            p_action: "REQUEUE",
          });
        }
      }
    }
  });

  await check(
    "Realtime delivers a queue_entries change to a patient-style subscriber",
    async () => {
      const received: Array<{ eventType: string; id: string; status: string }> =
        [];
      const channel = anon.channel(`verify-queue-${Date.now()}`);

      // IMPORTANT: handlers must be registered BEFORE subscribe(), otherwise the
      // channel joins and the listener is never bound.
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
            received.push({
              eventType: payload.eventType,
              id: row.id,
              status: row.status,
            });
          }
        },
      );

      try {
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
          15_000,
          "Realtime never reported SUBSCRIBED within 15s (check the project URL and the publishable key)",
        );

        // Give the server a moment to finish registering the subscription before
        // mutating, so this measures delivery rather than a race.
        await sleep(1_000);

        // The staff action, performed exactly as the app will: privileged client,
        // through the RPC. The anon subscriber must observe it.
        const call = await admin.rpc("call_next_queue_entry", {
          p_department_id: GENERAL_OPD_ID,
          p_staff_user_id: DOCTOR_ID,
        });

        if (call.error) {
          throw new Error(`staff Call Next failed: ${call.error.message}`);
        }

        const called = firstRow(call.data);
        if (!called) {
          throw new Error(
            "Call Next returned no entry, so Realtime could not be exercised",
          );
        }

        const event = await waitFor(
          () => received.find((entry) => entry.id === called.id),
          15_000,
        );

        if (!event) {
          throw new Error(
            `SUBSCRIBED, but no queue_entries event arrived within 15s for token ${called.token_number}. ` +
              "Realtime is NOT working. Check all three: the table is in the supabase_realtime publication, " +
              "anon has a table-level SELECT grant, and an RLS policy lets anon read the row.",
          );
        }

        // Restore the demo state via the single allowed requeue.
        await admin.rpc("transition_queue_entry", {
          p_queue_entry_id: called.id,
          p_action: "REQUEUE",
        });

        return `received ${event.eventType} for token ${called.token_number} (status ${event.status}) on an anon/publishable-key subscription`;
      } finally {
        await anon.removeChannel(channel);
      }
    },
  );

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
    console.log("\n  P1 is NOT verified.\n");
    return 1;
  }

  console.log(
    "\n  P1 verified: schema, integrity, RPCs, atomic Call Next, ordering and Realtime.\n",
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




