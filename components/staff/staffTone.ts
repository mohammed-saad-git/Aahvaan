import { QUEUE_STATUS_LABELS } from "../../lib/queue/status.ts";
import type { QueueStatus } from "../../lib/types.ts";

/**
 * Staff-side status styling.
 *
 * The LABELS come from lib/queue/status.ts — the same vocabulary the patient
 * screen and the database use. Only the visual tone differs: the dashboard is an
 * operational tool, so it uses higher-contrast chips than the patient's calm,
 * low-saturation cards.
 */
export interface StaffStatusTone {
  label: string;
  /** Small chip. */
  chip: string;
  /** Solid dot colour. */
  dot: string;
}

export const STAFF_STATUS_TONE: Readonly<Record<QueueStatus, StaffStatusTone>> = {
  WAITING: {
    label: QUEUE_STATUS_LABELS.WAITING,
    chip: "border-slate-200 bg-slate-50 text-slate-600",
    dot: "bg-slate-400",
  },
  CALLED: {
    label: QUEUE_STATUS_LABELS.CALLED,
    chip: "border-blue-200 bg-blue-50 text-blue-700",
    dot: "bg-blue-600",
  },
  IN_CONSULTATION: {
    label: QUEUE_STATUS_LABELS.IN_CONSULTATION,
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-600",
  },
  COMPLETED: {
    label: QUEUE_STATUS_LABELS.COMPLETED,
    chip: "border-slate-200 bg-slate-100 text-slate-500",
    dot: "bg-slate-300",
  },
  NO_SHOW: {
    label: QUEUE_STATUS_LABELS.NO_SHOW,
    chip: "border-rose-200 bg-rose-50 text-rose-700",
    dot: "bg-rose-500",
  },
};

/**
 * Priority badge. Priority is set only by an explicit staff action and is never
 * inferred by the system, so the dashboard merely displays the existing flag.
 */
export const PRIORITY_CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800";

export const ACTION_BUTTON_BASE =
  "inline-flex items-center justify-center rounded-lg text-sm font-semibold transition-colors focus:ring-2 focus:ring-teal-600/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export const ACTION_TONE_CLASS = {
  primary:
    "bg-teal-700 px-4 py-2.5 text-white shadow-sm hover:bg-teal-800 disabled:bg-slate-300",
  neutral:
    "border border-slate-300 bg-white px-3.5 py-2.5 text-slate-700 hover:border-slate-400 hover:bg-slate-50",
  danger:
    "border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-rose-700 hover:border-rose-300 hover:bg-rose-100",
  dangerSolid: "bg-rose-600 px-4 py-2.5 text-white shadow-sm hover:bg-rose-700",
} as const;
