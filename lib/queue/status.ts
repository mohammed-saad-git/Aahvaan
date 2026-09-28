/**
 * Queue state machine.
 *
 * This module is the single source of truth for which queue transitions are
 * legal. It is mirrored exactly by `public.is_queue_transition_allowed()` and
 * by the `enforce_queue_transition` trigger in
 * `supabase/migrations/0001_init.sql`, so the rule holds no matter which
 * client, script or SQL session touches the data.
 *
 * Everything here is pure and dependency-free so it can be unit tested without
 * a database, a browser or a React renderer.
 *
 * Design note: the system NEVER infers priority or diagnoses a patient. This
 * module only validates workflow moves an operator explicitly requested.
 */

import type { QueueStatus } from "../types";

/** All statuses, in lifecycle order. These values are the DB enum values too. */
export const QUEUE_STATUSES = [
  "WAITING",
  "CALLED",
  "IN_CONSULTATION",
  "COMPLETED",
  "NO_SHOW",
] as const satisfies readonly QueueStatus[];

/** Statuses that mean "still somewhere in the active queue". */
export const ACTIVE_QUEUE_STATUSES = [
  "WAITING",
  "CALLED",
  "IN_CONSULTATION",
] as const satisfies readonly QueueStatus[];

/**
 * Statuses with no outgoing transitions. Nothing may leave these states.
 */
export const TERMINAL_QUEUE_STATUSES = [
  "COMPLETED",
  "NO_SHOW",
] as const satisfies readonly QueueStatus[];

/** Human-readable label for a status, shared by the patient and staff UIs. */
export const QUEUE_STATUS_LABELS: Readonly<Record<QueueStatus, string>> = {
  WAITING: "Waiting",
  CALLED: "Called",
  IN_CONSULTATION: "In consultation",
  COMPLETED: "Completed",
  NO_SHOW: "No show",
};

/**
 * The queue workflow:
 *
 *   WAITING         -> CALLED | NO_SHOW
 *   CALLED          -> WAITING | IN_CONSULTATION | NO_SHOW
 *   IN_CONSULTATION -> COMPLETED
 *   COMPLETED       -> (terminal)
 *   NO_SHOW         -> (terminal)
 *
 * `CALLED -> WAITING` is the ONLY requeue operation: a patient who was called
 * but did not turn up is put back into the waiting queue. There is deliberately
 * no path out of IN_CONSULTATION, COMPLETED or NO_SHOW.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<QueueStatus, readonly QueueStatus[]>
> = {
  WAITING: ["CALLED", "NO_SHOW"],
  CALLED: ["WAITING", "IN_CONSULTATION", "NO_SHOW"],
  IN_CONSULTATION: ["COMPLETED"],
  COMPLETED: [],
  NO_SHOW: [],
};

/**
 * The single requeue edge — the only way a patient re-enters the queue after
 * leaving the WAITING state.
 */
export const REQUEUE_TRANSITION = {
  from: "CALLED",
  to: "WAITING",
} as const satisfies { from: QueueStatus; to: QueueStatus };

const STATUS_SET: ReadonlySet<string> = new Set<string>(QUEUE_STATUSES);
const ACTIVE_STATUS_SET: ReadonlySet<string> = new Set<string>(
  ACTIVE_QUEUE_STATUSES,
);
const TERMINAL_STATUS_SET: ReadonlySet<string> = new Set<string>(
  TERMINAL_QUEUE_STATUSES,
);

/** Type guard for values coming from the database, URLs or realtime payloads. */
export function isQueueStatus(value: unknown): value is QueueStatus {
  return typeof value === "string" && STATUS_SET.has(value);
}

/** True while the patient is still expected to be part of the live queue. */
export function isActiveStatus(status: QueueStatus): boolean {
  return ACTIVE_STATUS_SET.has(status);
}

/** True once the entry has left the active queue for good. */
export function isTerminalStatus(status: QueueStatus): boolean {
  return TERMINAL_STATUS_SET.has(status);
}

function baseTransitionsOf(status: QueueStatus): readonly QueueStatus[] {
  // Defensive: guards against unvalidated data reaching the state machine.
  return ALLOWED_TRANSITIONS[status] ?? [];
}

/**
 * Can the patient move from `from` to `to`?
 *
 * Returns false for no-op transitions (`from === to`) so repeated staff clicks
 * cannot silently re-timestamp a row.
 */
export function canTransition(from: QueueStatus, to: QueueStatus): boolean {
  if (from === to) {
    return false;
  }

  return baseTransitionsOf(from).includes(to);
}

/** Every legal destination from `status`. */
export function getAllowedTransitions(
  status: QueueStatus,
): readonly QueueStatus[] {
  return baseTransitionsOf(status);
}

/**
 * The staff-facing actions that drive the queue.
 *
 * Each action maps to exactly one target status, so the UI never sets a status
 * directly and the `transition_queue_entry` RPC re-validates the same mapping
 * server-side.
 */
export type QueueAction =
  | "CALL"
  | "START_CONSULTATION"
  | "COMPLETE"
  | "NO_SHOW"
  | "REQUEUE";

export const QUEUE_ACTION_TARGET: Readonly<Record<QueueAction, QueueStatus>> = {
  CALL: "CALLED",
  START_CONSULTATION: "IN_CONSULTATION",
  COMPLETE: "COMPLETED",
  NO_SHOW: "NO_SHOW",
  REQUEUE: REQUEUE_TRANSITION.to,
};

/** Actions an operator may perform on an entry right now. */
export function getAvailableActions(
  status: QueueStatus,
): readonly QueueAction[] {
  const actions: QueueAction[] = [];

  for (const action of Object.keys(QUEUE_ACTION_TARGET) as QueueAction[]) {
    if (canTransition(status, QUEUE_ACTION_TARGET[action])) {
      actions.push(action);
    }
  }

  return actions;
}

