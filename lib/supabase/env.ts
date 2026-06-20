/**
 * Runtime Supabase configuration.
 *
 * `NEXT_PUBLIC_*` variables are normally inlined into the bundle at build time,
 * so a Docker image built without them can never pick them up at `docker run`.
 * To make a single image runtime-configurable, we read the values **indirectly**
 * (via a variable key) so Next's build-time substitution can't freeze them — on
 * the server this yields the real value from the container's environment.
 *
 * The browser can't read the container env, so the values are injected into the
 * page as `window.__ENV__` by `<PublicEnvScript />` (a server component) and read
 * back in `lib/supabase/client.ts`.
 */

declare global {
  interface Window {
    __ENV__?: {
      NEXT_PUBLIC_SUPABASE_URL?: string
      NEXT_PUBLIC_SUPABASE_ANON_KEY?: string
    }
  }
}

export interface SupabaseEnv {
  url: string
  anonKey: string
}

/** Read an env var at runtime (dynamic key dodges build-time inlining). */
function readEnv(key: string): string {
  const value = process.env[key]
  return typeof value === "string" ? value : ""
}

/**
 * Server-side Supabase config, read from the runtime environment. Accepts the
 * public names (what the app/docs use) and bare fallbacks. Empty strings when
 * unset.
 */
export function getSupabaseEnv(): SupabaseEnv {
  return {
    url: readEnv("NEXT_PUBLIC_SUPABASE_URL") || readEnv("SUPABASE_URL"),
    anonKey:
      readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") || readEnv("SUPABASE_ANON_KEY"),
  }
}
