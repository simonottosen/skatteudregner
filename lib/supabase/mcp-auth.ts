/**
 * Authentication for the remote MCP server. An MCP client sends the user's
 * Supabase email + password as an HTTP `Authorization: Basic` header; we sign in
 * to mint a user JWT and hand back an RLS-scoped Supabase client. The session
 * only ever touches that user's own row (enforced by row-level security).
 *
 * NOTE: passwords travel in an HTTPS header — acceptable for a personal
 * deployment. A future hardening step would switch to Supabase access tokens or
 * OAuth so a raw password is never sent.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

interface BasicCredentials {
  email: string
  password: string
}

/** Decode an `Authorization: Basic base64(email:password)` header. */
function parseBasicAuth(req: Request): BasicCredentials | null {
  const header = req.headers.get("authorization") ?? ""
  const [scheme, encoded] = header.split(" ")
  if (scheme?.toLowerCase() !== "basic" || !encoded) return null
  let decoded: string
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8")
  } catch {
    return null
  }
  const sep = decoded.indexOf(":")
  if (sep < 0) return null
  const email = decoded.slice(0, sep)
  const password = decoded.slice(sep + 1)
  if (!email || !password) return null
  return { email, password }
}

/**
 * Verify the Basic credentials by signing in to Supabase. Returns an AuthInfo
 * carrying the user's id + access token (used to rebuild an RLS-scoped client),
 * or undefined when auth fails / isn't configured.
 */
export async function verifyBasicAuth(req: Request): Promise<AuthInfo | undefined> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return undefined
  const creds = parseBasicAuth(req)
  if (!creds) return undefined

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({
    email: creds.email,
    password: creds.password,
  })
  if (error || !data.session || !data.user) return undefined

  return {
    token: data.session.access_token,
    clientId: creds.email,
    scopes: [],
    extra: {
      userId: data.user.id,
      accessToken: data.session.access_token,
    },
  }
}

/**
 * Build an RLS-scoped Supabase client from the AuthInfo produced above, plus the
 * authenticated user's id. Throws if the AuthInfo is missing/malformed.
 */
export function userClientFromAuth(authInfo: AuthInfo | undefined): {
  supabase: SupabaseClient
  userId: string
} {
  const accessToken = authInfo?.extra?.accessToken as string | undefined
  const userId = authInfo?.extra?.userId as string | undefined
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !accessToken || !userId) {
    throw new Error("Not authenticated")
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
  return { supabase, userId }
}
