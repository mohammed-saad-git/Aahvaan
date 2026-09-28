import assert from "node:assert/strict";
import { test } from "node:test";

import type { QueueEntryRow } from "../database.types.ts";
import { QUEUE_STATUSES } from "../queue/status.ts";
import type { QueueStatus } from "../types.ts";
import {
  consultationDurationMinutes,
  toConsultation,
  toDepartment,
  toPatient,
  toPatientLanguage,
  toQueueEntry,
  toStaffUser,
} from "./mappers.ts";

const BASE_QUEUE_ROW: QueueEntryRow = {
  id: "55555555-5555-4555-8555-000000000001",
  clinic_id: "22222222-2222-4222-8222-222222222222",
  department_id: "33333333-3333-4333-8333-000000000001",
  patient_id: "66666666-6666-4666-8666-000000000001",
  token_number: 1,
  token_date: "2026-09-28",
  status: "WAITING",
  priority: false,
  priority_reason: null,
  room_label: null,
  assigned_staff_id: null,
  joined_at: "2026-09-28T09:00:00.000Z",
  called_at: null,
  consultation_started_at: null,
  completed_at: null,
  estimated_wait_minutes: null,
  updated_at: "2026-09-28T09:00:00.000Z",
};

test("maps every queue entry column to the domain type", () => {
  const entry = toQueueEntry(BASE_QUEUE_ROW);

  assert.deepEqual(entry, {
    id: BASE_QUEUE_ROW.id,
    clinicId: BASE_QUEUE_ROW.clinic_id,
    departmentId: BASE_QUEUE_ROW.department_id,
    patientId: BASE_QUEUE_ROW.patient_id,
    tokenNumber: 1,
    tokenDate: "2026-09-28",
    status: "WAITING",
    priority: false,
    priorityReason: null,
    roomLabel: null,
    assignedStaffId: null,
    joinedAt: "2026-09-28T09:00:00.000Z",
    calledAt: null,
    consultationStartedAt: null,
    completedAt: null,
    estimatedWaitMinutes: null,
    updatedAt: "2026-09-28T09:00:00.000Z",
  });
});

test("maps populated optional columns and priority", () => {
  const entry = toQueueEntry({
    ...BASE_QUEUE_ROW,
    status: "CALLED",
    priority: true,
    priority_reason: "Marked by reception staff",
    room_label: "Room 2",
    assigned_staff_id: "44444444-4444-4444-8444-000000000001",
    called_at: "2026-09-28T09:05:00.000Z",
    estimated_wait_minutes: 25,
  });

  assert.equal(entry.status, "CALLED");
  assert.equal(entry.priority, true);
  assert.equal(entry.priorityReason, "Marked by reception staff");
  assert.equal(entry.roomLabel, "Room 2");
  assert.equal(entry.assignedStaffId, "44444444-4444-4444-8444-000000000001");
  assert.equal(entry.calledAt, "2026-09-28T09:05:00.000Z");
  assert.equal(entry.estimatedWaitMinutes, 25);
});

test("passes through all five canonical statuses", () => {
  for (const status of QUEUE_STATUSES) {
    assert.equal(toQueueEntry({ ...BASE_QUEUE_ROW, status }).status, status);
  }
});

test("an unknown database status fails loudly instead of defaulting", () => {
  assert.throws(
    () => toQueueEntry({ ...BASE_QUEUE_ROW, status: "WAITING_ROOM" as QueueStatus }),
    /Unknown queue status/,
  );
});

test("narrows the free-text language column to the supported set", () => {
  assert.equal(toPatientLanguage("en"), "en");
  assert.equal(toPatientLanguage("hi"), "hi");
  assert.equal(toPatientLanguage("kn"), "kn");
  assert.equal(toPatientLanguage("fr"), "en");
  assert.equal(toPatientLanguage(""), "en");
});

test("maps department, patient and staff rows", () => {
  const department = toDepartment({
    id: "33333333-3333-4333-8333-000000000001",
    clinic_id: "22222222-2222-4222-8222-222222222222",
    name: "General OPD",
    code: "GOPD",
    is_active: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(department.code, "GOPD");
  assert.equal(department.active, true);
  assert.equal(department.name, "General OPD");

  const patient = toPatient({
    id: "66666666-6666-4666-8666-000000000001",
    display_name: "Demo Patient 001",
    phone: null,
    preferred_language: "kn",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(patient.name, "Demo Patient 001");
  assert.equal(patient.language, "kn");
  assert.equal(patient.phone, null);

  const staff = toStaffUser({
    id: "44444444-4444-4444-8444-000000000004",
    clinic_id: "22222222-2222-4222-8222-222222222222",
    department_id: null,
    display_name: "Reception Demo Desk",
    role: "RECEPTIONIST",
    is_active: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(staff.name, "Reception Demo Desk");
  assert.equal(staff.departmentId, null);
  assert.equal(staff.isActive, true);
});

test("maps consultation rows and derives ETA durations", () => {
  const open = toConsultation({
    id: "a",
    queue_entry_id: "e",
    staff_user_id: null,
    started_at: "2026-09-28T09:00:00.000Z",
    ended_at: null,
    notes: null,
    created_at: "2026-09-28T09:00:00.000Z",
    updated_at: "2026-09-28T09:00:00.000Z",
  });
  assert.equal(open.endedAt, null);
  // An open consultation contributes nothing to the ETA window.
  assert.equal(consultationDurationMinutes(open), null);

  const closed = toConsultation({
    id: "b",
    queue_entry_id: "e",
    staff_user_id: "44444444-4444-4444-8444-000000000001",
    started_at: "2026-09-28T09:00:00.000Z",
    ended_at: "2026-09-28T09:12:00.000Z",
    notes: "synthetic",
    created_at: "2026-09-28T09:00:00.000Z",
    updated_at: "2026-09-28T09:12:00.000Z",
  });
  assert.equal(consultationDurationMinutes(closed), 12);
  assert.equal(closed.notes, "synthetic");
});

test("never returns NaN for unparseable timestamps", () => {
  const broken = toConsultation({
    id: "c",
    queue_entry_id: "e",
    staff_user_id: null,
    started_at: "not-a-date",
    ended_at: "also-not-a-date",
    notes: null,
    created_at: "x",
    updated_at: "x",
  });

  assert.equal(consultationDurationMinutes(broken), null);
});
