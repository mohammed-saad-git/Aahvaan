import { formatMinutes, formatTokenNumber } from "../../lib/format.ts";
import {
  getElapsedSentence,
  type StaffQueueEntry,
} from "../../lib/staff/queue.ts";
import { EntryActions } from "./EntryActions";
import { PRIORITY_CHIP_CLASS, STAFF_STATUS_TONE } from "./staffTone";

/**
 * The patient the department is dealing with right now. This card dominates the
 * dashboard on purpose: it is the thing staff look at while working.
 */
export function CurrentPatientCard({
  entry,
}: {
  entry: StaffQueueEntry | null;
}) {
  if (!entry) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-6">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Now serving
        </h2>
        <p className="mt-3 text-lg font-semibold text-slate-700">
          No patient is being served
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Use Call next to bring the next waiting patient forward.
        </p>
      </section>
    );
  }

  const tone = STAFF_STATUS_TONE[entry.status];
  const elapsedLabel = formatMinutes(entry.elapsedMinutes);

  return (
    <section className="rounded-2xl border border-slate-300 bg-white p-6 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Now serving
          </h2>
          <p className="mt-1 font-mono text-5xl font-semibold tabular-nums text-slate-900">
            {formatTokenNumber(entry.tokenNumber)}
          </p>
          {entry.patientName ? (
            <p className="mt-1 text-sm font-medium text-slate-600">
              {entry.patientName}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone.chip}`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${tone.dot}`}
            />
            {tone.label}
          </span>
          {entry.priority ? (
            <span className={PRIORITY_CHIP_CLASS}>⚡ Priority</span>
          ) : null}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Room
          </dt>
          <dd className="mt-0.5 text-sm font-semibold text-slate-900">
            {entry.roomLabel ?? "—"}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Elapsed
          </dt>
          <dd className="mt-0.5 text-sm font-semibold text-slate-900">
            {elapsedLabel
              ? getElapsedSentence(entry.status, elapsedLabel)
              : "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-5">
        <EntryActions
          entryId={entry.id}
          tokenNumber={entry.tokenNumber}
          status={entry.status}
          variant="primary"
        />
      </div>
    </section>
  );
}
