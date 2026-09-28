"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getBrowserSupabaseClient } from "../../lib/supabase/browser.ts";
import { LiveIndicator, type ConnectionState } from "../ui/States";

const REFRESH_DEBOUNCE_MS = 250;

/**
 * Keeps the staff board live.
 *
 * One subscription per department context, cleaned up on unmount.
 *
 * Two deliberate choices:
 *  - `event: "*"` rather than just UPDATE. A patient joining the queue from a
 *    phone is an INSERT, and the board has to show them immediately. (The patient
 *    screen only needs UPDATE, because a new arrival behind them never changes
 *    their own position.)
 *  - An incoming change triggers a debounced `router.refresh()` instead of a
 *    parallel client-side queue model. The server-rendered board stays the single
 *    source of truth, so counters, list and current patient cannot disagree.
 *
 * The channel is created, bound and subscribed in one synchronous chain: a
 * channel created and subscribed much later can report SUBSCRIBED while attached
 * to an idle socket and never deliver events.
 */
export function StaffConnectionStatus({
  departmentId,
}: {
  departmentId: string;
}) {
  const router = useRouter();
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();

    const channel = supabase
      .channel(`staff-queue-${departmentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "queue_entries",
          filter: `department_id=eq.${departmentId}`,
        },
        () => {
          if (refreshTimer.current) {
            clearTimeout(refreshTimer.current);
          }

          refreshTimer.current = setTimeout(() => {
            refreshTimer.current = null;
            router.refresh();
          }, REFRESH_DEBOUNCE_MS);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnection("connected");

          // Resync as soon as the subscription is live — including the very
          // first subscribe. The board was fetched BEFORE this subscription
          // existed, so a change in that window (e.g. a patient joining) would
          // otherwise be missed. One-off per subscribe, not polling.
          router.refresh();
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
  }, [departmentId, router]);

  return <LiveIndicator connection={connection} />;
}
