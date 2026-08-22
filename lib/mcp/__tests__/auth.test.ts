/**
 * Regression tests for how a tool call gets its identity.
 *
 * There are two transports and they carry auth differently:
 *
 *   HTTP  — `app/api/mcp/route.ts` authenticates every request and assigns
 *           `req.auth`; mcp-handler forwards it and the SDK surfaces it to the
 *           tool as `ctx.http.authInfo`.
 *   stdio — the MCPB bundle signs in once at startup and passes that session as
 *           `getAuthInfo`, because there is no per-request identity.
 *
 * `@modelcontextprotocol/server` v2 moved the HTTP location from the top-level
 * `extra.authInfo` to `ctx.http.authInfo`. Nothing caught that at the time —
 * `tools/list` never touches auth, and unchecked casts hid it from `tsc` — so
 * every authenticated HTTP tool call failed with "Not authenticated" in
 * production. These tests pin both channels at the boundary that broke.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { AuthInfo } from "@modelcontextprotocol/server"

const userClientFromAuth = vi.fn()
const fetchUserData = vi.fn()

// Stub the Supabase edge so the test exercises auth plumbing, not the network.
vi.mock("@/lib/supabase/mcp-auth", () => ({
  userClientFromAuth: (...args: unknown[]) => userClientFromAuth(...args),
}))
vi.mock("@/lib/supabase/user-data", () => ({
  fetchUserData: (...args: unknown[]) => fetchUserData(...args),
  saveUserData: vi.fn(),
}))

const { createMcpHandler } = await import("mcp-handler")
const { registerPlanningTools } = await import("../tools")

const AUTH: AuthInfo = {
  token: "access-token-abc",
  clientId: "someone@example.test",
  scopes: [],
  extra: { userId: "user-123", accessToken: "access-token-abc" },
}

/** Build a handler, optionally with the stdio-style fallback session. */
function makeHandler(getAuthInfo?: () => AuthInfo | undefined) {
  return createMcpHandler((server) => registerPlanningTools(server, { getAuthInfo }), {
    serverInfo: { name: "skatteberegner-planlaegning", version: "1.0.0" },
  })
}

/** Call `list_scenarios` — the cheapest tool that still goes through `loadPlan`. */
async function callTool(
  handler: ReturnType<typeof makeHandler>,
  auth?: AuthInfo
): Promise<Record<string, unknown>> {
  const req = new Request("https://example.test/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_scenarios", arguments: {} },
    }),
  })
  // Exactly what the route does once Basic auth has succeeded.
  if (auth) req.auth = auth
  const res = await handler(req)
  const text = await res.text()
  const payload =
    text.startsWith("event:") || text.startsWith("data:")
      ? text
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("")
      : text
  return JSON.parse(payload)
}

beforeEach(() => {
  vi.clearAllMocks()
  userClientFromAuth.mockReturnValue({ supabase: {}, userId: "user-123" })
  fetchUserData.mockResolvedValue(null)
})

describe("auth reaches the tools", () => {
  it("hands the request's AuthInfo to the Supabase client factory", async () => {
    const out = await callTool(makeHandler(), AUTH)

    // The bug: this was called with `undefined`, so every call threw.
    expect(userClientFromAuth).toHaveBeenCalledWith(AUTH)
    expect((out.result as { isError?: boolean }).isError).toBeFalsy()
  })

  it("scopes the data fetch to the authenticated user", async () => {
    await callTool(makeHandler(), AUTH)
    expect(fetchUserData).toHaveBeenCalledWith(expect.anything(), "user-123")
  })

  it("passes undefined when the request carries no auth", async () => {
    // The route 401s before this point, so reaching a tool unauthenticated is
    // a bug — but it must surface as "no identity", never as someone else's.
    await callTool(makeHandler())
    expect(userClientFromAuth).toHaveBeenCalledWith(undefined)
  })

  it("falls back to the stdio session when the transport carries no auth", async () => {
    const session: AuthInfo = { ...AUTH, clientId: "stdio@example.test" }
    await callTool(makeHandler(() => session))
    expect(userClientFromAuth).toHaveBeenCalledWith(session)
  })

  it("prefers per-request auth over the stdio fallback", async () => {
    const session: AuthInfo = { ...AUTH, clientId: "stdio@example.test" }
    await callTool(makeHandler(() => session), AUTH)
    expect(userClientFromAuth).toHaveBeenCalledWith(AUTH)
  })

  it("reports a tool error rather than crashing when auth is rejected", async () => {
    userClientFromAuth.mockImplementation(() => {
      throw new Error("Not authenticated")
    })
    const out = await callTool(makeHandler())
    const result = out.result as { isError?: boolean; content?: { text?: string }[] }
    expect(result.isError).toBe(true)
    expect(result.content?.[0]?.text).toContain("Not authenticated")
  })
})
