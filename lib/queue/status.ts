/**
 * Queue state machine.
 *
 * This module is the single source of truth for which queue transitions are
 * legal. The Postgres `transition_queue_entry()` RPC (added in P1) must mirror
 * this table exactly, so that the rule is enforced no matter which client or
 * script touches the data.
 *
 * Everything here is pure and dependency-free so it can be unit tested without
 * a database, a browser or a React renderer.
 *
 * Design note: the system NEVER infers priority or diagnoses a patient. This
 * module only validates workflow moves an operator explicitly requested.
 */

import type { QueueStatus } from "../types";

/** All statuses, in lifecycle order. */
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

/** Human-readable label for a status, shared by the patient and staff UIs. */
export const QUEUE_STATUS_LABELS: Readonly<Record<QueueStatus, string>> = {
  WAITING: "Waiting",
  CALLED: "Called",
  IN_CONSULTATION: "In consultation",
  COMPLETED: "Completed",
  NO_SHOW: "No show",
};

/**
 * The normal forward workflow, without any requeue shortcuts:
 *
 *   WAITING         -> CALLED | NO_SHOW
 *   CALLED          -> IN_CONSULTATION | NO_SHOW
 *   IN_CONSULTATION -> COMPLETED
 *   COMPLETED       -> (terminal)
 *   NO_SHOW         -> (terminal)
 *
 * Escaping a terminal (or mid-flight) state is only possible through the
 * explicit `requeue` option — see `canTransition`.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<QueueStatus, readonly QueueStatus[]>
> = {
  WAITING: ["CALLED", "NO_SHOW"],
  CALLED: ["IN_CONSULTATION", "NO_SHOW"],
  IN_CONSULTATION: ["COMPLETED"],
  COMPLETED: [],
  NO_SHOW: [],
};

/** The status every explicit requeue returns a patient to. */
export const REQUEUE_STATUS: QueueStatus = "WAITING";

export interface TransitionOptions {
  /**
   * When true, the caller is performing a deliberate, operator-initiated
   * requeue (e.g. "I completed this by mistake", "this patient came back").
   * Only then may a patient re-enter the queue. Defaults to false.
   */
  requeue?: boolean;
}

const STATUS_SET: ReadonlySet<string> = new Set<string>(QUEUE_STATUSES);
const ACTIVE_STATUS_SET: ReadonlySet<string> = new Set<string>(
  ACTIVE_QUEUE_STATUSES,
);

/** Type guard for values coming from the database, URLs or realtime payloads. */
export function isQueueStatus(value: unknown): value is QueueStatus {
  return typeof value === "string" && STATUS_SET.has(value);
}

/** True while the patient is still expected to be part of the live queue. */
export function isActiveStatus(status: QueueStatus): boolean {
  return ACTIVE_STATUS_SET.has(status);
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
export function canTransition(
  from: QueueStatus,
  to: QueueStatus,
  options: TransitionOptions = {},
): boolean {
  if (from === to) {
    return false;
  }

  if (options.requeue === true && to === REQUEUE_STATUS) {
    // An explicit requeue may pull a patient back from any other status.
    return true;
  }

  return baseTransitionsOf(from).includes(to);
}

/**
 * Every legal destination from `status`.
 *
 * With `{ requeue: true }`, `WAITING` is included as an explicit escape hatch
 * (but never for a patient who is already waiting).
 */
export function getAllowedTransitions(
  status: QueueStatus,
  options: TransitionOptions = {},
): readonly QueueStatus[] {
  const base = baseTransitionsOf(status);

  if (options.requeue !== true || status === REQUEUE_STATUS) {
    return base;
  }

  return [...base, REQUEUE_STATUS];
}

/**
 * The staff-facing actions that drive the queue.
 *
 * Each action maps to exactly one target status, so the UI never sets a status
 * directly and the RPC layer can re-validate the same mapping server-side.
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
  REQUEUE: REQUEUE_STATUS,
};

/** Actions an operator may perform on an entry right now. */
export function getAvailableActions(status: QueueStatus): readonly QueueAction[] {
  const actions: QueueAction[] = [];

  for (const action of Object.keys(QUEUE_ACTION_TARGET) as QueueAction[]) {
    const target = QUEUE_ACTION_TARGET[action];
    const isRequeue = action === "REQUEUE";

    if (canTransition(status, target, { requeue: isRequeue })) {
      actions.push(action);
    }
  }

  return actions;
}
