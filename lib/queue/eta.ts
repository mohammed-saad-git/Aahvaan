/**
 * Transparent estimated-wait calculation.
 *
 * Deliberately simple and explainable — no machine learning, no forecasting:
 *
 *   1. average the durations of the most recent completed consultations
 *      in the department;
 *   2. multiply that average by the number of patients still ahead;
 *   3. return a RANGE, never a single "promised" number.
 *
 * Example: recent durations [12, 10, 15, 11, 13] -> average 12.2 min.
 * With 3 patients ahead -> ~36.6 min -> reported as "30–40 min".
 *
 * Wording in the UI must always present this as an estimate, e.g.
 * `Estimated wait: 30–40 min`.
 *
 * Pure functions only: no I/O, no clock access, no randomness, so this file is
 * fully unit testable.
 */

/** Tunable defaults. Exposed so the UI/RPC layer can document what it uses. */
export const ETA_DEFAULTS = {
  /** How many recent completed consultations feed the average. */
  sampleSize: 5,
  /** Used when there is not enough (or no) history. */
  fallbackMinutes: 12,
  /** Half-width of the reported range, as a fraction of the estimate. */
  spreadRatio: 0.2,
  /** Hard ceiling: beyond this we report an open-ended "4 hr+" instead. */
  maxEstimateMinutes: 240,
} as const;

/** Shown when nobody is ahead of the patient. */
export const NO_WAIT_LABEL = "No wait";

const MINUTES_PER_HOUR = 60;
/** Estimates at or above this value switch from minutes to hours. */
const HOURS_LABEL_THRESHOLD = 120;
/** Rounding granularity: fine-grained for short waits, coarser for long ones. */
const STEP_LARGE_MINUTES = 10;
const STEP_SMALL_MINUTES = 5;
const STEP_LARGE_FROM_MINUTES = 20;

export interface EtaInput {
  /** Number of patients still ahead of this patient (0 = next). */
  peopleAhead: number;
  /**
   * Durations in minutes of recently completed consultations, ordered
   * MOST RECENT FIRST. Only the leading `sampleSize` usable values are used.
   * Unusable values (negative, zero, NaN, Infinity) are ignored.
   */
  recentConsultationMinutes: readonly number[];
  /** Overrides `ETA_DEFAULTS.fallbackMinutes`. Ignored if not a positive finite number. */
  fallbackMinutes?: number;
  /** Overrides `ETA_DEFAULTS.sampleSize`. Ignored if not >= 1. */
  sampleSize?: number;
}

export interface EtaEstimate {
  /** Lower bound of the estimate, in whole minutes. */
  minMinutes: number;
  /** Upper bound of the estimate, in whole minutes. */
  maxMinutes: number;
  /** Ready-to-display range, e.g. `30–40 min`, `2–3 hr`, `No wait`, `4 hr+`. */
  label: string;
  /** The per-patient average actually used (history average, or the fallback). */
  averageMinutes: number;
  /** How many historical durations were actually used. */
  sampleCount: number;
  /** True when no usable history existed and the fallback was used. */
  usedFallback: boolean;
  /** Echo of the normalised `peopleAhead`. */
  peopleAhead: number;
}

function isUsableDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Rounds to the nearest `step`; returns 0 for non-finite input. */
function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value / step) * step;
}

function roundToTenths(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    // NaN -> keeps the lower bound; +Infinity -> saturates at the ceiling.
    return value === Infinity ? max : min;
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * Coerces a possibly non-finite bound into a usable number.
 *
 * Non-finite upper bounds saturate at the supplied fallback (the ceiling) so
 * that an uncomputable wait is never presented as "No wait".
 */
function toFiniteBound(value: number, fallback: number): number {
  if (Number.isFinite(value)) {
    return value;
  }
  return value === Number.NEGATIVE_INFINITY ? 0 : fallback;
}

function normalizePeopleAhead(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(Math.floor(value), 0), 10_000);
}

function normalizeSampleSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return ETA_DEFAULTS.sampleSize;
  }
  return Math.floor(value);
}

function normalizeFallback(value: unknown): number {
  return isPositiveFinite(value) ? value : ETA_DEFAULTS.fallbackMinutes;
}

/** Formats whole minutes as a compact hour value: 180 -> "3", 150 -> "2.5". */
function formatHours(minutes: number): string {
  const hours = Math.round((minutes / MINUTES_PER_HOUR) * 2) / 2;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/**
 * Formats a minute range for display.
 *
 * `(30, 40)` -> `"30–40 min"` · `(180, 240)` -> `"3–4 hr"` · `(0, 0)` -> `"No wait"`
 */
export function formatRangeLabel(
  minMinutes: number,
  maxMinutes: number,
): string {
  // Unknown bounds saturate at the ceiling: an uncomputable wait must never be
  // presented to a patient as "No wait".
  const min = Math.max(0, roundToStep(toFiniteBound(minMinutes, 0), 1));
  const max = Math.max(
    0,
    roundToStep(toFiniteBound(maxMinutes, ETA_DEFAULTS.maxEstimateMinutes), 1),
  );

  if (max <= 0) {
    return NO_WAIT_LABEL;
  }

  if (max < HOURS_LABEL_THRESHOLD) {
    return `${min}–${max} min`;
  }

  return `${formatHours(min)}–${formatHours(max)} hr`;
}

/**
 * Averages the most recent usable consultation durations.
 *
 * Returns `null` when there is no usable history (the caller should then fall
 * back to `ETA_DEFAULTS.fallbackMinutes`).
 */
export function averageConsultationMinutes(
  durations: readonly number[],
  options: { sampleSize?: number } = {},
): number | null {
  const sampleSize = normalizeSampleSize(options.sampleSize);
  const usable = (durations ?? []).filter(isUsableDuration).slice(0, sampleSize);

  if (usable.length === 0) {
    return null;
  }

  const total = usable.reduce((sum, value) => sum + value, 0);
  const average = total / usable.length;

  return Number.isFinite(average) ? average : null;
}

/**
 * Estimates the remaining wait for a patient.
 *
 * Always returns finite numbers and a non-empty label, for any input —
 * including zero patients ahead, no history, a single history entry,
 * negative/NaN/Infinity durations, and absurdly large queues.
 */
export function estimateWait(input: EtaInput): EtaEstimate {
  const peopleAhead = normalizePeopleAhead(input?.peopleAhead);

  if (peopleAhead === 0) {
    return {
      minMinutes: 0,
      maxMinutes: 0,
      label: NO_WAIT_LABEL,
      averageMinutes: 0,
      sampleCount: 0,
      usedFallback: false,
      peopleAhead: 0,
    };
  }

  const sampleSize = normalizeSampleSize(input?.sampleSize);
  const usableDurations = (input?.recentConsultationMinutes ?? [])
    .filter(isUsableDuration)
    .slice(0, sampleSize);

  const fallbackMinutes = normalizeFallback(input?.fallbackMinutes);
  const usedFallback = usableDurations.length === 0;

  const averageMinutes = usedFallback
    ? fallbackMinutes
    : usableDurations.reduce((sum, value) => sum + value, 0) /
      usableDurations.length;

  const cap = ETA_DEFAULTS.maxEstimateMinutes;
  const etaMinutes = clamp(averageMinutes * peopleAhead, 0, cap);

  const baseResult = {
    averageMinutes: roundToTenths(averageMinutes),
    sampleCount: usableDurations.length,
    usedFallback,
    peopleAhead,
  };

  // Absurdly long queue (or absurdly long consultations): report an open-ended
  // ceiling rather than a fake precise band.
  if (etaMinutes >= cap) {
    return {
      ...baseResult,
      minMinutes: cap,
      maxMinutes: cap,
      label: `${formatHours(cap)} hr+`,
    };
  }

  const spread = etaMinutes * ETA_DEFAULTS.spreadRatio;
  const step =
    etaMinutes >= STEP_LARGE_FROM_MINUTES
      ? STEP_LARGE_MINUTES
      : STEP_SMALL_MINUTES;

  let min = clamp(roundToStep(etaMinutes - spread, step), 0, cap);
  let max = clamp(roundToStep(etaMinutes + spread, step), 0, cap);

  // Rounding can collapse the band (e.g. a 20 minute estimate). Widen it so the
  // UI always has a range to show.
  if (max <= min) {
    max = clamp(min + step, 0, cap);
  }
  if (max <= min) {
    min = Math.max(0, max - step);
  }

  return {
    ...baseResult,
    minMinutes: min,
    maxMinutes: max,
    label: formatRangeLabel(min, max),
  };
}
