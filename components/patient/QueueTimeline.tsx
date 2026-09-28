import { formatTokenNumber, type PatientQueueView } from "../../lib/patient/queue.ts";
import { STATUS_TONE } from "./statusTone";

/**
 * A deliberately simple progress picture: you at the top, the people still ahead
 * in the middle, "now serving" at the bottom. No charting library, no animation
 * — the patient should understand it in one glance.
 */
export function QueueTimeline({ view }: { view: PatientQueueView }) {
  const tone = STATUS_TONE[view.status];
  const isWaiting = view.status === "WAITING";
  const hasReachedFront = !isWaiting || view.peopleAhead <= 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Queue progress
      </p>

      <ol className="mt-4">
        <li className="flex items-center gap-3">
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
          <span className="text-sm font-semibold text-slate-900">
            You · token {formatTokenNumber(view.tokenNumber)}
          </span>
        </li>

        <li
          aria-hidden="true"
          className="ml-[4px] h-7 border-l-2 border-dashed border-slate-200"
        />

        <li className="flex items-center gap-3">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-slate-200" />
          <span className="text-sm text-slate-600">
            {isWaiting ? view.peopleAheadLabel : view.statusLabel}
          </span>
        </li>

        <li
          aria-hidden="true"
          className="ml-[4px] h-7 border-l-2 border-dashed border-slate-200"
        />

        <li className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-full ${hasReachedFront ? "bg-emerald-500" : "bg-slate-200"}`}
          />
          <span
            className={`text-sm ${hasReachedFront ? "font-semibold text-slate-900" : "text-slate-500"}`}
          >
            {hasReachedFront ? "It’s your turn now" : "Now serving"}
          </span>
        </li>
      </ol>
    </section>
  );
}
