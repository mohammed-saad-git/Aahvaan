/**
 * Development helper for driving the queue.
 *
 * This is NOT a staff UI and it does not touch RLS: it calls exactly the same
 * secure RPCs (`call_next_queue_entry`, `transition_queue_entry`) with the
 * server-side secret key, from the command line. It exists so the patient
 * screen's Realtime behaviour can be demonstrated and tested before the staff
 * dashboard exists (P4).
 *
 *   npm run demo:advance
 *   npm run demo:advance -- --department <uuid>
 *   npm run demo:advance -- --action start    --entry <uuid>
 *   npm run demo:advance -- --action complete --entry <uuid>
 *   npm run demo:advance -- --action no-show  --entry <uuid>
 *   npm run demo:advance -- --action requeue  --entry <uuid>
 *   npm run demo:advance -- --room "Room 3"
 */

import { createPrivilegedSupabaseClient } from "../lib/supabase/server.ts";

/** Seeded General OPD department: a convenience default for demos only. */
const DEFAULT_DEPARTMENT_ID = "33333333-3333-4333-8333-000000000001";

/** Friendly CLI names mapped to the action vocabulary the RPC accepts. */
const ACTION_ALIASES: Readonly<Record<string, string>> = {
  call: "CALL",
  start: "START_CONSULTATION",
  "start-consultation": "START_CONSULTATION",
  complete: "COMPLETE",
  "no-show": "NO_SHOW",
  noshow: "NO_SHOW",
  requeue: "REQUEUE",
};

interface Args {
  departmentId: string;
  action: string;
  entryId: string | null;
  roomLabel: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const [key, inlineValue] = token.slice(2).split("=", 2);
      const value = inlineValue ?? argv[index + 1] ?? "";
      flags.set(key, value);
      if (inlineValue === undefined) {
        index += 1;
      }
    }
  }

  return {
    departmentId: flags.get("department") ?? DEFAULT_DEPARTMENT_ID,
    action: flags.get("action") ?? "call-next",
    entryId: flags.get("entry") ?? null,
    roomLabel: flags.get("room") ?? null,
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const supabase = createPrivilegedSupabaseClient();

  console.log(`\nAction: ${args.action}`);
  console.log(`Department: ${args.departmentId}\n`);

  if (args.action === "call-next") {
    const { data, error } = await supabase.rpc("call_next_queue_entry", {
      p_department_id: args.departmentId,
      p_room_label: args.roomLabel,
    });

    if (error) {
      console.error(`call_next_queue_entry failed: ${error.message}`);
      return 1;
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { token_number: number; status: string }
      | null;

    console.log(
      row
        ? `Called token ${row.token_number} (status ${row.status})`
        : "Nobody is waiting — call next returned null.",
    );
  } else {
    if (!args.entryId) {
      console.error(
        `--entry <uuid> is required for action "${args.action}" (see the table below for ids).`,
      );
    } else {
      const action = ACTION_ALIASES[args.action.toLowerCase()];

      if (!action) {
        console.error(
          `Unknown action "${args.action}". Use one of: ${Object.keys(ACTION_ALIASES).join(", ")}`,
        );
        return 1;
      }

      const { data, error } = await supabase.rpc("transition_queue_entry", {
        p_queue_entry_id: args.entryId,
        p_action: action,
        p_room_label: args.roomLabel,
      });

      if (error) {
        console.error(`${args.action} failed: ${error.message}`);
        return 1;
      }

      const row = (Array.isArray(data) ? data[0] : data) as
        | { token_number: number; status: string }
        | null;
      console.log(
        row ? `Token ${row.token_number} is now ${row.status}` : "No row returned.",
      );
    }
  }

  // Resolve "today" from the database rather than the local clock, so this never
  // shows an empty table when the machine and the project sit in different
  // time zones.
  const { data: latest } = await supabase
    .from("queue_entries")
    .select("token_date")
    .eq("department_id", args.departmentId)
    .order("token_date", { ascending: false })
    .limit(1);

  const queueDate =
    (latest?.[0] as { token_date: string } | undefined)?.token_date ?? null;

  const { data: queue, error: queueError } = await supabase
    .from("queue_entries")
    .select("id, token_number, status, priority, room_label, joined_at")
    .eq("department_id", args.departmentId)
    .eq("token_date", queueDate ?? "1900-01-01")
    .order("priority", { ascending: false })
    .order("joined_at", { ascending: true });

  if (queueError) {
    console.error(`Could not read the queue: ${queueError.message}`);
    return 1;
  }

  console.log("\nCurrent queue:");
  for (const row of queue ?? []) {
    const entry = row as {
      id: string;
      token_number: number;
      status: string;
      priority: boolean;
      room_label: string | null;
    };
    console.log(
      `  token ${String(entry.token_number).padStart(3, "0")}  ${entry.status.padEnd(16)}${entry.priority ? " PRIORITY" : "         "}  ${entry.room_label ?? ""}  ${entry.id}`,
    );
  }

  console.log("");
  return 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error("\ndemo:advance crashed:", error);
    process.exit(1);
  });
