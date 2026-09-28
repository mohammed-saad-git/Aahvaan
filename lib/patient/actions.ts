"use server";

/**
 * The patient's only mutation: joining a queue.
 *
 * Runs entirely on the server with the privileged client, so SUPABASE_SECRET_KEY
 * never reaches the browser. Token allocation is NOT done here — the database's
 * `join_queue()` RPC issues the token atomically.
 *
 * Every failure returns a human-readable `message`. Postgres/SQL text is logged
 * server-side only and never shown to a patient.
 */

import { createPrivilegedSupabaseClient } from "../supabase/server.ts";
import {
  isUuid,
  parsePatientPhone,
  sanitizeDisplayName,
  toPatientLanguage,
} from "./queue.ts";

export interface JoinQueueInput {
  clinicId: string;
  departmentId: string;
  displayName: string;
  phone: string;
  language: string;
}

export type JoinQueueResult =
  | { ok: true; queueEntryId: string }
  | { ok: false; message: string };

interface DepartmentGuardRow {
  id: string;
  clinic_id: string;
  is_active: boolean;
}

export async function joinQueueAction(
  input: JoinQueueInput,
): Promise<JoinQueueResult> {
  const clinicId = input?.clinicId;
  const departmentId = input?.departmentId;

  if (!isUuid(clinicId) || !isUuid(departmentId)) {
    return {
      ok: false,
      message:
        "This queue link looks incomplete. Please scan the clinic's QR code again.",
    };
  }

  const displayName = sanitizeDisplayName(input?.displayName);

  if (!displayName) {
    return {
      ok: false,
      message: "Please enter your name so the clinic knows who to call.",
    };
  }

  const phone = parsePatientPhone(input?.phone);

  if (!phone.ok) {
    return {
      ok: false,
      message:
        "That phone number doesn't look right. Please check it, or leave it blank.",
    };
  }

  const language = toPatientLanguage(input?.language);
  const supabase = createPrivilegedSupabaseClient();

  // The department must belong to the clinic named in the URL and must be open.
  // Without this, a tampered request could join another clinic's queue.
  const { data: departmentData, error: departmentError } = await supabase
    .from("departments")
    .select("id, clinic_id, is_active")
    .eq("id", departmentId)
    .maybeSingle();

  if (departmentError) {
    console.error(
      "[patient] joinQueueAction/department:",
      departmentError.message,
    );
    return {
      ok: false,
      message: "We couldn't reach the clinic's queue just now. Please try again.",
    };
  }

  const department = (departmentData as DepartmentGuardRow | null) ?? null;

  if (!department || department.clinic_id !== clinicId) {
    return {
      ok: false,
      message: "That department isn't available at this clinic.",
    };
  }

  if (!department.is_active) {
    return {
      ok: false,
      message: "This department isn't accepting patients at the moment.",
    };
  }

  const { data, error } = await supabase.rpc("join_queue", {
    p_department_id: departmentId,
    p_display_name: displayName,
    p_phone: phone.value,
    p_preferred_language: language,
  });

  if (error) {
    console.error("[patient] joinQueueAction/join_queue:", error.message);
    return {
      ok: false,
      message:
        "We couldn't add you to the queue. Please speak to the reception desk.",
    };
  }

  const created = (Array.isArray(data) ? data[0] : data) as
    | { id: string }
    | null;

  if (!created?.id) {
    console.error("[patient] joinQueueAction: join_queue returned no entry");
    return {
      ok: false,
      message:
        "We couldn't add you to the queue. Please speak to the reception desk.",
    };
  }

  return { ok: true, queueEntryId: created.id };
}
