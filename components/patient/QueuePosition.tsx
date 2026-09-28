import type { PatientQueueView } from "../../lib/patient/queue.ts";

/**
 * The number the patient cares about most.
 *
 * Only shown while the patient is actually waiting: once they have been called,
 * the status card's headline ("You're up next", "You're with the doctor", ...)
 * is the message they need, so repeating a count here would just add noise.
 */
export function QueuePosition({ view }: { view: PatientQueueView }) {
  if (view.status !== "WAITING") {
    return null;
  }

  const isNext = view.peopleAhead <= 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Your place in the line
      </p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
        {view.peopleAheadLabel}
      </p>
      <p className="mt-1.5 text-xs leading-5 text-slate-500">
        {isNext
          ? "Please stay nearby — you’ll be called next."
          : "This updates by itself as the queue moves."}
      </p>
    </section>
  );
}
