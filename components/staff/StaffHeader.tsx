import type { ReactNode } from "react";

/**
 * Staff dashboard header.
 *
 * The product wordmark, the clinic, and an explicit "demo staff mode" badge —
 * because there is no authentication yet and this must not look like a signed-in
 * production session.
 */
export function StaffHeader({
  clinicName,
  children,
}: {
  clinicName: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
      <div className="flex items-center gap-4">
        <span className="text-lg font-semibold tracking-[0.2em] text-slate-900">
          AAHVAAN
        </span>
        <span
          aria-hidden="true"
          className="hidden h-6 w-px bg-slate-200 sm:block"
        />
        <div>
          <p className="text-sm font-semibold text-slate-800">{clinicName}</p>
          <p className="text-xs text-slate-500">Staff dashboard</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
          Demo staff mode · no sign-in
        </span>
        {children}
      </div>
    </header>
  );
}

/** Live counts for the selected department. Values come straight from the rows. */
export function StatCards({
  stats,
}: {
  stats: {
    waiting: number;
    called: number;
    inConsultation: number;
    completedToday: number;
  };
}) {
  const tiles = [
    { key: "waiting", label: "Waiting", value: stats.waiting, tone: "text-slate-900" },
    { key: "called", label: "Called", value: stats.called, tone: "text-blue-700" },
    {
      key: "inConsultation",
      label: "In consultation",
      value: stats.inConsultation,
      tone: "text-emerald-700",
    },
    {
      key: "completedToday",
      label: "Completed today",
      value: stats.completedToday,
      tone: "text-slate-600",
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.key}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"
        >
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {tile.label}
          </dt>
          <dd className={`mt-1.5 text-2xl font-semibold tabular-nums ${tile.tone}`}>
            {tile.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
