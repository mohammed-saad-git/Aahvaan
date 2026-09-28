import assert from "node:assert/strict";
import { test } from "node:test";

import type { QueueEntryRow } from "../database.types.ts";
import type { QueueStatus } from "../types.ts";
import {
  applyRealtimeQueueChange,
  buildPatientQueueView,
  formatTokenNumber,
  isUuid,
  parsePatientPhone,
  sanitizeDisplayName,
  toPatientLanguage,
  type PatientQueueSnapshot,
  type QueueEntryView,
} from "./queue.ts";

const CLINIC_ID = "22222222-2222-4222-8222-222222222222";
const DEPARTMENT_ID = "33333333-3333-4333-8333-000000000001";
const OTHER_DEPARTMENT_ID = "33333333-3333-4333-8333-000000000002";
const TOKEN_DATE = "2026-09-28";
const BASE_TIME = Date.UTC(2026, 8, 28, 9, 0, 0);

/** The documented demonstration history: average 12.2 minutes. */
const DEMO_DURATIONS = [12, 10, 15, 11, 13];

function minutesAgo(minutes: number): string {
  return new Date(BASE_TIME - minutes * 60_000).toISOString();
}

function viewOf(
  id: string,
  tokenNumber: number,
  status: QueueStatus,
  overrides: Partial<QueueEntryView> = {},
): QueueEntryView {
  return {
    id,
    tokenNumber,
    status,
    priority: false,
    joinedAt: minutesAgo(tokenNumber * 5),
    roomLabel: null,
    ...overrides,
  };
}

/** A full database row, shaped exactly like a Realtime payload. */
function rowOf(
  id: string,
  tokenNumber: number,
  status: QueueStatus,
  overrides: Partial<QueueEntryRow> = {},
): QueueEntryRow {
  return {
    id,
    clinic_id: CLINIC_ID,
    department_id: DEPARTMENT_ID,
    patient_id: "00000000-0000-4000-8000-000000000000",
    token_number: tokenNumber,
    token_date: TOKEN_DATE,
    status,
    priority: false,
    priority_reason: null,
    room_label: null,
    assigned_staff_id: null,
    joined_at: minutesAgo(tokenNumber * 5),
    called_at: null,
    consultation_started_at: null,
    completed_at: null,
    estimated_wait_minutes: null,
    updated_at: minutesAgo(0),
    ...overrides,
  };
}

function snapshotOf(
  overrides: Partial<PatientQueueSnapshot> = {},
): PatientQueueSnapshot {
  const entry = viewOf("me", 4, "WAITING", { joinedAt: minutesAgo(10) });
  const threeAhead = [
    viewOf("a", 1, "WAITING", { joinedAt: minutesAgo(60) }),
    viewOf("b", 2, "WAITING", { joinedAt: minutesAgo(50) }),
    viewOf("c", 3, "WAITING", { joinedAt: minutesAgo(40) }),
  ];

  return {
    clinicName: "CityCare Hospital",
    departmentName: "General OPD",
    departmentId: DEPARTMENT_ID,
    tokenDate: TOKEN_DATE,
    entry,
    queue: [...threeAhead, entry],
    recentConsultationMinutes: DEMO_DURATIONS,
    fallbackMinutes: 12,
    sampleSize: 5,
    fetchedAt: new Date(BASE_TIME).toISOString(),
    ...overrides,
  };
}

test("builds the documented view: 3 ahead, 12.2 min average, 30–40 min", () => {
  const result = buildPatientQueueView(snapshotOf());

  assert.equal(result.peopleAhead, 3);
  assert.equal(result.peopleAheadLabel, "3 people ahead");
  assert.equal(result.eta.averageMinutes, 12.2);
  assert.equal(result.eta.label, "30–40 min");
  assert.equal(result.eta.usedFallback, false);
  assert.equal(result.showEta, true);

  assert.equal(result.status, "WAITING");
  assert.equal(result.statusLabel, "Waiting");
  assert.equal(result.headline, "You're in the queue");
  assert.equal(result.tokenNumber, 4);
  assert.equal(result.clinicName, "CityCare Hospital");
  assert.equal(result.departmentName, "General OPD");
});

test("zero people ahead means next, with no wait estimate", () => {
  const me = viewOf("me", 4, "WAITING", { joinedAt: minutesAgo(10) });
  const result = buildPatientQueueView(snapshotOf({ entry: me, queue: [me] }));

  assert.equal(result.peopleAhead, 0);
  assert.equal(result.peopleAheadLabel, "You're next");
  assert.equal(result.headline, "You're next");
  assert.equal(result.showEta, false);
  assert.equal(result.eta.label, "No wait");
  assert.ok(Number.isFinite(result.eta.minMinutes));
  assert.ok(Number.isFinite(result.eta.maxMinutes));
});

test("falls back to a sane range when the department has no history", () => {
  const result = buildPatientQueueView(
    snapshotOf({ recentConsultationMinutes: [] }),
  );

  assert.equal(result.eta.usedFallback, true);
  assert.equal(result.averageConsultationMinutes, null);
  assert.equal(result.eta.averageMinutes, 12);
  // Three patients (a, b, c) are still ahead of this patient in the fixture.
  assert.equal(result.peopleAhead, 3);
  // 3 x 12 min fallback = 36 min, spread and rounded into a readable range.
  assert.equal(result.eta.label, "30–40 min");
});

test("a completed visit stops showing a wait estimate", () => {
  const me = viewOf("me", 4, "COMPLETED", { joinedAt: minutesAgo(10) });
  const result = buildPatientQueueView(snapshotOf({ entry: me, queue: [] }));

  assert.equal(result.headline, "Visit completed");
  assert.equal(result.statusLabel, "Completed");
  assert.equal(result.showEta, false);
  assert.equal(result.peopleAhead, 0);
  assert.match(result.detail, /Thanks for visiting/);
});

test("a no-show entry is described as closed, never as a medical outcome", () => {
  const me = viewOf("me", 4, "NO_SHOW", { joinedAt: minutesAgo(10) });
  const result = buildPatientQueueView(snapshotOf({ entry: me, queue: [] }));

  assert.equal(result.headline, "Queue entry closed");
  assert.equal(result.statusLabel, "No show");
  assert.equal(result.showEta, false);
  assert.match(result.detail, /reception desk/);
});

test("a called patient is told the room and stops seeing an estimate", () => {
  const me = viewOf("me", 4, "CALLED", {
    joinedAt: minutesAgo(10),
    roomLabel: "Room 2",
  });
  const result = buildPatientQueueView(snapshotOf({ entry: me, queue: [me] }));

  assert.equal(result.headline, "You're up next");
  assert.equal(result.roomLabel, "Room 2");
  assert.equal(result.detail, "Please proceed to Room 2.");
  assert.equal(result.showEta, false);
});

test("a patient in consultation is told they are with the doctor", () => {
  const me = viewOf("me", 4, "IN_CONSULTATION", { joinedAt: minutesAgo(10) });
  const result = buildPatientQueueView(snapshotOf({ entry: me, queue: [me] }));

  assert.equal(result.headline, "You're with the doctor");
  assert.equal(result.statusLabel, "In consultation");
  assert.equal(result.showEta, false);
});

test("a priority patient ahead counts, even though they arrived later", () => {
  const priority = viewOf("priority", 6, "WAITING", {
    priority: true,
    joinedAt: minutesAgo(20),
  });
  const me = viewOf("me", 4, "WAITING", { joinedAt: minutesAgo(10) });

  const result = buildPatientQueueView(
    snapshotOf({ entry: me, queue: [me, priority] }),
  );

  assert.equal(result.peopleAhead, 1);
  assert.equal(result.peopleAheadLabel, "1 person ahead");
});

test("finished entries left in the payload never count as ahead", () => {
  const done = viewOf("done", 1, "COMPLETED", { joinedAt: minutesAgo(90) });
  const skipped = viewOf("skipped", 2, "NO_SHOW", { joinedAt: minutesAgo(80) });
  const me = viewOf("me", 4, "WAITING", { joinedAt: minutesAgo(10) });

  const result = buildPatientQueueView(
    snapshotOf({ entry: me, queue: [done, skipped, me] }),
  );

  assert.equal(result.peopleAhead, 0);
});

/* --------------------------------------------------------------------------
 * Realtime: these are the exact transformations the patient screen performs
 * when a postgres_changes UPDATE arrives.
 * ----------------------------------------------------------------------- */

test("a patient ahead being called immediately improves this patient's position", () => {
  const before = snapshotOf();
  const beforeView = buildPatientQueueView(before);
  assert.equal(beforeView.peopleAhead, 3);
  assert.equal(beforeView.eta.label, "30–40 min");

  // Staff call the patient at the front of the queue.
  const after = applyRealtimeQueueChange(
    before,
    rowOf("a", 1, "CALLED", { called_at: minutesAgo(0) }),
  );
  const afterView = buildPatientQueueView(after);

  assert.equal(afterView.peopleAhead, 2);
  assert.equal(afterView.peopleAheadLabel, "2 people ahead");
  assert.equal(afterView.eta.label, "20–30 min");
});

test("this patient being called updates the status, room and estimate", () => {
  const after = applyRealtimeQueueChange(
    snapshotOf(),
    rowOf("me", 4, "CALLED", { room_label: "Room 5", called_at: minutesAgo(0) }),
  );
  const view = buildPatientQueueView(after);

  assert.equal(view.status, "CALLED");
  assert.equal(view.statusLabel, "Called");
  assert.equal(view.headline, "You're up next");
  assert.equal(view.roomLabel, "Room 5");
  assert.equal(view.detail, "Please proceed to Room 5.");
  assert.equal(view.showEta, false);
  assert.equal(view.peopleAhead, 0);
});

test("an entry ahead completing removes it from the active queue", () => {
  const after = applyRealtimeQueueChange(
    snapshotOf(),
    rowOf("a", 1, "COMPLETED", { completed_at: minutesAgo(0) }),
  );

  assert.ok(!after.queue.some((item) => item.id === "a"));
  assert.equal(buildPatientQueueView(after).peopleAhead, 2);
});

test("a no-show ahead also frees the position", () => {
  const after = applyRealtimeQueueChange(
    snapshotOf(),
    rowOf("b", 2, "NO_SHOW"),
  );

  assert.ok(!after.queue.some((item) => item.id === "b"));
  assert.equal(buildPatientQueueView(after).peopleAhead, 2);
});

test("events for another department are ignored", () => {
  const before = snapshotOf();
  const after = applyRealtimeQueueChange(
    before,
    rowOf("x", 99, "CALLED", { department_id: OTHER_DEPARTMENT_ID }),
  );

  assert.equal(after, before);
});

test("events for another day are ignored", () => {
  const before = snapshotOf();
  const after = applyRealtimeQueueChange(
    before,
    rowOf("x", 99, "CALLED", { token_date: "2026-09-27" }),
  );

  assert.equal(after, before);
});

test("an unrecognised status is ignored instead of corrupting the view", () => {
  const before = snapshotOf();
  const after = applyRealtimeQueueChange(
    before,
    rowOf("a", 1, "WAITING_ROOM" as QueueStatus),
  );

  assert.equal(after, before);
});

test("a priority patient becoming visible is added to the queue", () => {
  const after = applyRealtimeQueueChange(
    snapshotOf(),
    rowOf("priority", 50, "WAITING", {
      priority: true,
      joined_at: minutesAgo(1),
    }),
  );

  assert.equal(buildPatientQueueView(after).peopleAhead, 4);
});

/* -------------------------------- input guards ------------------------------ */

test("formats token numbers as a fixed-width label", () => {
  assert.equal(formatTokenNumber(1), "#001");
  assert.equal(formatTokenNumber(9), "#009");
  assert.equal(formatTokenNumber(42), "#042");
  assert.equal(formatTokenNumber(1234), "#1234");
  assert.equal(formatTokenNumber(Number.NaN), "#000");
  assert.equal(formatTokenNumber(-5), "#000");
});

test("accepts only well-formed UUIDs", () => {
  assert.equal(isUuid(DEPARTMENT_ID), true);
  assert.equal(isUuid(DEPARTMENT_ID.toUpperCase()), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid("33333333-3333-4333-8333-00000000000"), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(undefined), false);
  assert.equal(isUuid(12345), false);
});

test("cleans and bounds the patient display name", () => {
  assert.equal(sanitizeDisplayName("  Asha   Kumar  "), "Asha Kumar");
  assert.equal(sanitizeDisplayName("Judge"), "Judge");
  assert.equal(sanitizeDisplayName("   "), null);
  assert.equal(sanitizeDisplayName(""), null);
  assert.equal(sanitizeDisplayName("x".repeat(81)), null);
  assert.equal(sanitizeDisplayName(null), null);
  assert.equal(sanitizeDisplayName(42), null);
});

test("treats the phone number as optional but validates it when given", () => {
  assert.deepEqual(parsePatientPhone(""), { ok: true, value: null });
  assert.deepEqual(parsePatientPhone("   "), { ok: true, value: null });
  assert.deepEqual(parsePatientPhone(null), { ok: true, value: null });

  assert.equal(parsePatientPhone("+91 90000 00001").ok, true);
  assert.equal(parsePatientPhone("+91 90000 00001").value, "+91 90000 00001");
  assert.equal(parsePatientPhone("(080) 1234-5678").ok, true);

  assert.equal(parsePatientPhone("abc").ok, false);
  assert.equal(parsePatientPhone("123").ok, false);
  assert.equal(parsePatientPhone("9".repeat(30)).ok, false);
});

test("narrows the language selection to the supported set", () => {
  assert.equal(toPatientLanguage("en"), "en");
  assert.equal(toPatientLanguage("hi"), "hi");
  assert.equal(toPatientLanguage("kn"), "kn");
  assert.equal(toPatientLanguage("fr"), "en");
  assert.equal(toPatientLanguage(undefined), "en");
  assert.equal(toPatientLanguage(null), "en");
});

