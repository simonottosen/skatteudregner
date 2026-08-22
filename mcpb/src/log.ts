/**
 * Logging for the stdio bundle.
 *
 * CRITICAL: stdout is the MCP wire. Anything written there that isn't a
 * newline-delimited JSON-RPC message corrupts the stream and the host drops the
 * connection. Every diagnostic therefore goes to **stderr**, which MCPB hosts
 * capture into their server logs.
 *
 * Because the bundled engine (and Supabase's client) call bare `console.*`, we
 * also redirect `console.log`/`console.info`/`console.debug` onto stderr at
 * startup — see `captureConsole()`.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
}

let threshold: number = RANK.info

export function setLogLevel(level: LogLevel): void {
  threshold = RANK[level]
}

export function parseLogLevel(raw: string | undefined, fallback: LogLevel = "info"): LogLevel {
  const value = (raw ?? "").trim().toLowerCase()
  return (LOG_LEVELS as readonly string[]).includes(value) ? (value as LogLevel) : fallback
}

/** Values that must never reach a log line, whatever the level. */
const REDACT_KEYS = /^(password|passwd|secret|token|accessToken|access_token|apiKey|authorization)$/i

/**
 * Shallow-redact a details object. Defence in depth: the bundle handles the
 * user's Supabase password, and host log files are plain text on disk.
 */
function redact(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    out[key] = REDACT_KEYS.test(key) ? "[redacted]" : value
  }
  return out
}

function emit(level: Exclude<LogLevel, "silent">, message: string, details?: Record<string, unknown>): void {
  if (RANK[level] < threshold) return
  const stamp = new Date().toISOString()
  let line = `${stamp} [skatteberegner] ${level.toUpperCase()} ${message}`
  if (details && Object.keys(details).length > 0) {
    try {
      line += ` ${JSON.stringify(redact(details))}`
    } catch {
      line += " [details not serializable]"
    }
  }
  // `process.stderr.write` rather than `console.error` so a redirected console
  // can never recurse back into here.
  process.stderr.write(line + "\n")
}

export const log = {
  debug: (message: string, details?: Record<string, unknown>) => emit("debug", message, details),
  info: (message: string, details?: Record<string, unknown>) => emit("info", message, details),
  warn: (message: string, details?: Record<string, unknown>) => emit("warn", message, details),
  error: (message: string, details?: Record<string, unknown>) => emit("error", message, details),
}

/**
 * Point every stdout-bound console method at stderr. The shared engine and its
 * dependencies log freely; without this a single stray `console.log` would
 * desynchronise the JSON-RPC stream.
 */
export function captureConsole(): void {
  const toStderr =
    (level: "debug" | "info" | "warn") =>
    (...args: unknown[]) => {
      if (RANK[level] < threshold) return
      const text = args
        .map((a) => {
          if (typeof a === "string") return a
          try {
            return JSON.stringify(a)
          } catch {
            return String(a)
          }
        })
        .join(" ")
      process.stderr.write(`${new Date().toISOString()} [console] ${text}\n`)
    }
  console.log = toStderr("info")
  console.info = toStderr("info")
  console.debug = toStderr("debug")
  console.warn = toStderr("warn")
  // `console.error`/`console.trace` already go to stderr — leave them alone.
}

/** Normalize any thrown value into a message safe to show a user. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    // `JSON.stringify` yields `undefined` (not a string) for undefined and for
    // functions, so fall through to `String()` rather than returning it.
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}
