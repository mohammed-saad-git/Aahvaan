import { QUEUE_STATUS_LABELS } from "../../lib/queue/status.ts";
import type { QueueStatus } from "../../lib/types.ts";

/**
 * Single source of patient-facing status styling.
 *
 * The LABELS come from lib/queue/status.ts so the patient screen, the staff
 * dashboard (later) and the database all describe a status identically. Only the
 * visual tone is chosen here.
 */
export interface StatusTone {
  label: string;
  /** Pill: bordered, low-saturation tint. */
  pill: string;
  /** Solid dot colour. */
  dot: string;
  /** Soft background used by the big status card. */
  surface: string;
}

export const STATUS_TONE: Readonly<Record<QueueStatus, StatusTone>> = {
  WAITING: {
    label: QUEUE_STATUS_LABELS.WAITING,
    pill: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    surface: "bg-amber-50/70",
  },
  CALLED: {
    label: QUEUE_STATUS_LABELS.CALLED,
    pill: "border-blue-200 bg-blue-50 text-blue-800",
    dot: "bg-blue-600",
    surface: "bg-blue-50/70",
  },
  IN_CONSULTATION: {
    label: QUEUE_STATUS_LABELS.IN_CONSULTATION,
    pill: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-600",
    surface: "bg-emerald-50/70",
  },
  COMPLETED: {
    label: QUEUE_STATUS_LABELS.COMPLETED,
    pill: "border-slate-200 bg-slate-100 text-slate-700",
    dot: "bg-slate-400",
    surface: "bg-slate-100/70",
  },
  NO_SHOW: {
    label: QUEUE_STATUS_LABELS.NO_SHOW,
    pill: "border-rose-200 bg-rose-50 text-rose-800",
    dot: "bg-rose-500",
    surface: "bg-rose-50/70",
  },
};
