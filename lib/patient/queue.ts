/**
 * Patient queue view model (client-safe, pure).
 *
 * One module builds the exact object the patient screen renders — used by the
 * SERVER for the first paint and by the BROWSER after a Realtime event. Sharing
 * it means position and ETA can never disagree between the two paths.
 *
 * This file must stay free of server imports: it is bundled into the browser.
 * Database loading lives in lib/patient/load.ts (server-only).
 */

import type { QueueEntryRow } from "../database.types.ts";
import { averageConsultationMinutes, estimateWait, type EtaEstimate } from "../queue/eta.ts";
import {
  isActiveStatus,
  isQueueStatus,
  QUEUE_STATUS_LABELS,
} from "../queue/status.ts";
import type {
  IsoDate,
  IsoTimestamp,
  PatientLanguage,
  QueueStatus,
} from "../types";
import {
  countPeopleAhead,
  getPeopleAheadLabel,
  getStatusDetail,
  getStatusHeadline,
  isWaitingForTurn,
  type QueuePositionEntry,
} from "./position.ts";

/**
 * The only entry fields the patient screen ever sees. Deliberately excludes
 * patient_id, clinic_id, staff ids and timestamps the patient does not need —
 * nothing leaks into the browser that is not displayed.
 */
export interface QueueEntryView {
  id: string;
  tokenNumber: number;
  status: QueueStatus;
  priority: boolean;
  joinedAt: IsoTimestamp;
  roomLabel: string | null;
}

/**
 * Everything the screen needs to render itself, transported from server to
 * client. Small enough to be cheap: the department's active entries (tokens and
 * statuses only) plus the last few consultation durations.
 */
export interface PatientQueueSnapshot {
  clinicName: string;
  departmentName: string;
  departmentId: string;
  tokenDate: IsoDate;
  entry: QueueEntryView;
  queue: QueueEntryView[];
  /** Durations in minutes of recent completed consultations, most recent first. */
  recentConsultationMinutes: number[];
  fallbackMinutes: number;
  sampleSize: number;
  fetchedAt: IsoTimestamp;
}

/** Derived, display-ready patient state. */
export interface PatientQueueView {
  clinicName: string;
  departmentName: string;
  tokenNumber: number;
  status: QueueStatus;
  statusLabel: string;
  headline: string;
  detail: string;
  roomLabel: string | null;
  peopleAhead: number;
  peopleAheadLabel: string;
  showEta: boolean;
  eta: EtaEstimate;
  averageConsultationMinutes: number | null;
  fetchedAt: IsoTimestamp;
}

/** Clinic identity shown to the patient. */
export interface ClinicSummary {
  id: string;
  name: string;
  address: string | null;
}

/** A department offered on the join screen. */
export interface DepartmentSummary {
  id: string;
  name: string;
  code: string;
}

/** The columns needed to build a view. Accepts a full row or a projection. */
export type QueueEntryViewSource = Pick<
  QueueEntryRow,
  | "id"
  | "token_number"
  | "status"
  | "priority"
  | "joined_at"
  | "room_label"
>;

/** Maps a database row (including a Realtime payload) to the safe view shape. */
export function queueEntryViewFromRow(
  row: QueueEntryViewSource,
): QueueEntryView {
  if (!isQueueStatus(row.status)) {
    throw new Error(
      `Unknown queue status received from the database: ${String(row.status)}`,
    );
  }

  return {
    id: row.id,
    tokenNumber: row.token_number,
    status: row.status,
    priority: row.priority,
    joinedAt: row.joined_at,
    roomLabel: row.room_label,
  };
}

function toPositionEntry(entry: QueueEntryView): QueuePositionEntry {
  return {
    id: entry.id,
    tokenNumber: entry.tokenNumber,
    status: entry.status,
    priority: entry.priority,
    joinedAt: entry.joinedAt,
  };
}

/** Builds every displayed value from the snapshot. Pure and deterministic. */
export function buildPatientQueueView(
  snapshot: PatientQueueSnapshot,
): PatientQueueView {
  const peopleAhead = countPeopleAhead(
    snapshot.queue.map(toPositionEntry),
    snapshot.entry.id,
  );

  const status = snapshot.entry.status;

  return {
    clinicName: snapshot.clinicName,
    departmentName: snapshot.departmentName,
    tokenNumber: snapshot.entry.tokenNumber,
    status,
    statusLabel: QUEUE_STATUS_LABELS[status],
    headline: getStatusHeadline(status, peopleAhead),
    detail: getStatusDetail(status, snapshot.entry.roomLabel),
    roomLabel: snapshot.entry.roomLabel,
    peopleAhead,
    peopleAheadLabel: getPeopleAheadLabel(peopleAhead),
    // An estimate is only meaningful while the patient is actually waiting.
    showEta: isWaitingForTurn(status, peopleAhead),
    eta: estimateWait({
      peopleAhead,
      recentConsultationMinutes: snapshot.recentConsultationMinutes,
      fallbackMinutes: snapshot.fallbackMinutes,
      sampleSize: snapshot.sampleSize,
    }),
    averageConsultationMinutes: averageConsultationMinutes(
      snapshot.recentConsultationMinutes,
      { sampleSize: snapshot.sampleSize },
    ),
    fetchedAt: snapshot.fetchedAt,
  };
}

function upsertActiveQueueEntry(
  queue: readonly QueueEntryView[],
  entry: QueueEntryView,
): QueueEntryView[] {
  const withoutEntry = queue.filter((item) => item.id !== entry.id);

  // A finished or no-show entry has left the active queue, so it must not keep
  // influencing anyone's position.
  return isActiveStatus(entry.status) ? [...withoutEntry, entry] : withoutEntry;
}

/**
 * Applies one Realtime change to the snapshot — exactly what the patient screen
 * does when an UPDATE arrives. Pure, so it can be unit tested against payloads
 * captured from the real database.
 *
 * Only WAITING entries count towards "people ahead", so a patient in front of
 * this one being called, or finishing, immediately reduces this patient's count.
 */
export function applyRealtimeQueueChange(
  snapshot: PatientQueueSnapshot,
  row: QueueEntryRow,
): PatientQueueSnapshot {
  if (
    row.department_id !== snapshot.departmentId ||
    row.token_date !== snapshot.tokenDate
  ) {
    return snapshot;
  }

  let changed: QueueEntryView;
  try {
    changed = queueEntryViewFromRow(row);
  } catch {
    // Unrecognised status: ignore the event rather than corrupt the view.
    return snapshot;
  }

  return {
    ...snapshot,
    entry: changed.id === snapshot.entry.id ? changed : snapshot.entry,
    queue: upsertActiveQueueEntry(snapshot.queue, changed),
  };
}

/* -------------------------------- input guards ------------------------------ */
/* Shared by the join form and the server action so both agree on what is valid. */

/**
 * Re-exported from lib/validation.ts, where it now lives so the staff side can
 * share the same guard. Kept exported here so existing imports keep working.
 */
export { isUuid } from "../validation.ts";

export const DISPLAY_NAME_MAX_LENGTH = 80;

/** Collapses whitespace and enforces the length limits. Returns null if unusable. */
export function sanitizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const collapsed = value.replace(/\s+/g, " ").trim();

  if (collapsed.length === 0 || collapsed.length > DISPLAY_NAME_MAX_LENGTH) {
    return null;
  }

  return collapsed;
}

export const PHONE_MAX_LENGTH = 20;

export interface PhoneParseResult {
  ok: boolean;
  value: string | null;
}

/**
 * Phone is optional: an empty value is valid and becomes `null`. A non-empty
 * value must look like a phone number, otherwise the form asks again instead of
 * storing junk.
 */
export function parsePatientPhone(value: unknown): PhoneParseResult {
  const raw = typeof value === "string" ? value.trim() : "";

  if (raw.length === 0) {
    return { ok: true, value: null };
  }
  if (raw.length > PHONE_MAX_LENGTH) {
    return { ok: false, value: null };
  }

  const compact = raw.replace(/[\s\-().]/g, "");

  if (!/^\+?\d{6,15}$/.test(compact)) {
    return { ok: false, value: null };
  }

  return { ok: true, value: raw };
}

/**
 * Re-exported from lib/format.ts, where it now lives so the staff dashboard can
 * share the exact same formatter. Kept exported here so the patient components
 * and tests that already import it from this module keep working.
 */
export { formatTokenNumber } from "../format.ts";

/** Languages the seed and the database CHECK constraint both allow. */
export const PATIENT_LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi · हिंदी" },
  { code: "kn", label: "Kannada · ಕನ್ನಡ" },
] as const satisfies readonly { code: PatientLanguage; label: string }[];

export function toPatientLanguage(value: unknown): PatientLanguage {
  return value === "hi" || value === "kn" ? value : "en";
}

