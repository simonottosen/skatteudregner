/**
 * Supabase session management for the stdio bundle.
 *
 * The HTTP route authenticates every request from an `Authorization: Basic`
 * header. stdio has no such per-request identity: the host launches one process
 * on the user's machine and every call belongs to the same person. So we sign in
 * once, cache the `AuthInfo`, and re-sign-in shortly before the access token
 * expires. `registerPlanningTools({ getAuthInfo })` pulls from here.
 *
 * Sign-in is lazy — deferred to the first tool call — so a wrong password does
 * not stop the server from starting and listing its tools. The host would
 * otherwise show "server failed to start" with no hint of why.
 */

import type { AuthInfo } from "@modelcontextprotocol/server"
import { signInForAuthInfo } from "@/lib/supabase/mcp-auth"
import { log } from "./log.js"
import type { BundleConfig } from "./config.js"

/** Re-authenticate this many seconds before the token actually expires. */
const REFRESH_SKEW_SECONDS = 60

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthError"
  }
}

export interface SessionManager {
  /** Cached-or-fresh auth, refreshing when the token is close to expiry. */
  getAuthInfo(): Promise<AuthInfo>
  /** Sign in eagerly to surface bad credentials early; never throws. */
  probe(): Promise<boolean>
}

export function createSessionManager(config: BundleConfig): SessionManager {
  let cached: AuthInfo | undefined
  // Single-flight: concurrent tool calls must not each open a sign-in.
  let inFlight: Promise<AuthInfo> | undefined

  const isFresh = (auth: AuthInfo | undefined): auth is AuthInfo => {
    if (!auth) return false
    // `expiresAt` is seconds since epoch (MCP AuthInfo contract). Treat a
    // missing value as "no known expiry" and keep using it.
    if (typeof auth.expiresAt !== "number") return true
    return auth.expiresAt - REFRESH_SKEW_SECONDS > Date.now() / 1000
  }

  const signIn = async (): Promise<AuthInfo> => {
    log.debug("Signing in to Supabase", { email: config.email })
    let auth: AuthInfo | undefined
    try {
      auth = await signInForAuthInfo(config.email, config.password)
    } catch (error) {
      // Network/DNS failures land here; the sign-in helper swallows auth errors.
      throw new AuthError(
        `Could not reach Supabase at ${config.supabaseUrl}: ` +
          `${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (!auth) {
      throw new AuthError(
        "Supabase rejected the sign-in. Check the email and password in the " +
          "extension's settings — they are the same ones you use to log in to " +
          `${config.appUrl}.`
      )
    }
    log.info("Signed in", {
      email: config.email,
      expiresAt: typeof auth.expiresAt === "number" ? new Date(auth.expiresAt * 1000).toISOString() : "unknown",
    })
    return auth
  }

  const getAuthInfo = async (): Promise<AuthInfo> => {
    if (isFresh(cached)) return cached
    if (!inFlight) {
      inFlight = signIn()
        .then((auth) => {
          cached = auth
          return auth
        })
        .finally(() => {
          inFlight = undefined
        })
    }
    return inFlight
  }

  return {
    getAuthInfo,
    probe: async () => {
      try {
        await getAuthInfo()
        return true
      } catch (error) {
        log.warn("Startup sign-in failed; tools will report this on first use", {
          reason: error instanceof Error ? error.message : String(error),
        })
        return false
      }
    },
  }
}
