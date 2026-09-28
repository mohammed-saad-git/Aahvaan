/**
 * Database row types.
 *
 * These mirror supabase/migrations/0001_init.sql exactly — snake_case, nullable
 * columns explicitly `| null`. They are the boundary types: row shapes come in
 * here and are translated into the camelCase domain types in lib/types.ts by
 * lib/supabase/mappers.ts.
 *
 * Deliberately NOT a generated-style `Database` generic with Row/Insert/Update
 * variants for every table: that boilerplate buys nothing for this MVP and would
 * be the "giant abstraction layer" we were told to avoid. What matters is that
 * the columns and the domain types cannot silently disagree, which the mappers
 * and their unit tests enforce.
 */

import type {
  IsoDate,
  IsoTimestamp,
  QueueStatus,
  StaffRole,
} from "./types";

export interface OrganizationRow {
  id: string;
  name: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface ClinicRow {
  id: string;
  organization_id: string;
  name: string;
  address: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface DepartmentRow {
  id: string;
  clinic_id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PatientRow {
  id: string;
  display_name: string;
  phone: string | null;
  /** text + CHECK constraint in the DB; narrowed to PatientLanguage by the mapper. */
  preferred_language: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface StaffUserRow {
  id: string;
  clinic_id: string;
  department_id: string | null;
  display_name: string;
  role: StaffRole;
  is_active: boolean;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface QueueEntryRow {
  id: string;
  clinic_id: string;
  department_id: string;
  patient_id: string;
  token_number: number;
  token_date: IsoDate;
  status: QueueStatus;
  priority: boolean;
  priority_reason: string | null;
  room_label: string | null;
  assigned_staff_id: string | null;
  joined_at: IsoTimestamp;
  called_at: IsoTimestamp | null;
  consultation_started_at: IsoTimestamp | null;
  completed_at: IsoTimestamp | null;
  estimated_wait_minutes: number | null;
  updated_at: IsoTimestamp;
}

export interface ConsultationRow {
  id: string;
  queue_entry_id: string;
  staff_user_id: string | null;
  started_at: IsoTimestamp;
  ended_at: IsoTimestamp | null;
  notes: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/* ---------------------------------------------------------------------------
 * RPC argument shapes (see 0001_init.sql)
 * ------------------------------------------------------------------------- */

export interface JoinQueueArgs {
  p_department_id: string;
  p_display_name: string;
  p_phone?: string | null;
  p_preferred_language?: string | null;
}

export interface CallNextQueueEntryArgs {
  p_department_id: string;
  p_token_date?: string | null;
  p_staff_user_id?: string | null;
  p_room_label?: string | null;
}

export interface TransitionQueueEntryArgs {
  p_queue_entry_id: string;
  /** One of QueueAction: CALL | START_CONSULTATION | COMPLETE | NO_SHOW | REQUEUE. */
  p_action: string;
  p_staff_user_id?: string | null;
  p_room_label?: string | null;
}
