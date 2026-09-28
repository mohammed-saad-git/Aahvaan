"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireSupabasePublicEnv } from "../env.ts";

/**
 * Browser Supabase client, for the patient experience.
 *
 * Uses the PUBLISHABLE key only. That key is low-privilege and is further
 * constrained by Row Level Security: with the policies from
 * supabase/migrations/0001_init.sql, an anonymous browser can SELECT
 * queue_entries (needed for Realtime change notifications) and nothing else.
 * It cannot write, cannot read `patients`, and cannot execute the mutating RPCs.
 *
 * `SUPABASE_SECRET_KEY` must never appear in this file or any client bundle.
 *
 * A single instance is cached so React re-renders do not open additional
 * Realtime websocket connections.
 */
let browserClient: SupabaseClient | null = null;

export function getBrowserSupabaseClient(): SupabaseClient {
  if (browserClient) {
    return browserClient;
  }

  const { url, publishableKey } = requireSupabasePublicEnv();

  browserClient = createClient(url, publishableKey, {
    auth: {
      // No Supabase Auth in the MVP: nothing to persist or refresh.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return browserClient;
}
