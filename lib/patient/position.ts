/**
 * Pure queue-position maths for the patient experience.
 *
 * The ordering rules here MUST match the database
 * (`call_next_queue_entry` orders by `priority desc, joined_at asc,
 * token_number asc`). Keeping this in one pure module means the patient screen
 * computes exactly the same "who is ahead of me" answer the queue engine acts
 * on, and it can be unit tested without a database or a browser.
 */

import type { IsoTimestamp, QueueStatus } from "../types";

/** The minimum an entry needs to be ordered and counted. */
export interface QueuePositionEntry {
  id: string;
  tokenNumber: number;
  status: QueueStatus;
  priority: boolean;
  joinedAt: IsoTimestamp;
}

/**
 * Canonical queue order: staff-controlled priority first, then arrival order,
 * then token number as a final deterministic tie-break.
 */
export function compareQueueOrder(
  a: QueuePositionEntry,
  b: QueuePositionEntry,
): number {
  if (a.priority !== b.priority) {
    return a.priority ? -1 : 1;
  }

  const aJoined = Date.parse(a.joinedAt);
  const bJoined = Date.parse(b.joinedAt);

  if (
    Number.isFinite(aJoined) &&
    Number.isFinite(bJoined) &&
    aJoined !== bJoined
  ) {
    return aJoined - bJoined;
  }

  return a.tokenNumber - b.tokenNumber;
}

export function sortQueueOrder(
  entries: readonly QueuePositionEntry[],
): QueuePositionEntry[] {
  return [...entries].sort(compareQueueOrder);
}

/**
 * How many patients are still ahead of `entryId`.
 *
 * Only entries currently WAITING count: a patient who has already been called
 * or completed is no longer in front of anybody. Priority entries count, and
 * are ordered by the same rule the database uses.
 *
 * Returns 0 when the entry is missing, terminal, or is itself already called —
 * in all of those cases nobody is "ahead" of this patient any more.
 */
export function countPeopleAhead(
  entries: readonly QueuePositionEntry[],
  entryId: string,
): number {
  const waiting = entries.filter((entry) => entry.status === "WAITING");
  const self = waiting.find((entry) => entry.id === entryId);

  if (!self) {
    return 0;
  }

  const index = sortQueueOrder(waiting).findIndex((entry) => entry.id === self.id);

  return Math.max(0, index);
}

/** "You're next" · "1 person ahead" · "3 people ahead" */
export function getPeopleAheadLabel(peopleAhead: number): string {
  if (!Number.isFinite(peopleAhead) || peopleAhead <= 0) {
    return "You're next";
  }
  if (peopleAhead === 1) {
    return "1 person ahead";
  }
  return `${peopleAhead} people ahead`;
}

/**
 * The single big message the patient reads first.
 * Statuses are never shown as raw enum values.
 */
export function getStatusHeadline(
  status: QueueStatus,
  peopleAhead: number,
): string {
  switch (status) {
    case "WAITING":
      return peopleAhead <= 0 ? "You're next" : "You're in the queue";
    case "CALLED":
      return "You're up next";
    case "IN_CONSULTATION":
      return "You're with the doctor";
    case "COMPLETED":
      return "Visit completed";
    case "NO_SHOW":
      return "Queue entry closed";
  }
}

/** The quieter sentence under the headline. */
export function getStatusDetail(
  status: QueueStatus,
  roomLabel: string | null,
): string {
  switch (status) {
    case "WAITING":
      return "You can wait anywhere nearby — this page updates on its own when your turn gets close.";
    case "CALLED":
      return roomLabel
        ? `Please proceed to ${roomLabel}.`
        : "Please proceed to the consultation desk.";
    case "IN_CONSULTATION":
      return "Your consultation is in progress.";
    case "COMPLETED":
      return "Thanks for visiting. Take care.";
    case "NO_SHOW":
      return "This queue entry was closed. Please speak to the reception desk if you still need to be seen.";
  }
}

/** True while the patient is still waiting for their turn. */
export function isWaitingForTurn(
  status: QueueStatus,
  peopleAhead: number,
): boolean {
  return status === "WAITING" && peopleAhead > 0;
}
