/**
 * Smoke-test the built MCPB bundle by speaking MCP to it over stdio, exactly as
 * a host would: spawn `node mcpb/server/index.js`, initialize, list the tools,
 * and call one.
 *
 * Runs with placeholder credentials. That is enough because sign-in is lazy —
 * `tools/list` never touches Supabase — and the one `tools/call` we make is
 * expected to come back as a *structured* auth error, which is itself the thing
 * worth asserting: a failing tool must return a clean JSON error rather than
 * crashing the server or corrupting the stream.
 *
 * Usage:
 *   node scripts/smoke-mcpb.mjs               # normal mode
 *   node scripts/smoke-mcpb.mjs --read-only   # assert the write tools are gone
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const ENTRY = join(ROOT, "mcpb", "server", "index.js")
const PROTOCOL_VERSION = "2025-06-18"
const READ_ONLY = process.argv.includes("--read-only")

const WRITE_TOOLS = [
  "update_plan",
  "save_scenario",
  "update_scenario",
  "delete_scenario",
  "add_event",
  "update_event",
  "remove_event",
]
const EXPECTED_TOOLS = [
  "compute_tax",
  "get_budget",
  "get_plan",
  "get_result",
  "get_tax",
  "get_trajectory",
  "list_scenarios",
  "open_app",
  "simulate_what_if",
  "solve_required_saving",
  ...WRITE_TOOLS,
].sort()

if (!existsSync(ENTRY)) {
  console.error(`Not built: ${ENTRY}\nRun: node scripts/build-mcpb.mjs --no-pack`)
  process.exit(1)
}

/** A minimal MCP stdio client: newline-delimited JSON-RPC over the child's pipes. */
function connect() {
  const child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      SKAT_EMAIL: "smoke@example.test",
      SKAT_PASSWORD: "not-a-real-password",
      // Set explicitly so the run stays offline — no config auto-discovery.
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "smoke-test-anon-key",
      SKAT_LOG_LEVEL: "warn",
      SKAT_TOOL_TIMEOUT_MS: "10000",
      // Don't hijack the tester's browser when exercising open_app.
      SKAT_DISABLE_OPEN: "1",
      ...(READ_ONLY ? { SKAT_READ_ONLY: "true" } : {}),
    },
  })

  const pending = new Map()
  let buffer = ""
  let stderr = ""

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString()
  })
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString()
    let nl
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        // A non-JSON line on stdout is precisely the failure this guards against.
        for (const { reject } of pending.values()) {
          reject(new Error(`Non-JSON line on stdout (this corrupts the protocol): ${line}`))
        }
        pending.clear()
        return
      }
      const entry = pending.get(message.id)
      if (!entry) continue
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(`${message.error.code}: ${message.error.message}`))
      else entry.resolve(message.result)
    }
  })

  let nextId = 1
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Timed out waiting for ${method}. stderr so far:\n${stderr}`))
      }, 30_000)
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })

  const notify = (method, params) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")

  return { child, request, notify, stderr: () => stderr, close: () => child.kill("SIGTERM") }
}

const checks = []
function check(label, condition, detail) {
  checks.push({ label, ok: Boolean(condition), detail })
  console.log(`${condition ? "  ✓" : "  ✗"} ${label}${condition || !detail ? "" : `\n      ${detail}`}`)
}

const client = connect()
try {
  console.log(`Smoke test${READ_ONLY ? " (read-only mode)" : ""}: ${ENTRY}\n`)

  const init = await client.request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "smoke-mcpb", version: "1.0.0" },
  })
  client.notify("notifications/initialized", {})
  check("initialize returns our server info", init?.serverInfo?.name === "skatteberegner-planlaegning", JSON.stringify(init?.serverInfo))
  check("server advertises the tools capability", Boolean(init?.capabilities?.tools))

  const list = await client.request("tools/list", {})
  const names = (list?.tools ?? []).map((t) => t.name).sort()
  const expected = READ_ONLY ? EXPECTED_TOOLS.filter((n) => !WRITE_TOOLS.includes(n)) : EXPECTED_TOOLS
  check(
    `tools/list advertises ${expected.length} tools`,
    JSON.stringify(names) === JSON.stringify(expected),
    `got ${names.length}: ${names.join(", ")}`
  )
  if (READ_ONLY) {
    check("write tools are withheld", !names.some((n) => WRITE_TOOLS.includes(n)))
  }

  const bad = (list?.tools ?? []).filter((t) => t.inputSchema?.type !== "object")
  check("every tool exposes an object inputSchema", bad.length === 0, bad.map((t) => t.name).join(", "))
  const undescribed = (list?.tools ?? []).filter((t) => !t.description || t.description.length < 20)
  check("every tool is described", undescribed.length === 0, undescribed.map((t) => t.name).join(", "))

  // A tool that needs auth, with credentials that cannot work: it must come back
  // as a normal result carrying `isError`, not as a transport-level failure.
  const call = await client.request("tools/call", { name: "get_plan", arguments: {} })
  check("a failing tool returns a result rather than crashing", call !== undefined)
  check("the failure is flagged with isError", call?.isError === true, JSON.stringify(call).slice(0, 200))
  let payload
  try {
    payload = JSON.parse(call?.content?.[0]?.text ?? "")
  } catch {
    payload = undefined
  }
  check(
    "the failure is structured JSON naming the tool and the kind",
    payload?.error?.tool === "get_plan" && typeof payload.error.kind === "string" && typeof payload.error.message === "string",
    JSON.stringify(payload)
  )

  // A tool that works with no credentials at all, proving the happy path.
  const help = await client.request("tools/call", { name: "open_app", arguments: { section: "skat" } })
  let opened
  try {
    opened = JSON.parse(help?.content?.[0]?.text ?? "")
  } catch {
    opened = undefined
  }
  check(
    "a successful tool returns structured JSON",
    opened?.url === "https://skat.simonottosen.dk/skat" && help?.isError !== true,
    JSON.stringify(opened)
  )

  // Bad arguments must be rejected by the schema, not by the handler.
  let rejected = false
  try {
    await client.request("tools/call", { name: "open_app", arguments: { section: "not-a-page" } })
  } catch {
    rejected = true
  }
  const badArgs = rejected
    ? { isError: true }
    : await client.request("tools/call", { name: "open_app", arguments: { section: "not-a-page" } })
  check("an invalid argument is rejected", rejected || badArgs?.isError === true)

  check("no secrets in the log", !client.stderr().includes("not-a-real-password"), "the password leaked to stderr")
} finally {
  client.close()
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) {
  console.error(`\nstderr from the server:\n${client.stderr()}`)
  process.exit(1)
}
