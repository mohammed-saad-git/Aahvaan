import type { PatientQueueView } from "../../lib/patient/queue.ts";

/**
 * Estimated wait, always as a range.
 *
 * The basis is shown so the number is honest rather than mysterious: how long a
 * consultation has recently taken, and how many people are still ahead.
 * Only rendered while the patient is genuinely waiting.
 */
export function EtaDisplay({ view }: { view: PatientQueueView }) {
  if (!view.showEta) {
    return null;
  }

  const perPatient = Math.round(view.eta.averageMinutes);

  const basis = view.eta.usedFallback
    ? "≈ " + perPatient + " min per patient (typical, while this department builds history)"
    : "≈ " + perPatient + " min per patient (recent consultations here)";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Estimated wait
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-slate-900">
        {view.eta.label}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        Based on {basis} and {view.peopleAheadLabel.toLowerCase()}. This is an
        estimate, not a guarantee.
      </p>
    </section>
  );
}
