import assert from "node:assert/strict";
import { test } from "node:test";

import type { QueueEntryRow } from "../database.types.ts";
import { formatMinutes, formatTokenNumber } from "../format.ts";
import {
  canTransition,
  QUEUE_ACTION_TARGET,
  QUEUE_STATUS_LABELS,
  QUEUE_STATUSES,
} from "../queue/status.ts";
import type { QueueStatus } from "../types.ts";
import {
  buildStaffDashboardView,
  formatConfirmation,
  getElapsedSentence,
  getPrimaryStaffAction,
  getStaffActions,
  isStaffActionLegal,
  orderStaffQueue,
  pickCurrentPatient,
  staffQueueEntryFromRow,
  type StaffQueueEntry,
} from "./queue.ts";

const CLINIC_ID = "22222222-2222-4222-8222-222222222222";
const DEPARTMENT_ID = "33333333-3333-4333-8333-000000000001";
const TOKEN_DATE = "2026-09-28";
const BASE_TIME = Date.UTC(2026, 8, 28, 9, 0, 0);

function minutesAgo(minutes: number): string {
  return new Date(BASE_TIME - minutes * 60_000).toISOString();
}

function entry(
  id: string,
  tokenNumber: number,
  status: QueueStatus,
  overrides: Partial<StaffQueueEntry> = {},
): StaffQueueEntry {
  return {
    id,
    tokenNumber,
    status,
    statusLabel: QUEUE_STATUS_LABELS[status],
    priority: false,
    roomLabel: null,
    patientName: null,
    joinedAt: minutesAgo(tokenNumber * 5),
    calledAt: null,
    consultationStartedAt: null,
    completedAt: null,
    waitMinutes: status === "WAITING" ? tokenNumber * 5 : null,
    elapsedMinutes: tokenNumber * 5,
    ...overrides,
  };
}

/** Mirrors the seeded General OPD board. Token 006 is staff-marked priority. */
const SEEDED_BOARD: StaffQueueEntry[] = [
  entry("t1", 1, "COMPLETED", {
    joinedAt: minutesAgo(170),
    calledAt: minutesAgo(166),
    consultationStartedAt: minutesAgo(162),
    completedAt: minutesAgo(150),
    roomLabel: "Room 1",
    patientName: "Demo Patient 001",
  }),
  entry("t2", 2, "COMPLETED", {
    joinedAt: minutesAgo(158),
    completedAt: minutesAgo(140),
    patientName: "Demo Patient 002",
  }),
  entry("t3", 3, "WAITING", { joinedAt: minutesAgo(140), waitMinutes: 140 }),
  entry("t4", 4, "WAITING", { joinedAt: minutesAgo(125), waitMinutes: 125 }),
  entry("t6", 6, "WAITING", {
    priority: true,
    joinedAt: minutesAgo(95),
    waitMinutes: 95,
    patientName: "Demo Patient 006",
  }),
  entry("t7", 7, "WAITING", { joinedAt: minutesAgo(80), waitMinutes: 80 }),
  entry("t8", 8, "CALLED", {
    joinedAt: minutesAgo(65),
    calledAt: minutesAgo(5),
    roomLabel: "Room 2",
    patientName: "Demo Patient 008",
  }),
];

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
    joined_at: minutesAgo(30),
    called_at: null,
    consultation_started_at: null,
    completed_at: null,
    estimated_wait_minutes: null,
    updated_at: minutesAgo(0),
    ...overrides,
  };
}

test("maps a queue row into the staff view without leaking private fields", () => {
  const mapped = staffQueueEntryFromRow(
    rowOf("e1", 8, "CALLED", {
      room_label: "Room 2",
      called_at: minutesAgo(5),
      priority_reason: "internal note that must not surface",
    }),
    { patientName: "Demo Patient 008", nowIso: minutesAgo(0) },
  );

  assert.equal(mapped.tokenNumber, 8);
  assert.equal(mapped.status, "CALLED");
  assert.equal(mapped.statusLabel, "Called");
  assert.equal(mapped.roomLabel, "Room 2");
  assert.equal(mapped.patientName, "Demo Patient 008");
  assert.equal(mapped.waitMinutes, null);

  const serialized = JSON.stringify(mapped);
  for (const leak of ["priority_reason", "patient_id", "phone", "clinic_id"]) {
    assert.ok(!serialized.includes(leak), `staff entry leaks "${leak}"`);
  }
});

test("only waiting entries carry a wait time", () => {
  const waiting = staffQueueEntryFromRow(
    rowOf("e1", 3, "WAITING", { joined_at: minutesAgo(42) }),
    { nowIso: minutesAgo(0) },
  );
  assert.equal(waiting.waitMinutes, 42);

  const completed = staffQueueEntryFromRow(
    rowOf("e2", 1, "COMPLETED", { completed_at: minutesAgo(1) }),
    { nowIso: minutesAgo(0) },
  );
  assert.equal(completed.waitMinutes, null);
});

test("orders the queue exactly as the database would call it", () => {
  const ordered = orderStaffQueue(SEEDED_BOARD).map((item) => item.tokenNumber);

  // Priority first, then arrival order; terminal entries keep their place too.
  assert.deepEqual(ordered, [6, 1, 2, 3, 4, 7, 8]);
});

test("builds live statistics from the rows themselves", () => {
  const view = buildStaffDashboardView(SEEDED_BOARD);

  assert.deepEqual(view.stats, {
    waiting: 4,
    called: 1,
    inConsultation: 0,
    completedToday: 2,
    noShowToday: 0,
  });
});

test("the waiting list contains only waiting entries, in call order", () => {
  const view = buildStaffDashboardView(SEEDED_BOARD);

  assert.deepEqual(
    view.waitingQueue.map((item) => item.tokenNumber),
    [6, 3, 4, 7],
  );
  assert.ok(view.waitingQueue.every((item) => item.status === "WAITING"));
});

test("the active queue holds the called and in-consultation entries", () => {
  const view = buildStaffDashboardView([
    ...SEEDED_BOARD,
    entry("t9", 9, "IN_CONSULTATION", {
      calledAt: minutesAgo(10),
      consultationStartedAt: minutesAgo(6),
    }),
  ]);

  assert.deepEqual(
    view.activeQueue.map((item) => item.tokenNumber),
    [8, 9],
  );
});

test("the current patient is a live consultation before a called patient", () => {
  const view = buildStaffDashboardView([
    ...SEEDED_BOARD,
    entry("t9", 9, "IN_CONSULTATION", {
      calledAt: minutesAgo(10),
      consultationStartedAt: minutesAgo(6),
    }),
  ]);

  assert.equal(view.currentPatient?.tokenNumber, 9);
  assert.equal(view.currentPatient?.status, "IN_CONSULTATION");
});

test("with nobody in consultation the current patient is the earliest called", () => {
  const view = buildStaffDashboardView(SEEDED_BOARD);

  assert.equal(view.currentPatient?.tokenNumber, 8);
  assert.equal(view.currentPatient?.roomLabel, "Room 2");
  assert.equal(view.currentPatient?.patientName, "Demo Patient 008");
});

test("there is no current patient when nobody has been called", () => {
  const waitingOnly = SEEDED_BOARD.filter((item) => item.status === "WAITING");

  assert.equal(pickCurrentPatient(waitingOnly), null);
  assert.equal(buildStaffDashboardView(waitingOnly).currentPatient, null);
});

test("an empty department produces zeroed statistics and no current patient", () => {
  const view = buildStaffDashboardView([]);

  assert.deepEqual(view.stats, {
    waiting: 0,
    called: 0,
    inConsultation: 0,
    completedToday: 0,
    noShowToday: 0,
  });
  assert.deepEqual(view.waitingQueue, []);
  assert.deepEqual(view.activeQueue, []);
  assert.equal(view.currentPatient, null);
});

test("no-show entries are counted but never become the current patient", () => {
  const view = buildStaffDashboardView([
    entry("n1", 5, "NO_SHOW", { calledAt: minutesAgo(20) }),
  ]);

  assert.equal(view.stats.noShowToday, 1);
  assert.equal(view.currentPatient, null);
});

test("a waiting patient can only be called", () => {
  assert.deepEqual(
    getStaffActions("WAITING").map((action) => action.action),
    ["CALL"],
  );
  assert.equal(getPrimaryStaffAction("WAITING")?.label, "Call patient");
});

test("a called patient can start, be requeued, or be marked no-show", () => {
  assert.deepEqual(
    getStaffActions("CALLED").map((action) => action.action),
    ["START_CONSULTATION", "REQUEUE", "NO_SHOW"],
  );
  assert.equal(getPrimaryStaffAction("CALLED")?.label, "Start consultation");
});

test("an in-consultation patient can only be completed", () => {
  assert.deepEqual(
    getStaffActions("IN_CONSULTATION").map((action) => action.action),
    ["COMPLETE"],
  );
  assert.equal(
    getPrimaryStaffAction("IN_CONSULTATION")?.label,
    "Complete consultation",
  );
});

test("terminal states expose no actions at all", () => {
  assert.deepEqual(getStaffActions("COMPLETED"), []);
  assert.deepEqual(getStaffActions("NO_SHOW"), []);
  assert.equal(getPrimaryStaffAction("COMPLETED"), null);
  assert.equal(getPrimaryStaffAction("NO_SHOW"), null);
});

test("every action the dashboard offers is legal in the shared state machine", () => {
  for (const status of QUEUE_STATUSES) {
    for (const descriptor of getStaffActions(status)) {
      assert.equal(
        isStaffActionLegal(descriptor.action, status),
        true,
        `${status} must not offer ${descriptor.action}`,
      );
      assert.equal(
        canTransition(status, QUEUE_ACTION_TARGET[descriptor.action]),
        true,
        `${status} -> ${QUEUE_ACTION_TARGET[descriptor.action]} is not a legal transition`,
      );
    }
  }

  // Sanity check the guard itself: an action the machine forbids is not "legal".
  assert.equal(isStaffActionLegal("COMPLETE", "WAITING"), false);
  assert.equal(isStaffActionLegal("REQUEUE", "COMPLETED"), false);
});

test("the no-show button is never offered for a patient who was not called", () => {
  assert.ok(
    !getStaffActions("WAITING").some((action) => action.action === "NO_SHOW"),
  );
  assert.ok(
    !getStaffActions("IN_CONSULTATION").some(
      (action) => action.action === "NO_SHOW",
    ),
  );
  assert.ok(
    getStaffActions("CALLED").some((action) => action.action === "NO_SHOW"),
  );
});

test("requeue is offered only from CALLED", () => {
  for (const status of QUEUE_STATUSES) {
    const offersRequeue = getStaffActions(status).some(
      (action) => action.action === "REQUEUE",
    );

    assert.equal(
      offersRequeue,
      status === "CALLED",
      `requeue policy is wrong for ${status}`,
    );
  }
});

test("only disruptive actions demand a confirmation", () => {
  const noShow = getStaffActions("CALLED").find((a) => a.action === "NO_SHOW");
  const requeue = getStaffActions("CALLED").find((a) => a.action === "REQUEUE");
  const start = getStaffActions("CALLED").find(
    (a) => a.action === "START_CONSULTATION",
  );

  assert.ok(noShow?.confirmMessage);
  assert.ok(requeue?.confirmMessage);
  assert.equal(start?.confirmMessage, undefined);
  assert.equal(getPrimaryStaffAction("WAITING")?.confirmMessage, undefined);

  assert.equal(
    formatConfirmation(noShow?.confirmMessage ?? "", "#008"),
    "Mark #008 as no-show? The patient would need to rejoin the queue.",
  );
});

test("tracks elapsed time from the status-appropriate anchor", () => {
  const waiting = staffQueueEntryFromRow(
    rowOf("e1", 3, "WAITING", { joined_at: minutesAgo(40) }),
    { nowIso: minutesAgo(0) },
  );
  assert.equal(waiting.elapsedMinutes, 40);

  const called = staffQueueEntryFromRow(
    rowOf("e2", 8, "CALLED", {
      joined_at: minutesAgo(70),
      called_at: minutesAgo(5),
    }),
    { nowIso: minutesAgo(0) },
  );
  assert.equal(called.elapsedMinutes, 5);
  assert.equal(called.waitMinutes, null);

  const inConsultation = staffQueueEntryFromRow(
    rowOf("e3", 9, "IN_CONSULTATION", {
      called_at: minutesAgo(12),
      consultation_started_at: minutesAgo(7),
    }),
    { nowIso: minutesAgo(0) },
  );
  assert.equal(inConsultation.elapsedMinutes, 7);

  const completed = staffQueueEntryFromRow(
    rowOf("e4", 1, "COMPLETED", { completed_at: minutesAgo(2) }),
    { nowIso: minutesAgo(0) },
  );
  assert.equal(completed.elapsedMinutes, null);

  assert.equal(getElapsedSentence("WAITING", "32 min"), "Waiting for 32 min");
  assert.equal(getElapsedSentence("CALLED", "5 min"), "Called 5 min ago");
  assert.equal(
    getElapsedSentence("IN_CONSULTATION", "6 min"),
    "With the doctor for 6 min",
  );
});

test("shared formatters stay stable and null-safe", () => {
  assert.equal(formatTokenNumber(8), "#008");
  assert.equal(formatTokenNumber(1234), "#1234");

  assert.equal(formatMinutes(0), "0 min");
  assert.equal(formatMinutes(42), "42 min");
  assert.equal(formatMinutes(60), "1 h");
  assert.equal(formatMinutes(65), "1 h 5 min");
  assert.equal(formatMinutes(null), null);
  assert.equal(formatMinutes(-5), null);
  assert.equal(formatMinutes(Number.NaN), null);
});

