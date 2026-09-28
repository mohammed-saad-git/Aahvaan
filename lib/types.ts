/**
 * Core domain types for the clinic queue platform.
 *
 * These types describe the *application* view of the data. They are written in
 * camelCase; the database layer (added in P1) is responsible for mapping
 * snake_case Postgres columns onto these shapes.
 *
 * Deliberate constraints:
 * - `status`, `role` and `language` are string-literal unions, not `string`,
 *   so invalid values are rejected at compile time.
 * - Timestamps are ISO-8601 strings because that is what the Supabase client
 *   returns for `timestamptz` columns (and what survives JSON serialisation
 *   between Server Components and Client Components).
 */

/** ISO-8601 timestamp, e.g. `2026-09-28T09:14:03.512Z`. */
export type IsoTimestamp = string;

/** Calendar date (`YYYY-MM-DD`), used for daily token numbering. */
export type IsoDate = string;

/**
 * Lifecycle of a patient in a queue.
 *
 * Valid transitions are defined centrally in `lib/queue/status.ts`.
 * This type never carries medical meaning — it is workflow state only.
 */
export type QueueStatus =
  | "WAITING"
  | "CALLED"
  | "IN_CONSULTATION"
  | "COMPLETED"
  | "NO_SHOW";

/** Role of a staff member. Drives which staff UI a user is shown. */
export type StaffRole = "ADMIN" | "RECEPTIONIST" | "NURSE" | "DOCTOR";

/** Languages the patient UI can be rendered in. Keep in sync with the DB CHECK constraint. */
export type PatientLanguage = "en" | "hi" | "kn";

export interface Organization {
  id: string;
  name: string;
  createdAt: IsoTimestamp;
}

export interface Clinic {
  id: string;
  organizationId: string;
  name: string;
  address: string | null;
  createdAt: IsoTimestamp;
}

export interface Department {
  id: string;
  clinicId: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: IsoTimestamp;
}

/**
 * Minimal patient record.
 *
 * Intentionally holds no clinical data: no symptoms, no diagnosis, no
 * medical history. `phone` is optional — a patient can join with a name only.
 */
export interface Patient {
  id: string;
  name: string;
  phone: string | null;
  language: PatientLanguage;
  createdAt: IsoTimestamp;
}

/**
 * A single patient's presence in one department queue.
 *
 * Note: this row deliberately does NOT store queue position. Position and
 * "people ahead" are always derived from ordering (`priority` then `joinedAt`)
 * at read time, so they can never drift out of sync.
 */
export interface QueueEntry {
  id: string;
  clinicId: string;
  departmentId: string;
  patientId: string;
  /** Per-department, per-day human-readable token, e.g. 14. */
  tokenNumber: number;
  /** Day the token was issued; tokens restart at 1 each day. */
  tokenDate: IsoDate;
  status: QueueStatus;
  /** Set only by an explicit staff action. Never inferred, never automated. */
  priority: boolean;
  /** Free-text note explaining a manual priority flag. Workflow metadata only. */
  priorityReason: string | null;
  /** Room / desk announced when the patient is called, when available. */
  roomLabel: string | null;
  /** Staff member currently handling this entry, if any. */
  assignedStaffId: string | null;
  joinedAt: IsoTimestamp;
  calledAt: IsoTimestamp | null;
  consultationStartedAt: IsoTimestamp | null;
  completedAt: IsoTimestamp | null;
  /**
   * Cached result of the ETA engine at the time the row was last touched.
   * Informational — the live estimate is recomputed from recent consultation
   * durations rather than trusted blindly.
   */
  estimatedWaitMinutes: number | null;
  updatedAt: IsoTimestamp;
}

export interface StaffUser {
  id: string;
  clinicId: string;
  /** Null for clinic-wide staff (e.g. an administrator) who is not tied to one queue. */
  departmentId: string | null;
  name: string;
  role: StaffRole;
  createdAt: IsoTimestamp;
}

/**
 * Audit record for a consultation. Created when a staff member starts a
 * consultation on a queue entry.
 */
export interface Consultation {
  id: string;
  queueEntryId: string;
  /** Null only if the consultation was started without an identified staff member. */
  staffUserId: string | null;
  startedAt: IsoTimestamp;
  completedAt: IsoTimestamp | null;
}
