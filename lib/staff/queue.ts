/**
 * Staff dashboard view model (pure, client-safe).
 *
 * Same discipline as the patient side: one pure module builds everything the
 * dashboard shows, so the page (server) and the components agree, and it can be
 * unit tested without a browser or a database.
 *
 * This file must stay free of server imports: it is bundled into the browser.
 * Database loading lives in lib/staff/load.ts (server-only).
 */

import type { QueueEntryRow } from "../database.types.ts";
import {
  getAvailableActions,
  isActiveStatus,
  QUEUE_STATUS_LABELS,
  type QueueAction,
} from "../queue/status.ts";
import { compareQueueOrder } from "../patient/position.ts";
import type { IsoTimestamp, QueueStatus } from "../types";

/** The clinic the demo staff context is working in. */
export interface StaffClinic {
  id: string;
  name: string;
}

/** A department offered in the staff department selector. */
export interface StaffDepartmentOption {
  id: string;
  name: string;
  code: string;
}

/**
 * A queue entry as staff see it.
 *
 * Includes the patient's display name (staff must be able to call someone by
 * name) but never the phone number, notes or any clinical field.
 */
export interface StaffQueueEntry {
  id: string;
  tokenNumber: number;
  status: QueueStatus;
  statusLabel: string;
  priority: boolean;
  roomLabel: string | null;
  patientName: string | null;
  joinedAt: IsoTimestamp;
  calledAt: IsoTimestamp | null;
  consultationStartedAt: IsoTimestamp | null;
  completedAt: IsoTimestamp | null;
  /** Whole minutes in the queue, only meaningful while WAITING. */
  waitMinutes: number | null;
  /** Whole minutes since the current status began (waiting, called, or in consultation). */
  elapsedMinutes: number | null;
}

export interface StaffStats {
  waiting: number;
  called: number;
  inConsultation: number;
  completedToday: number;
  noShowToday: number;
}

export interface StaffDashboardView {
  stats: StaffStats;
  /** WAITING entries only, in the order the database would call them. */
  waitingQueue: StaffQueueEntry[];
  /** CALLED or IN_CONSULTATION entries, most recent first. */
  activeQueue: StaffQueueEntry[];
  /** The patient the department is dealing with right now, if any. */
  currentPatient: StaffQueueEntry | null;
}

function minutesBetween(fromIso: IsoTimestamp, toIso: IsoTimestamp): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }

  return Math.max(0, Math.round((to - from) / 60_000));
}

/** Maps a queue row (with the patient's name resolved) to the staff view shape. */
export function staffQueueEntryFromRow(
  row: QueueEntryRow,
  options: { patientName?: string | null; nowIso: IsoTimestamp },
): StaffQueueEntry {
  const status = row.status;

  // The anchor depends on the status: how long they have been waiting, how long
  // ago they were called, or how long they have been with the doctor.
  const elapsedAnchor =
    status === "WAITING"
      ? row.joined_at
      : status === "CALLED"
        ? row.called_at
        : status === "IN_CONSULTATION"
          ? row.consultation_started_at
          : null;

  return {
    id: row.id,
    tokenNumber: row.token_number,
    status,
    statusLabel: QUEUE_STATUS_LABELS[status] ?? String(status),
    priority: row.priority === true,
    roomLabel: row.room_label,
    patientName: options.patientName ?? null,
    joinedAt: row.joined_at,
    calledAt: row.called_at,
    consultationStartedAt: row.consultation_started_at,
    completedAt: row.completed_at,
    waitMinutes:
      status === "WAITING" ? minutesBetween(row.joined_at, options.nowIso) : null,
    elapsedMinutes: elapsedAnchor
      ? minutesBetween(elapsedAnchor, options.nowIso)
      : null,
  };
}

/**
 * Canonical call order. Delegates to the same comparator the patient position
 * and the database use (priority desc, joined_at asc, token_number asc), so the
 * list staff read is exactly the order Call Next will follow.
 */
export function orderStaffQueue(
  entries: readonly StaffQueueEntry[],
): StaffQueueEntry[] {
  return [...entries].sort(compareQueueOrder);
}

function earliestBy(
  entries: readonly StaffQueueEntry[],
  pick: (entry: StaffQueueEntry) => IsoTimestamp | null,
): StaffQueueEntry {
  return [...entries].sort((a, b) => {
    const aTime = Date.parse(pick(a) ?? a.joinedAt);
    const bTime = Date.parse(pick(b) ?? b.joinedAt);
    const aSafe = Number.isFinite(aTime) ? aTime : 0;
    const bSafe = Number.isFinite(bTime) ? bTime : 0;
    return aSafe - bSafe || a.tokenNumber - b.tokenNumber;
  })[0];
}

/**
 * The patient being served right now.
 *
 * A live consultation wins over a called patient: if someone is with the doctor,
 * that is the department's current focus.
 */
export function pickCurrentPatient(
  entries: readonly StaffQueueEntry[],
): StaffQueueEntry | null {
  const inConsultation = entries.filter(
    (entry) => entry.status === "IN_CONSULTATION",
  );

  if (inConsultation.length > 0) {
    return earliestBy(
      inConsultation,
      (entry) => entry.consultationStartedAt ?? entry.calledAt,
    );
  }

  const called = entries.filter((entry) => entry.status === "CALLED");

  if (called.length > 0) {
    return earliestBy(called, (entry) => entry.calledAt);
  }

  return null;
}

/** Counts are derived from the same rows the list renders — never invented. */
export function buildStaffDashboardView(
  entries: readonly StaffQueueEntry[],
): StaffDashboardView {
  const stats: StaffStats = {
    waiting: 0,
    called: 0,
    inConsultation: 0,
    completedToday: 0,
    noShowToday: 0,
  };

  for (const entry of entries) {
    switch (entry.status) {
      case "WAITING":
        stats.waiting += 1;
        break;
      case "CALLED":
        stats.called += 1;
        break;
      case "IN_CONSULTATION":
        stats.inConsultation += 1;
        break;
      case "COMPLETED":
        stats.completedToday += 1;
        break;
      case "NO_SHOW":
        stats.noShowToday += 1;
        break;
    }
  }

  return {
    stats,
    waitingQueue: orderStaffQueue(
      entries.filter((entry) => entry.status === "WAITING"),
    ),
    activeQueue: orderStaffQueue(
      entries.filter(
        (entry) => isActiveStatus(entry.status) && entry.status !== "WAITING",
      ),
    ),
    currentPatient: pickCurrentPatient(entries),
  };
}

/* --------------------------- Staff action policy --------------------------- */
/*
 * Which actions the dashboard offers for each status.
 *
 * Legality is NOT decided here: `getAvailableActions()` in lib/queue/status.ts
 * (mirrored by the database trigger) is the single source of truth. A unit test
 * asserts that every descriptor below is legal, so the UI can never offer a move
 * the database would reject.
 *
 * Two deliberate UI choices:
 *  - The database also permits WAITING -> NO_SHOW, but the dashboard does not
 *    offer it: a patient who has not been called yet has not "not turned up".
 *  - Requeue is offered only from CALLED (CALLED -> WAITING), matching the single
 *    requeue edge in the state machine. Terminal states expose no actions.
 */

export type StaffActionTone = "primary" | "neutral" | "danger";

export interface StaffActionDescriptor {
  action: QueueAction;
  label: string;
  tone: StaffActionTone;
  /** When present the UI must confirm first. `{token}` is replaced when rendered. */
  confirmMessage?: string;
}

const STAFF_ACTION_POLICY: Readonly<
  Record<QueueStatus, readonly StaffActionDescriptor[]>
> = {
  WAITING: [
    { action: "CALL", label: "Call patient", tone: "primary" },
  ],
  CALLED: [
    {
      action: "START_CONSULTATION",
      label: "Start consultation",
      tone: "primary",
    },
    {
      action: "REQUEUE",
      label: "Requeue",
      tone: "neutral",
      confirmMessage: "Return {token} to the waiting queue?",
    },
    {
      action: "NO_SHOW",
      label: "No show",
      tone: "danger",
      confirmMessage:
        "Mark {token} as no-show? The patient would need to rejoin the queue.",
    },
  ],
  IN_CONSULTATION: [
    { action: "COMPLETE", label: "Complete consultation", tone: "primary" },
  ],
  COMPLETED: [],
  NO_SHOW: [],
};

export function getStaffActions(
  status: QueueStatus,
): readonly StaffActionDescriptor[] {
  return STAFF_ACTION_POLICY[status] ?? [];
}

/** The single most important action for a status (the big button). */
export function getPrimaryStaffAction(
  status: QueueStatus,
): StaffActionDescriptor | null {
  return getStaffActions(status).find((action) => action.tone === "primary") ?? null;
}

/** True when the shared state machine permits this action from this status. */
export function isStaffActionLegal(
  action: QueueAction,
  status: QueueStatus,
): boolean {
  return getAvailableActions(status).includes(action);
}

/** Fills `{token}` in a confirmation message, e.g. "Mark #008 as no-show?". */
export function formatConfirmation(
  template: string,
  tokenLabel: string,
): string {
  return template.replace("{token}", tokenLabel);
}

/**
 * Natural sentence for how long a patient has been in their current state,
 * e.g. "Waiting for 32 min" · "Called 5 min ago" · "With the doctor for 6 min".
 */
export function getElapsedSentence(
  status: QueueStatus,
  minutesLabel: string,
): string {
  switch (status) {
    case "WAITING":
      return `Waiting for ${minutesLabel}`;
    case "CALLED":
      return `Called ${minutesLabel} ago`;
    case "IN_CONSULTATION":
      return `With the doctor for ${minutesLabel}`;
    default:
      return minutesLabel;
  }
}

