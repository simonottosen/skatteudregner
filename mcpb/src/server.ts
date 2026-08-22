/**
 * Skatteberegner MCPB bundle — an MCP server over **stdio**, running on the
 * user's own machine.
 *
 * It registers the exact same planning/tax/budget tools as the hosted
 * `/api/mcp` route (`lib/mcp/tools.ts`, one shared implementation) and talks
 * straight to Supabase under row-level security. Differences from the hosted
 * server, all of them consequences of running locally:
 *
 *   - credentials are entered once in the host's extension settings instead of
 *     being sent on every request;
 *   - the process signs in once and refreshes, rather than per request;
 *   - there is no serverless wall-clock limit, so long Monte-Carlo runs finish;
 *   - `open_app` can put a page on the user's screen.
 *
 * stdout is the JSON-RPC wire — every diagnostic goes to stderr (see `log.ts`).
 */

import { McpServer } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { registerPlanningTools } from "@/lib/mcp/tools"
import { captureConsole, errorMessage, log, setLogLevel } from "./log.js"
import { applySupabaseEnv, ConfigError, loadConfig, type BundleConfig } from "./config.js"
import { createSessionManager, type SessionManager } from "./auth.js"
import { registerLocalTools } from "./local-tools.js"

const SERVER_NAME = "skatteberegner-planlaegning"
const SERVER_VERSION = "1.0.0"

/**
 * Tools that write to the user's saved plan. Withheld entirely when
 * `SKAT_READ_ONLY` is set, so an unattended agent can explore the plan with no
 * way to change it.
 */
const WRITE_TOOLS = new Set([
  "update_plan",
  "save_scenario",
  "update_scenario",
  "delete_scenario",
  "add_event",
  "update_event",
  "remove_event",
])

type ToolResult = { content: unknown[]; isError?: boolean; structuredContent?: unknown }

/** A tool failure, rendered the same way every tool renders success: as JSON. */
function toolError(tool: string, message: string, kind: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: { tool, kind, message } }, null, 2) }],
    isError: true,
  }
}

/**
 * The engine's tools return `{ content: [...] }`. Anything else would be a bug,
 * but a malformed result crashes the host's parser rather than showing an error,
 * so check before it reaches the wire.
 */
function isToolResult(value: unknown): value is ToolResult {
  return typeof value === "object" && value !== null && Array.isArray((value as ToolResult).content)
}

/** Run `work`, rejecting with a readable error if it outlives `ms`. */
async function withTimeout<T>(work: Promise<T>, ms: number, tool: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Tool "${tool}" did not finish within ${ms} ms.`)),
          ms
        )
        // Don't hold the event loop open on the timeout alone.
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Register the shared planning tools through a policy layer that adds per-call
 * timeouts, structured logging and last-resort error handling, and that drops
 * the write tools in read-only mode.
 *
 * Implemented by shadowing `registerTool` on this instance for the duration of
 * the call: `registerPlanningTools` is shared verbatim with the hosted route, so
 * the local-only policy belongs here rather than in the engine.
 */
function registerWithPolicy(server: McpServer, config: BundleConfig, session: SessionManager): void {
  const original = server.registerTool.bind(server)
  let registered = 0
  let skipped = 0

  const decorated = (name: string, toolConfig: Record<string, unknown>, cb: (...a: never[]) => unknown) => {
    if (config.readOnly && WRITE_TOOLS.has(name)) {
      skipped += 1
      log.debug("Read-only mode: withholding write tool", { tool: name })
      return undefined
    }
    registered += 1

    const wrapped = async (...callArgs: unknown[]) => {
      const started = Date.now()
      log.debug("Tool call", { tool: name })
      try {
        const result = await withTimeout(
          Promise.resolve(cb(...(callArgs as never[]))),
          config.toolTimeoutMs,
          name
        )
        if (!isToolResult(result)) {
          log.error("Tool returned a malformed result", { tool: name })
          return toolError(name, "The tool returned a malformed result.", "internal")
        }
        log.info("Tool ok", { tool: name, ms: Date.now() - started })
        return result
      } catch (error) {
        const message = errorMessage(error)
        const kind = /did not finish within/.test(message)
          ? "timeout"
          : /not authenticated|sign-in|password/i.test(message)
            ? "auth"
            : "error"
        log.error("Tool failed", { tool: name, ms: Date.now() - started, kind, message })
        return toolError(name, message, kind)
      }
    }

    return original(
      name,
      toolConfig as Parameters<typeof original>[1],
      wrapped as Parameters<typeof original>[2]
    )
  }

  // Own property shadows the prototype method; removed again below so nothing
  // else sees the patched instance.
  Object.defineProperty(server, "registerTool", { value: decorated, configurable: true, writable: true })
  try {
    registerPlanningTools(server, { getAuthInfo: () => session.getAuthInfo() })
    registerLocalTools(server, config.appUrl, config.allowOpen)
  } finally {
    delete (server as Partial<McpServer>).registerTool
  }

  log.info("Tools registered", { registered, withheld: skipped, readOnly: config.readOnly })
}

async function main(): Promise<void> {
  // Before anything else can write to stdout.
  captureConsole()

  let config: BundleConfig
  try {
    config = await loadConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      log.error(error.message)
      process.exit(1)
    }
    throw error
  }
  setLogLevel(config.logLevel)
  applySupabaseEnv(config)

  log.info("Starting", {
    version: SERVER_VERSION,
    node: process.version,
    platform: process.platform,
    appUrl: config.appUrl,
    supabaseUrl: config.supabaseUrl,
    readOnly: config.readOnly,
    allowOpen: config.allowOpen,
    toolTimeoutMs: config.toolTimeoutMs,
  })

  const session = createSessionManager(config)
  // Sign in eagerly so bad credentials show up in the host's log at startup —
  // but don't fail the launch, or the user never gets to see the tool list.
  void session.probe()

  const handle = serveStdio(() => {
    const server = new McpServer(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} } }
    )
    registerWithPolicy(server, config, session)
    return server
  }, {
    onerror: (error) => log.error("Transport error", { message: error.message }),
  })

  log.info("Listening on stdio")

  const shutdown = (signal: string) => {
    log.info("Shutting down", { signal })
    void handle.close().finally(() => process.exit(0))
  }
  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
  // stdin closing is how a host says "you're done".
  process.stdin.on("end", () => shutdown("stdin-end"))

  // A stray rejection must not take the server down mid-conversation.
  process.on("unhandledRejection", (reason) =>
    log.error("Unhandled rejection", { message: errorMessage(reason) })
  )
  process.on("uncaughtException", (error) => {
    log.error("Uncaught exception", { message: error.message, stack: error.stack })
    process.exit(1)
  })
}

main().catch((error) => {
  log.error("Fatal error during startup", { message: errorMessage(error) })
  process.exit(1)
})
