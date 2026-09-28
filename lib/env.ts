/**
 * Central environment access.
 *
 * Rules enforced here:
 * - Every value is read through a static `process.env.<NAME>` reference so that
 *   Next.js can inline the NEXT_PUBLIC_* values at build time.
 * - `SUPABASE_SECRET_KEY` is only ever reachable through `requireSupabaseSecretKey()`,
 *   which is called exclusively by server-side code (lib/supabase/server.ts).
 * - No value is ever logged. Error messages name the missing variable, never its
 *   contents.
 */

export interface SupabasePublicEnv {
  url: string;
  publishableKey: string;
}

function readNonEmpty(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The public (browser-safe) Supabase configuration, or null when unset.
 *
 * Uses the publishable key, which is low-privilege: every request it makes is
 * still constrained by Row Level Security.
 */
export function getSupabasePublicEnv(): SupabasePublicEnv | null {
  const url = readNonEmpty(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = readNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  if (!url || !publishableKey) {
    return null;
  }

  return { url, publishableKey };
}

export function requireSupabasePublicEnv(): SupabasePublicEnv {
  const env = getSupabasePublicEnv();

  if (!env) {
    throw new Error(
      "Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must both be set. " +
        "Copy .env.local.example to .env.local and fill them in.",
    );
  }

  return env;
}

/**
 * The server-only secret key (bypasses RLS), or null when unset.
 *
 * NEVER import this into a client component, a "use client" module, or any file
 * that ends up in the browser bundle. Use lib/supabase/server.ts instead.
 */
export function getSupabaseSecretKey(): string | null {
  return readNonEmpty(process.env.SUPABASE_SECRET_KEY);
}

export function requireSupabaseSecretKey(): string {
  const secretKey = getSupabaseSecretKey();

  if (!secretKey) {
    throw new Error(
      "Supabase is not configured: SUPABASE_SECRET_KEY must be set (server-only). " +
        "Copy .env.local.example to .env.local and fill it in.",
    );
  }

  return secretKey;
}

/** Public base URL of this app, used for QR links. */
export function getAppUrl(): string {
  return readNonEmpty(process.env.NEXT_PUBLIC_APP_URL) ?? "http://localhost:3000";
}
