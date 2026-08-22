/**
 * Configuration for the stdio bundle, read from the environment.
 *
 * MCPB hosts pass `user_config` values through `mcp_config.env` (see
 * `manifest.json`), so the environment is the whole configuration surface. Every
 * value is validated here, at startup, so a misconfigured install fails with one
 * readable message instead of a confusing error on the first tool call.
 */

import { parseLogLevel, type LogLevel, log } from "./log.js"

/** Where the hosted app lives; also the source for auto-discovered Supabase config. */
const DEFAULT_APP_URL = "https://skat.simonottosen.dk"
const DEFAULT_TIMEOUT_MS = 30_000
const MIN_TIMEOUT_MS = 5_000
const MAX_TIMEOUT_MS = 120_000
/** How long to wait when auto-discovering Supabase config from the app. */
const DISCOVERY_TIMEOUT_MS = 10_000

export interface BundleConfig {
  email: string
  password: string
  supabaseUrl: string
  supabaseAnonKey: string
  appUrl: string
  readOnly: boolean
  /** Whether `open_app` may actually launch a browser on this machine. */
  allowOpen: boolean
  toolTimeoutMs: number
  logLevel: LogLevel
}

/** A configuration problem worth showing the user verbatim. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

/**
 * An environment value, treating an unsubstituted MCPB placeholder as unset.
 *
 * Hosts differ on what they do with an optional `user_config` entry the user
 * never filled in: most drop it, but some pass the raw `${user_config.foo}`
 * through. Taking that literally would fail the whole startup over a setting
 * that has a perfectly good default.
 */
function str(key: string): string {
  const raw = (process.env[key] ?? "").trim()
  return /^\$\{[^}]*\}$/.test(raw) ? "" : raw
}

function bool(key: string, fallback: boolean): boolean {
  const raw = str(key).toLowerCase()
  if (raw === "") return fallback
  if (["1", "true", "yes", "on"].includes(raw)) return true
  if (["0", "false", "no", "off"].includes(raw)) return false
  throw new ConfigError(`${key} must be true or false (got ${JSON.stringify(raw)}).`)
}

function int(key: string, fallback: number, min: number, max: number): number {
  const raw = str(key)
  if (raw === "") return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new ConfigError(`${key} must be a number (got ${JSON.stringify(raw)}).`)
  }
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

/** Reject anything that isn't a plain https origin (no credentials, no query). */
function httpsOrigin(key: string, raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new ConfigError(`${key} must be a full URL, e.g. https://example.supabase.co (got ${JSON.stringify(raw)}).`)
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new ConfigError(`${key} must use https (got ${parsed.protocol}//…). Credentials are sent over this connection.`)
  }
  if (parsed.username || parsed.password) {
    throw new ConfigError(`${key} must not embed credentials.`)
  }
  return parsed.origin
}

/**
 * Pull `window.__ENV__` out of the deployed app's HTML.
 *
 * The app publishes its Supabase URL + anon key to every browser that loads the
 * page (they are public by design — row-level security is what protects the
 * data), so the bundle can discover them instead of asking the user to paste
 * them into the install dialog. Only ever called for the user's own app URL, and
 * only when the values weren't configured explicitly.
 */
async function discoverSupabaseEnv(
  appUrl: string
): Promise<{ url: string; anonKey: string } | undefined> {
  const signal = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
  let html: string
  try {
    const res = await fetch(appUrl, { signal, headers: { accept: "text/html" } })
    if (!res.ok) {
      log.warn("Config auto-discovery: app returned a non-OK status", { appUrl, status: res.status })
      return undefined
    }
    html = await res.text()
  } catch (error) {
    log.warn("Config auto-discovery: could not reach the app", {
      appUrl,
      reason: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }

  // `[\s\S]` rather than the `s` flag: the shared tsconfig targets ES2017.
  const match = html.match(/window\.__ENV__\s*=\s*(\{[\s\S]*?\})/)
  if (!match) {
    log.warn("Config auto-discovery: no window.__ENV__ in the app HTML", { appUrl })
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(match[1]!)
  } catch {
    log.warn("Config auto-discovery: window.__ENV__ was not valid JSON", { appUrl })
    return undefined
  }
  const env = parsed as Record<string, unknown>
  const url = typeof env.NEXT_PUBLIC_SUPABASE_URL === "string" ? env.NEXT_PUBLIC_SUPABASE_URL : ""
  const anonKey =
    typeof env.NEXT_PUBLIC_SUPABASE_ANON_KEY === "string" ? env.NEXT_PUBLIC_SUPABASE_ANON_KEY : ""
  if (!url || !anonKey) {
    log.warn("Config auto-discovery: window.__ENV__ was missing the Supabase keys", { appUrl })
    return undefined
  }
  return { url, anonKey }
}

/**
 * Validate the environment into a `BundleConfig`. Throws `ConfigError` with an
 * actionable message when something required is missing.
 */
export async function loadConfig(): Promise<BundleConfig> {
  const logLevel = parseLogLevel(str("SKAT_LOG_LEVEL"))

  const email = str("SKAT_EMAIL")
  // Not via `str()`: a password is taken exactly as given, including whitespace.
  const password = process.env.SKAT_PASSWORD ?? ""
  const missing: string[] = []
  if (!email) missing.push("SKAT_EMAIL")
  if (!password) missing.push("SKAT_PASSWORD")
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required configuration: ${missing.join(", ")}. ` +
        "Open the extension's settings in your MCP host and fill in the Supabase " +
        "email and password you use to sign in to the Skatteberegner app."
    )
  }
  if (!email.includes("@")) {
    throw new ConfigError(`SKAT_EMAIL does not look like an email address (got ${JSON.stringify(email)}).`)
  }

  const appUrl = httpsOrigin("SKAT_APP_URL", str("SKAT_APP_URL") || DEFAULT_APP_URL)

  let supabaseUrl = str("SUPABASE_URL") || str("NEXT_PUBLIC_SUPABASE_URL")
  let supabaseAnonKey = str("SUPABASE_ANON_KEY") || str("NEXT_PUBLIC_SUPABASE_ANON_KEY")

  if (!supabaseUrl || !supabaseAnonKey) {
    log.info("Supabase config not set — discovering it from the app", { appUrl })
    const discovered = await discoverSupabaseEnv(appUrl)
    if (discovered) {
      supabaseUrl ||= discovered.url
      supabaseAnonKey ||= discovered.anonKey
      log.info("Supabase config discovered", { supabaseUrl })
    }
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new ConfigError(
      "Could not determine the Supabase URL / anon key. They are normally read " +
        `from ${appUrl} automatically; set SUPABASE_URL and SUPABASE_ANON_KEY in ` +
        "the extension settings if the app is unreachable or self-hosted."
    )
  }

  return {
    email,
    password,
    supabaseUrl: httpsOrigin("SUPABASE_URL", supabaseUrl),
    supabaseAnonKey,
    appUrl,
    readOnly: bool("SKAT_READ_ONLY", false),
    allowOpen: !bool("SKAT_DISABLE_OPEN", false),
    toolTimeoutMs: int("SKAT_TOOL_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    logLevel,
  }
}

/**
 * Publish the Supabase settings under the names `lib/supabase/env.ts` reads.
 * The engine is shared verbatim with the web app, so it expects `process.env`.
 */
export function applySupabaseEnv(config: BundleConfig): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL = config.supabaseUrl
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = config.supabaseAnonKey
}
