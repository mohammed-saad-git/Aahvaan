import type { ReactNode } from "react";

/**
 * Shared loading and friendly-error primitives, so every asynchronous state in
 * the patient flow looks the same and no screen is ever blank.
 */

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex min-h-[45vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600"
      />
      <p
        role="status"
        aria-live="polite"
        className="text-sm font-medium text-slate-600"
      >
        {label}
      </p>
    </div>
  );
}

export function FriendlyMessage({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col items-center justify-center gap-3 px-6 text-center">
      <div
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-500"
      >
        !
      </div>
      <h1 className="text-lg font-semibold tracking-tight text-slate-900">
        {title}
      </h1>
      {body ? (
        <p className="text-sm leading-6 text-slate-600">{body}</p>
      ) : null}
      {action}
    </div>
  );
}

/** Patient-friendly name for the Realtime connection state. */
export type ConnectionState = "connecting" | "connected" | "reconnecting";

/**
 * Small "Live" indicator.
 *
 * The initial render is always `connecting`, on both server and client, so the
 * markup matches during hydration and there is never a time-formatting mismatch.
 */
export function LiveIndicator({
  connection,
}: {
  connection: ConnectionState;
}) {
  const tone =
    connection === "connected"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : connection === "connecting"
        ? "border-slate-200 bg-slate-50 text-slate-500"
        : "border-amber-200 bg-amber-50 text-amber-800";

  const dot =
    connection === "connected"
      ? "bg-emerald-500"
      : connection === "connecting"
        ? "bg-slate-400"
        : "bg-amber-500";

  const label =
    connection === "connected"
      ? "Live"
      : connection === "connecting"
        ? "Connecting…"
        : "Reconnecting…";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${tone}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
