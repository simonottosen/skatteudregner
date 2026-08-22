/**
 * Wiring test for the remote MCP server. Guards the mcp-handler 2 /
 * @modelcontextprotocol/server integration: that the handler negotiates a
 * session and that every tool is advertised with a usable JSON Schema (the
 * tools are registered with the legacy raw-shape `inputSchema` form, which the
 * server package auto-wraps in `z.object()`).
 *
 * `tools/list` needs no auth — only `tools/call` reaches `loadPlan`, so this
 * exercises the protocol without touching Supabase.
 */

import { describe, it, expect } from "vitest"
import { createMcpHandler } from "mcp-handler"
import { registerPlanningTools } from "../tools"

const handler = createMcpHandler((server) => registerPlanningTools(server), {
  serverInfo: { name: "skatteberegner-planlaegning", version: "1.0.0" },
})

const PROTOCOL_VERSION = "2025-06-18"

async function rpc(body: unknown): Promise<Record<string, unknown>> {
  const res = await handler(
    new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    })
  )
  expect(res.status).toBe(200)
  const text = await res.text()
  // Streamable HTTP may answer either as plain JSON or as a single SSE frame.
  const payload = text.startsWith("event:") || text.startsWith("data:")
    ? text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("")
    : text
  return JSON.parse(payload)
}

describe("MCP route handler", () => {
  it("answers initialize with our server info", async () => {
    const out = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "vitest", version: "0" },
      },
    })
    const result = out.result as Record<string, unknown>
    expect(result).toBeDefined()
    expect((result.serverInfo as { name: string }).name).toBe("skatteberegner-planlaegning")
  })

  it("lists every planning tool with a valid object input schema", async () => {
    const out = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    const tools = (out.result as { tools: { name: string; inputSchema: { type?: string } }[] }).tools
    const names = tools.map((t) => t.name).sort()

    expect(names).toEqual(
      [
        "add_event",
        "compute_tax",
        "delete_scenario",
        "get_budget",
        "get_plan",
        "get_result",
        "get_tax",
        "get_trajectory",
        "list_scenarios",
        "remove_event",
        "save_scenario",
        "simulate_what_if",
        "solve_required_saving",
        "update_event",
        "update_plan",
        "update_scenario",
      ].sort()
    )

    // Every tool must expose an object schema, otherwise clients can't call it.
    for (const tool of tools) {
      expect(tool.inputSchema?.type, `${tool.name} inputSchema`).toBe("object")
    }
  })

  it("exposes the argument shape for a tool that takes parameters", async () => {
    const out = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
    const tools = (
      out.result as {
        tools: { name: string; inputSchema: { properties?: Record<string, unknown> } }[]
      }
    ).tools
    const save = tools.find((t) => t.name === "save_scenario")!
    expect(Object.keys(save.inputSchema.properties ?? {}).sort()).toEqual(["changes", "name"])
  })
})
