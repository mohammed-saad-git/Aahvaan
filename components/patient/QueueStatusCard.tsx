import { formatTokenNumber, type PatientQueueView } from "../../lib/patient/queue.ts";
import { STATUS_TONE } from "./statusTone";

/**
 * The one card the patient reads first: current status, the big token number,
 * and the room once they have been called.
 */
export function QueueStatusCard({ view }: { view: PatientQueueView }) {
  const tone = STATUS_TONE[view.status];
  const showRoom =
    view.roomLabel !== null &&
    (view.status === "CALLED" || view.status === "IN_CONSULTATION");

  return (
    <section
      className={`rounded-3xl border border-slate-200 ${tone.surface} p-6 shadow-sm`}
    >
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${tone.pill}`}
      >
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        {view.statusLabel}
      </span>

      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900">
        {view.headline}
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">{view.detail}</p>

      <div className="mt-6 flex items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Your token
          </p>
          <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-slate-900">
            {formatTokenNumber(view.tokenNumber)}
          </p>
        </div>

        {showRoom ? (
          <div className="text-right">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Room
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {view.roomLabel}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
