/**
 * Row -> domain mappers.
 *
 * These are the only place snake_case database rows become the camelCase domain
 * types from lib/types.ts. Keeping the translation in one tiny pure module means:
 * - no component ever needs to know a column name;
 * - any drift between the migration and the domain types shows up here, in a
 *   file covered by unit tests, instead of silently at runtime.
 */

import type {
  ClinicRow,
  ConsultationRow,
  DepartmentRow,
  OrganizationRow,
  PatientRow,
  QueueEntryRow,
  StaffUserRow,
} from "../database.types";
import { isQueueStatus } from "../queue/status.ts";
import type {
  Clinic,
  Consultation,
  Department,
  Organization,
  Patient,
  PatientLanguage,
  QueueEntry,
  StaffUser,
} from "../types";

const PATIENT_LANGUAGES: readonly PatientLanguage[] = ["en", "hi", "kn"];

/** Narrows the DB's free-text language column to the supported set. */
export function toPatientLanguage(value: string): PatientLanguage {
  return PATIENT_LANGUAGES.includes(value as PatientLanguage)
    ? (value as PatientLanguage)
    : "en";
}

export function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

export function toClinic(row: ClinicRow): Clinic {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    address: row.address,
    createdAt: row.created_at,
  };
}

export function toDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    code: row.code,
    active: row.is_active,
    createdAt: row.created_at,
  };
}

export function toPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    name: row.display_name,
    phone: row.phone,
    language: toPatientLanguage(row.preferred_language),
    createdAt: row.created_at,
  };
}

export function toStaffUser(row: StaffUserRow): StaffUser {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    departmentId: row.department_id,
    name: row.display_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/**
 * Maps a queue row, re-validating the status on the way in.
 *
 * A status outside the canonical five means the application and the database
 * have drifted. That is a bug worth failing loudly on rather than defaulting to
 * WAITING and showing a patient the wrong information.
 */
export function toQueueEntry(row: QueueEntryRow): QueueEntry {
  if (!isQueueStatus(row.status)) {
    throw new Error(
      `Unknown queue status received from the database: ${String(row.status)}`,
    );
  }

  return {
    id: row.id,
    clinicId: row.clinic_id,
    departmentId: row.department_id,
    patientId: row.patient_id,
    tokenNumber: row.token_number,
    tokenDate: row.token_date,
    status: row.status,
    priority: row.priority,
    priorityReason: row.priority_reason,
    roomLabel: row.room_label,
    assignedStaffId: row.assigned_staff_id,
    joinedAt: row.joined_at,
    calledAt: row.called_at,
    consultationStartedAt: row.consultation_started_at,
    completedAt: row.completed_at,
    estimatedWaitMinutes: row.estimated_wait_minutes,
    updatedAt: row.updated_at,
  };
}

export function toConsultation(row: ConsultationRow): Consultation {
  return {
    id: row.id,
    queueEntryId: row.queue_entry_id,
    staffUserId: row.staff_user_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes,
  };
}

/**
 * Duration in minutes of a finished consultation, or null if it is still open.
 * This is the input the ETA engine consumes.
 */
export function consultationDurationMinutes(
  consultation: Consultation,
): number | null {
  if (!consultation.endedAt) {
    return null;
  }

  const startedMs = Date.parse(consultation.startedAt);
  const endedMs = Date.parse(consultation.endedAt);

  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs)) {
    return null;
  }

  return (endedMs - startedMs) / 60_000;
}
