import { formatMinutes, formatTokenNumber } from "../../lib/format.ts";
import type { StaffQueueEntry } from "../../lib/staff/queue.ts";
import { EntryActions } from "./EntryActions";
import { PRIORITY_CHIP_CLASS, STAFF_STATUS_TONE } from "./staffTone";

/**
 * Everyone still waiting, in the exact order Call Next will follow.
 *
 * Rows are anonymous queue entries first (token + name + wait), never medical
 * information. Priority is displayed only; it is set by staff, never inferred.
 */
export function WaitingQueueList({
  entries,
}: {
  entries: readonly StaffQueueEntry[];
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Waiting
        </h2>
        <span className="text-xs font-medium text-slate-500">
          {entries.length === 0 ? "Empty" : `${entries.length} in line`}
        </span>
      </header>

      {entries.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">
          No patients are waiting in this department.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="font-mono text-lg font-semibold tabular-nums text-slate-900">
                  {formatTokenNumber(entry.tokenNumber)}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-800">
                      {entry.patientName ?? "Patient"}
                    </span>
                    {entry.priority ? (
                      <span className={PRIORITY_CHIP_CLASS}>⚡ Priority</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-500">
                    {STAFF_STATUS_TONE[entry.status].label}
                    {entry.waitMinutes !== null
                      ? ` · waiting ${formatMinutes(entry.waitMinutes)}`
                      : ""}
                  </p>
                </div>
              </div>

              <EntryActions
                entryId={entry.id}
                tokenNumber={entry.tokenNumber}
                status={entry.status}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
