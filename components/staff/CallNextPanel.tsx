"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { formatTokenNumber } from "../../lib/format.ts";
import { callNextAction } from "../../lib/staff/actions.ts";
import { ACTION_BUTTON_BASE } from "./staffTone";

const MAX_ROOM_LABEL_LENGTH = 40;

/**
 * The page-level primary action.
 *
 * Queue advancement happens inside the database (`call_next_queue_entry` with
 * FOR UPDATE SKIP LOCKED) — the browser never picks the next patient itself, so
 * two staff clicking at once can never call the same person.
 */
export function CallNextPanel({
  departmentId,
  waitingCount,
}: {
  departmentId: string;
  waitingCount: number;
}) {
  const router = useRouter();
  const [roomLabel, setRoomLabel] = useState("");
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{
    tone: "info" | "error";
    message: string;
  } | null>(null);

  function handleCallNext() {
    setNotice(null);

    startTransition(async () => {
      const result = await callNextAction({ departmentId, roomLabel });

      if (!result.ok) {
        setNotice({
          tone: "error",
          message: result.message ?? "Something went wrong. Please try again.",
        });
        return;
      }

      if (result.tokenNumber === null || result.tokenNumber === undefined) {
        // An empty queue is normal, not an error.
        setNotice({ tone: "info", message: "No patients waiting." });
        return;
      }

      const room = roomLabel.trim();

      setNotice({
        tone: "info",
        message: `Called ${formatTokenNumber(result.tokenNumber)}${
          room ? ` to ${room}` : ""
        }.`,
      });

      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Call next
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        {waitingCount === 0
          ? "Nobody is waiting right now"
          : `${waitingCount} patient${waitingCount === 1 ? "" : "s"} waiting`}
      </p>

      <label
        htmlFor="room-label"
        className="mt-4 block text-xs font-semibold text-slate-600"
      >
        Room
      </label>
      <input
        id="room-label"
        type="text"
        value={roomLabel}
        maxLength={MAX_ROOM_LABEL_LENGTH}
        disabled={isPending}
        placeholder="e.g. Room 2"
        onChange={(event) => setRoomLabel(event.target.value)}
        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:opacity-60"
      />

      <button
        type="button"
        onClick={handleCallNext}
        disabled={isPending}
        className={`mt-4 w-full ${ACTION_BUTTON_BASE} bg-slate-900 px-4 py-3.5 text-base tracking-wide text-white shadow-sm hover:bg-slate-800 disabled:bg-slate-300`}
      >
        {isPending ? "Calling next…" : "CALL NEXT"}
      </button>

      {notice ? (
        <p
          role="status"
          className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${
            notice.tone === "error"
              ? "border border-rose-200 bg-rose-50 text-rose-700"
              : "border border-slate-200 bg-slate-50 text-slate-600"
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      <p className="mt-3 text-[11px] leading-5 text-slate-400">
        The queue advances inside the database, so the patient&rsquo;s phone
        updates by itself.
      </p>
    </section>
  );
}
