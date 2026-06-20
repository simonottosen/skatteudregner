import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Injects the runtime Supabase config into the page as `window.__ENV__` so the
 * browser Supabase client can read values provided at `docker run` (not just at
 * build time). Rendered in the root layout, which is `force-dynamic` so this runs
 * per request and reflects the container's current environment.
 */
export function PublicEnvScript() {
  const { url, anonKey } = getSupabaseEnv()
  const payload = JSON.stringify({
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  })
  return (
    <script
      id="public-env"
      // Deterministic given the env, so server and client markup match.
      dangerouslySetInnerHTML={{ __html: `window.__ENV__=${payload}` }}
    />
  )
}
