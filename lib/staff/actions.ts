"use server";

/**
 * Staff queue mutations.
 *
 * The dashboard never writes to the database directly. Every action here runs on
 * the server with the privileged client and calls the verified RPCs:
 *   - `call_next_queue_entry`  for "Call next" (atomic, FOR UPDATE SKIP LOCKED)
 *   - `transition_queue_entry` for Call / Start / Complete / No-show / Requeue
 *
 * The database's state machine (and its trigger) remains the authority: an
 * illegal move raises and is turned into a human sentence, never a raw error.
 */

import { QUEUE_ACTION_TARGET, type QueueAction } from "../queue/status.ts";
import { createPrivilegedSupabaseClient } from "../supabase/server.ts";
import { isUuid } from "../validation.ts";

export interface StaffActionResult {
  ok: boolean;
  /** The affected token, or null when nobody was waiting. */
  tokenNumber?: number | null;
  message?: string;
}

export interface CallNextInput {
  departmentId: string;
  roomLabel?: string;
}

export interface StaffTransitionInput {
  entryId: string;
  action: string;
  roomLabel?: string;
}

const ALLOWED_ACTIONS = Object.keys(QUEUE_ACTION_TARGET) as QueueAction[];
const MAX_ROOM_LABEL_LENGTH = 40;

function readRoomLabel(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";

  if (raw.length === 0) {
    return null;
  }

  return raw.slice(0, MAX_ROOM_LABEL_LENGTH);
}

function firstRow(data: unknown): { token_number: number } | null {
  if (Array.isArray(data)) {
    return (data[0] as { token_number: number } | undefined) ?? null;
  }
  if (data && typeof data === "object") {
    return data as { token_number: number };
  }
  return null;
}

/** Maps database exceptions onto sentences a receptionist can act on. */
function toFriendlyMessage(rawMessage: string): string {
  const text = rawMessage.toLowerCase();

  if (text.includes("invalid_queue_transition")) {
    return "That patient's status already changed. The board has been refreshed.";
  }
  if (
    text.includes("queue_entry_not_found") ||
    text.includes("no_data_found")
  ) {
    return "That patient is no longer in this queue.";
  }
  if (text.includes("unknown_queue_action")) {
    return "That action is not available for this patient.";
  }

  return "Couldn't reach the queue just now. Please try again.";
}

/** Calls the next waiting patient atomically in the database. */
export async function callNextAction(
  input: CallNextInput,
): Promise<StaffActionResult> {
  const departmentId = input?.departmentId;

  if (!isUuid(departmentId)) {
    return { ok: false, message: "This department is not available." };
  }

  const supabase = createPrivilegedSupabaseClient();

  const { data, error } = await supabase.rpc("call_next_queue_entry", {
    p_department_id: departmentId,
    p_room_label: readRoomLabel(input?.roomLabel),
  });

  if (error) {
    console.error("[staff] callNextAction:", error.message);
    return { ok: false, message: toFriendlyMessage(error.message) };
  }

  const row = firstRow(data);

  if (!row) {
    // An empty queue is a normal outcome, not a failure.
    return { ok: true, tokenNumber: null, message: "No patients waiting." };
  }

  return { ok: true, tokenNumber: row.token_number };
}

/** Applies one staff action through the validated state machine. */
export async function staffTransitionAction(
  input: StaffTransitionInput,
): Promise<StaffActionResult> {
  const entryId = input?.entryId;

  if (!isUuid(entryId)) {
    return { ok: false, message: "That patient is no longer in this queue." };
  }

  const action =
    typeof input?.action === "string" ? (input.action as QueueAction) : null;

  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    return { ok: false, message: "That action is not available for this patient." };
  }

  const supabase = createPrivilegedSupabaseClient();

  const { data, error } = await supabase.rpc("transition_queue_entry", {
    p_queue_entry_id: entryId,
    p_action: action,
    p_room_label: readRoomLabel(input?.roomLabel),
  });

  if (error) {
    console.error("[staff] staffTransitionAction", action, error.message);
    return { ok: false, message: toFriendlyMessage(error.message) };
  }

  const row = firstRow(data);

  if (!row) {
    return { ok: false, message: "That patient is no longer in this queue." };
  }

  return { ok: true, tokenNumber: row.token_number };
}
