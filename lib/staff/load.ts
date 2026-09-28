/**
 * Server-only staff data loading.
 *
 * Uses the PRIVILEGED (secret key) client: staff need to see the whole board for
 * a department, which the anonymous role deliberately cannot. Nothing here may be
 * imported by a Client Component — `createPrivilegedSupabaseClient()` throws if it
 * is ever evaluated in a browser.
 *
 * Failures return `null`/empty rather than raw database messages, so the page can
 * show a friendly state and no Postgres text ever reaches staff.
 */

import type { QueueEntryRow } from "../database.types.ts";
import { createPrivilegedSupabaseClient } from "../supabase/server.ts";
import {
  staffQueueEntryFromRow,
  type StaffClinic,
  type StaffDepartmentOption,
  type StaffQueueEntry,
} from "./queue.ts";

export type { StaffClinic, StaffDepartmentOption };

export interface StaffDashboardData {
  clinic: StaffClinic;
  departments: StaffDepartmentOption[];
  selectedDepartment: StaffDepartmentOption;
  /** The board's day, resolved from the database. Null when the queue is empty. */
  tokenDate: string | null;
  entries: StaffQueueEntry[];
  nowIso: string;
  /** True when the requested department was invalid and a default was used. */
  usedFallbackDepartment: boolean;
}

/** Rows fetched per department board. Far above any realistic demo day. */
const BOARD_ROW_LIMIT = 300;

function logServerError(scope: string, message: string): void {
  console.error(`[staff] ${scope}: ${message}`);
}

/**
 * Loads the whole staff board.
 *
 * Returns null when there is no usable context (no clinic, or no active
 * departments) — the page turns that into a friendly setup message.
 */
export async function loadStaffDashboard(
  preferredDepartmentId: string | null,
): Promise<StaffDashboardData | null> {
  const supabase = createPrivilegedSupabaseClient();

  // DEMO STAFF CONTEXT: there is no authentication yet, so the clinic is simply
  // the first one in the database. The UI labels this clearly as a demo context
  // rather than pretending it is a signed-in staff session.
  const { data: clinicData, error: clinicError } = await supabase
    .from("clinics")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (clinicError) {
    logServerError("loadStaffDashboard/clinic", clinicError.message);
    return null;
  }

  const clinic = (clinicData as StaffClinic | null) ?? null;
  if (!clinic) {
    return null;
  }

  const { data: departmentData, error: departmentError } = await supabase
    .from("departments")
    .select("id, name, code")
    .eq("clinic_id", clinic.id)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (departmentError) {
    logServerError("loadStaffDashboard/departments", departmentError.message);
    return null;
  }

  const departments = (departmentData ?? []) as StaffDepartmentOption[];
  if (departments.length === 0) {
    return null;
  }

  const selectedDepartment =
    departments.find((department) => department.id === preferredDepartmentId) ??
    departments[0];

  const nowIso = new Date().toISOString();

  // Resolve the board's day from the database rather than the local clock, so a
  // time-zone difference can never make the queue look empty.
  const { data: latestDate } = await supabase
    .from("queue_entries")
    .select("token_date")
    .eq("department_id", selectedDepartment.id)
    .order("token_date", { ascending: false })
    .limit(1);

  const tokenDate =
    (latestDate?.[0] as { token_date: string } | undefined)?.token_date ?? null;

  const entries: StaffQueueEntry[] = [];

  if (tokenDate) {
    const { data: rows, error: rowsError } = await supabase
      .from("queue_entries")
      .select("*, patients!inner(display_name)")
      .eq("department_id", selectedDepartment.id)
      .eq("token_date", tokenDate)
      .order("priority", { ascending: false })
      .order("joined_at", { ascending: true })
      .limit(BOARD_ROW_LIMIT);

    if (rowsError) {
      logServerError("loadStaffDashboard/queue", rowsError.message);
    }

    for (const row of rows ?? []) {
      const record = row as QueueEntryRow & {
        patients?: { display_name?: string } | null;
      };

      try {
        entries.push(
          staffQueueEntryFromRow(record, {
            patientName: record.patients?.display_name ?? null,
            nowIso,
          }),
        );
      } catch {
        // Skip a malformed row rather than blanking the whole board.
        logServerError("loadStaffDashboard/queue", "unrecognised queue status");
      }
    }
  }

  return {
    clinic,
    departments,
    selectedDepartment,
    tokenDate,
    entries,
    nowIso,
    usedFallbackDepartment:
      preferredDepartmentId !== null &&
      preferredDepartmentId !== selectedDepartment.id,
  };
}
