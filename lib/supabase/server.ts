import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireSupabasePublicEnv, requireSupabaseSecretKey } from "../env.ts";

/**
 * Privileged, SERVER-ONLY Supabase client.
 *
 * Uses SUPABASE_SECRET_KEY, which bypasses Row Level Security. It exists for the
 * narrow set of operations the anonymous browser must never be able to perform:
 * staff queue actions and admin reads. All of those run from Server Actions or
 * Server Components, so the key never leaves the server.
 *
 * Guard rails:
 * - `assertServerOnly()` throws if this is ever evaluated in a browser context.
 * - The secret key is never passed as an argument the caller could log; it is
 *   read from the environment inside this function.
 * - `auth` is fully disabled: there is no user session and no token to persist.
 */
function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "createPrivilegedSupabaseClient() was called in the browser. It uses " +
        "SUPABASE_SECRET_KEY, which bypasses Row Level Security, so it must only " +
        "run on the server (Server Action, Server Component or a Node script).",
    );
  }
}

export function createPrivilegedSupabaseClient(): SupabaseClient {
  assertServerOnly();

  const { url } = requireSupabasePublicEnv();
  const secretKey = requireSupabaseSecretKey();

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
