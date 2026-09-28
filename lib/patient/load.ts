/**
 * Server-only patient data loading.
 *
 * Why this is separate from lib/patient/queue.ts: everything here uses the
 * PRIVILEGED (secret key) Supabase client, because the anonymous role can only
 * read `queue_entries`. Clinic names, department names and consultation history
 * are not anon-readable — and RLS is deliberately NOT weakened to change that.
 * The server loads them and only the derived, minimal view model crosses to the
 * browser.
 *
 * Never import this module from a Client Component:
 * `createPrivilegedSupabaseClient()` throws if it is evaluated in a browser.
 *
 * Failures return `null` / empty rather than raw database messages, so pages can
 * show a friendly state and no Postgres text ever reaches a patient.
 */

import type { ConsultationRow, QueueEntryRow } from "../database.types.ts";
import { ETA_DEFAULTS } from "../queue/eta.ts";
import { ACTIVE_QUEUE_STATUSES } from "../queue/status.ts";
import {
  consultationDurationMinutes,
  toConsultation,
} from "../supabase/mappers.ts";
import { createPrivilegedSupabaseClient } from "../supabase/server.ts";
import {
  queueEntryViewFromRow,
  type ClinicSummary,
  type DepartmentSummary,
  type PatientQueueSnapshot,
  type QueueEntryView,
  type QueueEntryViewSource,
} from "./queue.ts";

function logServerError(scope: string, message: string): void {
  // Server-side diagnostics only. Never surfaced to the patient.
  console.error(`[patient] ${scope}: ${message}`);
}

function toViews(rows: readonly unknown[]): QueueEntryView[] {
  const views: QueueEntryView[] = [];

  for (const row of rows) {
    try {
      views.push(queueEntryViewFromRow(row as QueueEntryViewSource));
    } catch {
      // Skip malformed rows instead of breaking the whole screen.
    }
  }

  return views;
}

/**
 * Every clinic, for the landing page's "Join a queue" links.
 *
 * Public because a patient arriving at the root URL must be able to pick a clinic
 * without an account. The clinic list is not sensitive; patient data never
 * appears here.
 */
export async function loadClinicOptions(): Promise<ClinicSummary[]> {
  const supabase = createPrivilegedSupabaseClient();

  const { data, error } = await supabase
    .from("clinics")
    .select("id, name, address")
    .order("name", { ascending: true });

  if (error) {
    logServerError("loadClinicOptions", error.message);
    return [];
  }

  return (data ?? []) as ClinicSummary[];
}

export async function loadClinicSummary(
  clinicId: string,
): Promise<ClinicSummary | null> {
  const supabase = createPrivilegedSupabaseClient();

  const { data, error } = await supabase
    .from("clinics")
    .select("id, name, address")
    .eq("id", clinicId)
    .maybeSingle();

  if (error) {
    logServerError("loadClinicSummary", error.message);
    return null;
  }

  return (data as ClinicSummary | null) ?? null;
}

export async function loadActiveDepartments(
  clinicId: string,
): Promise<DepartmentSummary[]> {
  const supabase = createPrivilegedSupabaseClient();

  const { data, error } = await supabase
    .from("departments")
    .select("id, name, code")
    .eq("clinic_id", clinicId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    logServerError("loadActiveDepartments", error.message);
    return [];
  }

  return (data ?? []) as DepartmentSummary[];
}

/**
 * Everything the patient queue screen needs, in one call.
 *
 * Returns null when the entry is missing or malformed, which the page turns into
 * a friendly "we couldn't find your queue entry" state.
 */
export async function loadPatientQueueSnapshot(
  queueEntryId: string,
): Promise<PatientQueueSnapshot | null> {
  const supabase = createPrivilegedSupabaseClient();

  const { data: entryData, error: entryError } = await supabase
    .from("queue_entries")
    .select("*")
    .eq("id", queueEntryId)
    .maybeSingle();

  if (entryError) {
    logServerError("loadPatientQueueSnapshot/entry", entryError.message);
    return null;
  }
  if (!entryData) {
    return null;
  }

  const entryRow = entryData as QueueEntryRow;

  let entry: QueueEntryView;
  try {
    entry = queueEntryViewFromRow(entryRow);
  } catch {
    logServerError("loadPatientQueueSnapshot", "unrecognised queue status");
    return null;
  }

  const { data: departmentData, error: departmentError } = await supabase
    .from("departments")
    .select("id, name, clinic_id")
    .eq("id", entryRow.department_id)
    .maybeSingle();

  if (departmentError || !departmentData) {
    logServerError(
      "loadPatientQueueSnapshot/department",
      departmentError?.message ?? "department not found",
    );
    return null;
  }

  const department = departmentData as {
    id: string;
    name: string;
    clinic_id: string;
  };

  const { data: clinicData } = await supabase
    .from("clinics")
    .select("name")
    .eq("id", department.clinic_id)
    .maybeSingle();

  const clinicName = (clinicData as { name: string } | null)?.name ?? "Clinic";

  const { data: queueData, error: queueError } = await supabase
    .from("queue_entries")
    .select(
      "id, token_number, status, priority, room_label, joined_at, department_id, token_date",
    )
    .eq("department_id", entryRow.department_id)
    .eq("token_date", entryRow.token_date)
    .in("status", [...ACTIVE_QUEUE_STATUSES])
    .order("priority", { ascending: false })
    .order("joined_at", { ascending: true })
    .order("token_number", { ascending: true });

  if (queueError) {
    logServerError("loadPatientQueueSnapshot/queue", queueError.message);
  }

  const activeQueue = toViews(queueData ?? []);
  const queue = activeQueue.some((item) => item.id === entry.id)
    ? activeQueue
    : [...activeQueue, entry];

  // Recent completed consultations in this department: the ETA engine's input.
  const { data: consultationData, error: consultationError } = await supabase
    .from("consultations")
    .select(
      "id, queue_entry_id, staff_user_id, started_at, ended_at, notes, created_at, updated_at, queue_entries!inner(department_id)",
    )
    .eq("queue_entries.department_id", entryRow.department_id)
    .not("ended_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(ETA_DEFAULTS.sampleSize);

  if (consultationError) {
    // No history simply means the ETA uses its documented fallback range.
    logServerError(
      "loadPatientQueueSnapshot/consultations",
      consultationError.message,
    );
  }

  const recentConsultationMinutes: number[] = [];

  for (const row of consultationData ?? []) {
    const duration = consultationDurationMinutes(
      toConsultation(row as ConsultationRow),
    );
    if (duration !== null && duration > 0) {
      recentConsultationMinutes.push(duration);
    }
  }

  return {
    clinicName,
    departmentName: department.name,
    departmentId: department.id,
    tokenDate: entryRow.token_date,
    entry,
    queue,
    recentConsultationMinutes,
    fallbackMinutes: ETA_DEFAULTS.fallbackMinutes,
    sampleSize: ETA_DEFAULTS.sampleSize,
    fetchedAt: new Date().toISOString(),
  };
}

