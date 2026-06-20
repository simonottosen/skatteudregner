import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Refreshes the Supabase auth session cookie on each request so server-side
 * reads stay in sync. It intentionally does NOT redirect unauthenticated users:
 * the app is fully usable anonymously (localStorage), and login only adds
 * cross-device sync. No-ops entirely until the project is configured.
 */
export async function middleware(request: NextRequest) {
  // Read at runtime so a single Docker image honours env from `docker run`.
  const { url, anonKey } = getSupabaseEnv()
  if (!url || !anonKey) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  // IMPORTANT: keep getUser() right after client creation — it refreshes the
  // session. Do not add logic between createServerClient and getUser().
  await supabase.auth.getUser()

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
