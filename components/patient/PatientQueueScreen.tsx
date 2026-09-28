"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { QueueEntryRow } from "../../lib/database.types.ts";
import {
  applyRealtimeQueueChange,
  buildPatientQueueView,
  type PatientQueueSnapshot,
} from "../../lib/patient/queue.ts";
import { getBrowserSupabaseClient } from "../../lib/supabase/browser.ts";
import { EtaDisplay } from "./EtaDisplay";
import { QueuePosition } from "./QueuePosition";
import { QueueStatusCard } from "./QueueStatusCard";
import { QueueTimeline } from "./QueueTimeline";
import { LiveIndicator, type ConnectionState } from "./States";

const REFRESH_DEBOUNCE_MS = 300;

/**
 * The live patient queue screen.
 *
 * Two layers, deliberately:
 *  1. Realtime gives an INSTANT local recompute using the same pure functions the
 *     server used, so the screen changes the moment staff act.
 *  2. A debounced `router.refresh()` then re-fetches authoritative state, so the
 *     view cannot drift if an event was missed.
 *
 * Exactly one subscription exists per screen: the effect is keyed on the
 * department and always removes its channel on unmount.
 */
export function PatientQueueScreen({
  initialSnapshot,
}: {
  initialSnapshot: PatientQueueSnapshot;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<PatientQueueSnapshot>(initialSnapshot);
  const [syncedSnapshot, setSyncedSnapshot] = useState(initialSnapshot);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const hasSubscribedOnce = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // React's documented "adjusting state when a prop changes" pattern: when
  // router.refresh() delivers a fresh authoritative snapshot we adopt it during
  // render rather than in an effect (which would trigger a cascading render).
  // The server value always wins over the optimistic local one.
  if (syncedSnapshot !== initialSnapshot) {
    setSyncedSnapshot(initialSnapshot);
    setSnapshot(initialSnapshot);
  }

  const view = useMemo(() => buildPatientQueueView(snapshot), [snapshot]);

  const scheduleAuthoritativeRefresh = useCallback(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
    }

    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [router]);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();

    const channel = supabase
      .channel(`patient-queue-${snapshot.departmentId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "queue_entries",
          filter: `department_id=eq.${snapshot.departmentId}`,
        },
        (payload) => {
          const row = payload.new as QueueEntryRow;

          setSnapshot((current) => applyRealtimeQueueChange(current, row));
          scheduleAuthoritativeRefresh();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          const isReconnect = hasSubscribedOnce.current;
          hasSubscribedOnce.current = true;
          setConnection("connected");

          if (isReconnect) {
            // Events may have been missed while disconnected: resync.
            router.refresh();
          }
          return;
        }

        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setConnection("reconnecting");
        }
      });

    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [snapshot.departmentId, router, scheduleAuthoritativeRefresh]);

  return (
    <main className="mx-auto w-full max-w-md px-5 pb-14 pt-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-700">
            {view.clinicName}
          </p>
          <h2 className="mt-1 truncate text-sm font-medium text-slate-600">
            {view.departmentName}
          </h2>
        </div>
        <LiveIndicator connection={connection} />
      </header>

      <div className="mt-6 space-y-4">
        <QueueStatusCard view={view} />
        <QueuePosition view={view} />
        <QueueTimeline view={view} />
        <EtaDisplay view={view} />
      </div>

      <footer className="mt-8 text-center">
        <p className="text-xs leading-5 text-slate-500">
          Keep this page open — it updates on its own. You don’t need to wait in
          the waiting room.
        </p>
      </footer>
    </main>
  );
}
