import assert from "node:assert/strict";
import { test } from "node:test";

import { QUEUE_STATUSES } from "../queue/status.ts";
import type { QueueStatus } from "../types.ts";
import {
  compareQueueOrder,
  countPeopleAhead,
  getPeopleAheadLabel,
  getStatusDetail,
  getStatusHeadline,
  isWaitingForTurn,
  sortQueueOrder,
  type QueuePositionEntry,
} from "./position.ts";

const BASE_TIME = Date.UTC(2026, 8, 28, 9, 0, 0);

function minutesAgo(minutes: number): string {
  return new Date(BASE_TIME - minutes * 60_000).toISOString();
}

function entry(
  id: string,
  tokenNumber: number,
  overrides: Partial<QueuePositionEntry> = {},
): QueuePositionEntry {
  return {
    id,
    tokenNumber,
    status: "WAITING" as QueueStatus,
    priority: false,
    joinedAt: minutesAgo(tokenNumber),
    ...overrides,
  };
}

/**
 * Mirrors the seeded General OPD queue: token 006 is a staff-marked priority
 * patient who arrived later than 003–005, and token 008 has already been called.
 */
const SEEDED_QUEUE: QueuePositionEntry[] = [
  entry("t3", 3, { joinedAt: minutesAgo(140) }),
  entry("t4", 4, { joinedAt: minutesAgo(125) }),
  entry("t5", 5, { joinedAt: minutesAgo(110) }),
  entry("t6", 6, { priority: true, joinedAt: minutesAgo(95) }),
  entry("t7", 7, { joinedAt: minutesAgo(80) }),
  entry("t8", 8, { status: "CALLED", joinedAt: minutesAgo(65) }),
];

test("orders priority first, then arrival, then token number", () => {
  const ordered = sortQueueOrder(SEEDED_QUEUE).map((item) => item.tokenNumber);

  // The priority patient (006) is called first even though 003–005 arrived earlier.
  assert.deepEqual(ordered, [6, 3, 4, 5, 7, 8]);
});

test("sortQueueOrder does not mutate its input", () => {
  const original = [...SEEDED_QUEUE];
  sortQueueOrder(SEEDED_QUEUE);
  assert.deepEqual(SEEDED_QUEUE, original);
});

test("falls back to token number when join times are identical", () => {
  const sameTime = minutesAgo(30);
  const a = entry("a", 12, { joinedAt: sameTime });
  const b = entry("b", 10, { joinedAt: sameTime });

  assert.deepEqual(sortQueueOrder([a, b]).map((item) => item.tokenNumber), [10, 12]);
});

test("compareQueueOrder is symmetric", () => {
  const first = entry("a", 1, { joinedAt: minutesAgo(50) });
  const second = entry("b", 2, { joinedAt: minutesAgo(10) });

  assert.ok(compareQueueOrder(first, second) < 0);
  assert.ok(compareQueueOrder(second, first) > 0);
  assert.equal(compareQueueOrder(first, first), 0);
});

test("counts only the WAITING patients ahead", () => {
  // 003 is behind the priority patient 006, and nobody else.
  assert.equal(countPeopleAhead(SEEDED_QUEUE, "t3"), 1);

  // 007 has the priority patient plus 003, 004 and 005 ahead of it.
  assert.equal(countPeopleAhead(SEEDED_QUEUE, "t7"), 4);
});

test("a patient already called has nobody ahead", () => {
  assert.equal(countPeopleAhead(SEEDED_QUEUE, "t8"), 0);
});

test("completed and no-show entries are not counted as ahead", () => {
  const queue = [
    entry("done", 1, { status: "COMPLETED", joinedAt: minutesAgo(60) }),
    entry("skipped", 2, { status: "NO_SHOW", joinedAt: minutesAgo(50) }),
    entry("serving", 3, { status: "IN_CONSULTATION", joinedAt: minutesAgo(40) }),
    entry("me", 4, { joinedAt: minutesAgo(30) }),
  ];

  assert.equal(countPeopleAhead(queue, "me"), 0);
});

test("a newly joined patient sits behind the whole waiting queue", () => {
  const queue = [...SEEDED_QUEUE, entry("t9", 9, { joinedAt: minutesAgo(0) })];
  assert.equal(countPeopleAhead(queue, "t9"), 5);
});

test("an unknown entry id is not counted, and never throws", () => {
  assert.equal(countPeopleAhead(SEEDED_QUEUE, "does-not-exist"), 0);
  assert.equal(countPeopleAhead([], "anything"), 0);
});

test("people-ahead labels read naturally and never go negative", () => {
  assert.equal(getPeopleAheadLabel(0), "You're next");
  assert.equal(getPeopleAheadLabel(1), "1 person ahead");
  assert.equal(getPeopleAheadLabel(3), "3 people ahead");
  assert.equal(getPeopleAheadLabel(-4), "You're next");
  assert.equal(getPeopleAheadLabel(Number.NaN), "You're next");
});

test("status headlines cover every status and never show raw enum values", () => {
  assert.equal(getStatusHeadline("WAITING", 3), "You're in the queue");
  assert.equal(getStatusHeadline("WAITING", 0), "You're next");
  assert.equal(getStatusHeadline("CALLED", 0), "You're up next");
  assert.equal(getStatusHeadline("IN_CONSULTATION", 0), "You're with the doctor");
  assert.equal(getStatusHeadline("COMPLETED", 0), "Visit completed");
  assert.equal(getStatusHeadline("NO_SHOW", 0), "Queue entry closed");

  for (const status of QUEUE_STATUSES) {
    const headline = getStatusHeadline(status, 2);
    assert.ok(headline.length > 0);
    assert.ok(!headline.includes(status), `${status} must not leak into the UI`);
    assert.ok(!headline.includes("_"));
  }
});

test("a called patient is told which room to go to", () => {
  assert.equal(getStatusDetail("CALLED", "Room 2"), "Please proceed to Room 2.");
  assert.equal(
    getStatusDetail("CALLED", null),
    "Please proceed to the consultation desk.",
  );
});

test("status details are always present and never mention internal terms", () => {
  for (const status of QUEUE_STATUSES) {
    const detail = getStatusDetail(status, "Room 1");
    assert.ok(detail.length > 0, `${status} needs a supporting sentence`);
    for (const leak of ["QUEUE_ENTRY", "token_date", "department_id", "null"]) {
      assert.ok(!detail.includes(leak), `${status} detail leaks "${leak}"`);
    }
  }
});

test("only a waiting patient with people ahead is told to expect a wait", () => {
  assert.equal(isWaitingForTurn("WAITING", 3), true);
  assert.equal(isWaitingForTurn("WAITING", 0), false);
  assert.equal(isWaitingForTurn("CALLED", 0), false);
  assert.equal(isWaitingForTurn("IN_CONSULTATION", 0), false);
  assert.equal(isWaitingForTurn("COMPLETED", 0), false);
  assert.equal(isWaitingForTurn("NO_SHOW", 0), false);
});
