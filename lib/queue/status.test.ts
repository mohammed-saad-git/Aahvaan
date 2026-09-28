import assert from "node:assert/strict";
import { test } from "node:test";

import type { QueueStatus } from "../types.ts";
import {
  ACTIVE_QUEUE_STATUSES,
  ALLOWED_TRANSITIONS,
  QUEUE_ACTION_TARGET,
  QUEUE_STATUSES,
  QUEUE_STATUS_LABELS,
  canTransition,
  getAvailableActions,
  getAllowedTransitions,
  isActiveStatus,
  isQueueStatus,
} from "./status.ts";

/**
 * The canonical transition table. If this test fails, the state machine has
 * changed and the Postgres `transition_queue_entry()` RPC must be updated to
 * match — the two must never disagree.
 */
const EXPECTED_ALLOWED: Record<QueueStatus, readonly QueueStatus[]> = {
  WAITING: ["CALLED", "NO_SHOW"],
  CALLED: ["IN_CONSULTATION", "NO_SHOW"],
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

test("rejects skipping stages and leaving terminal states", () => {
  // Cannot skip straight into a consultation or finish without being seen.
  assert.equal(canTransition("WAITING", "IN_CONSULTATION"), false);
  assert.equal(canTransition("WAITING", "COMPLETED"), false);
  assert.equal(canTransition("CALLED", "COMPLETED"), false);

  // Terminal states stay terminal without an explicit requeue.
  assert.equal(canTransition("COMPLETED", "WAITING"), false);
  assert.equal(canTransition("COMPLETED", "CALLED"), false);
  assert.equal(canTransition("NO_SHOW", "WAITING"), false);
  assert.equal(canTransition("NO_SHOW", "CALLED"), false);
  assert.equal(canTransition("NO_SHOW", "COMPLETED"), false);

  // Backwards moves are not implied by the workflow.
  assert.equal(canTransition("IN_CONSULTATION", "CALLED"), false);
  assert.equal(canTransition("IN_CONSULTATION", "WAITING"), false);
  assert.equal(canTransition("CALLED", "WAITING"), false);
});

test("requires an explicit requeue to re-enter the queue", () => {
  assert.equal(canTransition("CALLED", "WAITING", { requeue: true }), true);
  assert.equal(canTransition("COMPLETED", "WAITING", { requeue: true }), true);
  assert.equal(canTransition("NO_SHOW", "WAITING", { requeue: true }), true);
  // Undoing an accidental "start consultation" is also an explicit requeue.
  assert.equal(
    canTransition("IN_CONSULTATION", "WAITING", { requeue: true }),
    true,
  );

  // A requeue still may not skip anywhere other than WAITING.
  assert.equal(canTransition("COMPLETED", "CALLED", { requeue: true }), false);
  assert.equal(
    canTransition("COMPLETED", "IN_CONSULTATION", { requeue: true }),
    false,
  );

  // `requeue: false` must behave exactly like the default.
  assert.equal(
    canTransition("COMPLETED", "WAITING", { requeue: false }),
    false,
  );
});

test("no status can transition to itself", () => {
  for (const status of QUEUE_STATUSES) {
    assert.equal(
      canTransition(status, status),
      false,
      `${status} -> ${status} must be rejected`,
    );
    assert.equal(
      canTransition(status, status, { requeue: true }),
      false,
      `${status} -> ${status} must be rejected even when requeueing`,
    );
  }
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

test("getAllowedTransitions reflects the requeue option", () => {
  assert.deepEqual(getAllowedTransitions("WAITING"), ["CALLED", "NO_SHOW"]);
  assert.deepEqual(getAllowedTransitions("CALLED"), [
    "IN_CONSULTATION",
    "NO_SHOW",
  ]);
  assert.deepEqual(getAllowedTransitions("COMPLETED"), []);

  // Requeue adds WAITING as an escape hatch, but only for non-waiting statuses.
  assert.deepEqual(getAllowedTransitions("COMPLETED", { requeue: true }), [
    "WAITING",
  ]);
  assert.deepEqual(getAllowedTransitions("WAITING", { requeue: true }), [
    "CALLED",
    "NO_SHOW",
  ]);

  // Every returned transition must be accepted by canTransition.
  for (const from of QUEUE_STATUSES) {
    for (const to of getAllowedTransitions(from, { requeue: true })) {
      assert.equal(canTransition(from, to, { requeue: true }), true);
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
  assert.deepEqual(getAvailableActions("IN_CONSULTATION"), [
    "COMPLETE",
    "REQUEUE",
  ]);
  assert.deepEqual(getAvailableActions("COMPLETED"), ["REQUEUE"]);
  assert.deepEqual(getAvailableActions("NO_SHOW"), ["REQUEUE"]);

  // Each action must resolve to a legal transition from that status.
  for (const status of QUEUE_STATUSES) {
    for (const action of getAvailableActions(status)) {
      const target = QUEUE_ACTION_TARGET[action];
      assert.equal(
        canTransition(status, target, {
          requeue: action === "REQUEUE",
        }),
        true,
      );
    }
  }
});

