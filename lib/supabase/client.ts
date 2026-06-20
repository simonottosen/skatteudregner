import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import "./env" // for the global `window.__ENV__` type augmentation

/**
 * Resolve the Supabase config in the browser. Prefers the runtime values
 * injected as `window.__ENV__` by `<PublicEnvScript />` (so a single Docker
 * image honours env passed at `docker run`), and falls back to the build-time
 * `NEXT_PUBLIC_*` values used during local `next dev`.
 */
function browserEnv(): { url?: string; anonKey?: string } {
  if (typeof window !== "undefined" && window.__ENV__) {
    return {
      url: window.__ENV__.NEXT_PUBLIC_SUPABASE_URL || undefined,
      anonKey: window.__ENV__.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
    }
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
}

/** True only when both Supabase values are available (runtime or build time). */
export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = browserEnv()
  return Boolean(url && anonKey)
}

let browserClient: SupabaseClient | null = null

/**
 * Returns a memoised Supabase browser client, or null when the project isn't
 * configured (no env). Callers must handle the null case so the app keeps
 * working anonymously against localStorage.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  const { url, anonKey } = browserEnv()
  if (!url || !anonKey) return null
  if (!browserClient) {
    browserClient = createBrowserClient(url, anonKey)
  }
  return browserClient
}
