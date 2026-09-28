import assert from "node:assert/strict";
import { test } from "node:test";

import type { QueueStatus } from "../types.ts";
import {
  ACTIVE_QUEUE_STATUSES,
  ALLOWED_TRANSITIONS,
  QUEUE_ACTION_TARGET,
  QUEUE_STATUSES,
  QUEUE_STATUS_LABELS,
  REQUEUE_TRANSITION,
  TERMINAL_QUEUE_STATUSES,
  canTransition,
  getAvailableActions,
  getAllowedTransitions,
  isActiveStatus,
  isQueueStatus,
  isTerminalStatus,
} from "./status.ts";

/**
 * The canonical transition table, as approved for P1.
 *
 * If this test fails, the state machine has changed and
 * `is_queue_transition_allowed()` plus the `enforce_queue_transition` trigger in
 * supabase/migrations/0001_init.sql MUST be updated to match — the application
 * and the database must never disagree about what is legal.
 */
const EXPECTED_ALLOWED: Record<QueueStatus, readonly QueueStatus[]> = {
  WAITING: ["CALLED", "NO_SHOW"],
  CALLED: ["WAITING", "IN_CONSULTATION", "NO_SHOW"],
  IN_CONSULTATION: ["COMPLETED"],
  COMPLETED: [],
  NO_SHOW: [],
};

test("accepts the documented forward workflow", () => {
  assert.equal(canTransition("WAITING", "CALLED"), true);
  assert.equal(canTransition("WAITING", "NO_SHOW"), true);
  assert.equal(canTransition("CALLED", "IN_CONSULTATION"), true);
  assert.equal(canTransition("CALLED", "NO_SHOW"), true);
  assert.equal(canTransition("IN_CONSULTATION", "COMPLETED"), true);
});

test("CALLED -> WAITING is the only requeue operation", () => {
  assert.equal(REQUEUE_TRANSITION.from, "CALLED");
  assert.equal(REQUEUE_TRANSITION.to, "WAITING");
  assert.equal(canTransition("CALLED", "WAITING"), true);

  // Every other route back into the waiting queue must be rejected.
  assert.equal(canTransition("IN_CONSULTATION", "WAITING"), false);
  assert.equal(canTransition("COMPLETED", "WAITING"), false);
  assert.equal(canTransition("NO_SHOW", "WAITING"), false);
});

test("rejects skipping stages and leaving terminal states", () => {
  // Cannot skip straight into a consultation or finish without being seen.
  assert.equal(canTransition("WAITING", "IN_CONSULTATION"), false);
  assert.equal(canTransition("WAITING", "COMPLETED"), false);
  assert.equal(canTransition("CALLED", "COMPLETED"), false);

  // Terminal states are absolute.
  assert.equal(canTransition("COMPLETED", "CALLED"), false);
  assert.equal(canTransition("COMPLETED", "IN_CONSULTATION"), false);
  assert.equal(canTransition("NO_SHOW", "CALLED"), false);
  assert.equal(canTransition("NO_SHOW", "IN_CONSULTATION"), false);
  assert.equal(canTransition("NO_SHOW", "COMPLETED"), false);

  // Backwards moves are not implied by the workflow.
  assert.equal(canTransition("IN_CONSULTATION", "CALLED"), false);
});

test("no status can transition to itself", () => {
  for (const status of QUEUE_STATUSES) {
    assert.equal(
      canTransition(status, status),
      false,
      `${status} -> ${status} must be rejected`,
    );
  }
});

test("terminal statuses expose no outgoing transitions", () => {
  assert.deepEqual(TERMINAL_QUEUE_STATUSES, ["COMPLETED", "NO_SHOW"]);

  for (const status of TERMINAL_QUEUE_STATUSES) {
    assert.equal(isTerminalStatus(status), true);
    assert.deepEqual(getAllowedTransitions(status), []);
    assert.deepEqual(getAvailableActions(status), []);

    for (const to of QUEUE_STATUSES) {
      assert.equal(
        canTransition(status, to),
        false,
        `${status} must not transition to ${to}`,
      );
    }
  }

  assert.equal(isTerminalStatus("WAITING"), false);
  assert.equal(isTerminalStatus("CALLED"), false);
  assert.equal(isTerminalStatus("IN_CONSULTATION"), false);
});

test("exhaustive: only the documented transition set is allowed", () => {
  for (const from of QUEUE_STATUSES) {
    for (const to of QUEUE_STATUSES) {
      const expected = from !== to && EXPECTED_ALLOWED[from].includes(to);
      assert.equal(
        canTransition(from, to),
        expected,
        `unexpected result for ${from} -> ${to}`,
      );
    }
  }
});

test("the exported table mirrors the canonical table", () => {
  assert.deepEqual(ALLOWED_TRANSITIONS, EXPECTED_ALLOWED);
});

test("getAllowedTransitions returns the canonical destinations", () => {
  assert.deepEqual(getAllowedTransitions("WAITING"), ["CALLED", "NO_SHOW"]);
  assert.deepEqual(getAllowedTransitions("CALLED"), [
    "WAITING",
    "IN_CONSULTATION",
    "NO_SHOW",
  ]);
  assert.deepEqual(getAllowedTransitions("IN_CONSULTATION"), ["COMPLETED"]);
  assert.deepEqual(getAllowedTransitions("COMPLETED"), []);
  assert.deepEqual(getAllowedTransitions("NO_SHOW"), []);

  // Every advertised transition must actually be accepted.
  for (const from of QUEUE_STATUSES) {
    for (const to of getAllowedTransitions(from)) {
      assert.equal(canTransition(from, to), true);
    }
  }
});

test("status guards and labels cover every status", () => {
  assert.equal(QUEUE_STATUSES.length, 5);
  assert.deepEqual(ACTIVE_QUEUE_STATUSES, [
    "WAITING",
    "CALLED",
    "IN_CONSULTATION",
  ]);

  for (const status of QUEUE_STATUSES) {
    assert.equal(isQueueStatus(status), true);
    assert.equal(typeof QUEUE_STATUS_LABELS[status], "string");
    assert.ok(QUEUE_STATUS_LABELS[status].length > 0);
  }

  assert.equal(isActiveStatus("WAITING"), true);
  assert.equal(isActiveStatus("CALLED"), true);
  assert.equal(isActiveStatus("IN_CONSULTATION"), true);
  assert.equal(isActiveStatus("COMPLETED"), false);
  assert.equal(isActiveStatus("NO_SHOW"), false);

  // Values arriving from the DB / realtime / URLs must be validated, not trusted.
  assert.equal(isQueueStatus("waiting"), false);
  assert.equal(isQueueStatus("SOMETHING_ELSE"), false);
  assert.equal(isQueueStatus(null), false);
  assert.equal(isQueueStatus(undefined), false);
  assert.equal(isQueueStatus(42), false);
});

test("getAvailableActions matches the state machine", () => {
  assert.deepEqual(getAvailableActions("WAITING"), ["CALL", "NO_SHOW"]);
  assert.deepEqual(getAvailableActions("CALLED"), [
    "START_CONSULTATION",
    "NO_SHOW",
    "REQUEUE",
  ]);
  assert.deepEqual(getAvailableActions("IN_CONSULTATION"), ["COMPLETE"]);
  assert.deepEqual(getAvailableActions("COMPLETED"), []);
  assert.deepEqual(getAvailableActions("NO_SHOW"), []);

  // Each action must resolve to a legal transition from that status, and the
  // REQUEUE action must be the single CALLED -> WAITING edge.
  assert.equal(QUEUE_ACTION_TARGET.REQUEUE, REQUEUE_TRANSITION.to);
  for (const status of QUEUE_STATUSES) {
    for (const action of getAvailableActions(status)) {
      assert.equal(canTransition(status, QUEUE_ACTION_TARGET[action]), true);
    }
  }
});

