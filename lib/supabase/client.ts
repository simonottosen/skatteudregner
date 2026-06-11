import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/** True only when both Supabase env vars are present. */
export const isSupabaseConfigured = Boolean(url && anonKey)

let browserClient: SupabaseClient | null = null

/**
 * Returns a memoised Supabase browser client, or null when the project isn't
 * configured yet (no env vars). Callers must handle the null case so the app
 * keeps working anonymously against localStorage.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null
  if (!browserClient) {
    browserClient = createBrowserClient(url as string, anonKey as string)
  }
  return browserClient
}
