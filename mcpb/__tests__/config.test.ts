/**
 * Configuration validation for the MCPB bundle.
 *
 * A misconfigured extension is the most likely thing to go wrong in the field —
 * the user types their password into a host dialog and gets one shot at it — so
 * every rejection path is pinned here, including the message the user will read.
 *
 * The protocol-level behaviour (handshake, tool list, error shape) is covered by
 * `scripts/smoke-mcpb.mjs`, which drives the built artifact over real stdio.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest"
import { loadConfig, applySupabaseEnv, ConfigError } from "../src/config"
import { setLogLevel } from "../src/log"

// These tests exercise the paths that log; keep the run output readable.
beforeAll(() => setLogLevel("silent"))

const BASE = {
  SKAT_EMAIL: "someone@example.test",
  SKAT_PASSWORD: "hunter2",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
}

let saved: NodeJS.ProcessEnv

beforeEach(() => {
  saved = process.env
  // Start from a clean slate so a developer's own .env can't colour the results.
  process.env = { ...BASE } as unknown as NodeJS.ProcessEnv
})

afterEach(() => {
  process.env = saved
  vi.restoreAllMocks()
})

describe("loadConfig", () => {
  it("accepts a minimal valid environment and applies the defaults", async () => {
    const config = await loadConfig()
    expect(config.email).toBe("someone@example.test")
    expect(config.supabaseUrl).toBe("https://project.supabase.co")
    expect(config.appUrl).toBe("https://skat.simonottosen.dk")
    expect(config.readOnly).toBe(false)
    expect(config.allowOpen).toBe(true)
    expect(config.toolTimeoutMs).toBe(30_000)
    expect(config.logLevel).toBe("info")
  })

  it("names every missing credential in one message", async () => {
    delete process.env.SKAT_EMAIL
    delete process.env.SKAT_PASSWORD
    await expect(loadConfig()).rejects.toThrow(ConfigError)
    await expect(loadConfig()).rejects.toThrow(/SKAT_EMAIL, SKAT_PASSWORD/)
  })

  it("rejects an email that is obviously not one", async () => {
    process.env.SKAT_EMAIL = "simon"
    await expect(loadConfig()).rejects.toThrow(/does not look like an email/)
  })

  it("refuses to send credentials over plain http", async () => {
    process.env.SUPABASE_URL = "http://project.supabase.co"
    await expect(loadConfig()).rejects.toThrow(/must use https/)
  })

  it("allows http for localhost, so a local Supabase works", async () => {
    process.env.SUPABASE_URL = "http://localhost:54321"
    const config = await loadConfig()
    expect(config.supabaseUrl).toBe("http://localhost:54321")
  })

  it("refuses a URL with credentials embedded in it", async () => {
    process.env.SUPABASE_URL = "https://user:pass@project.supabase.co"
    await expect(loadConfig()).rejects.toThrow(/must not embed credentials/)
  })

  it("reduces a URL to its origin", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co/rest/v1?foo=bar"
    const config = await loadConfig()
    expect(config.supabaseUrl).toBe("https://project.supabase.co")
  })

  it("reads booleans in the spellings a host might produce", async () => {
    for (const [raw, expected] of [
      ["true", true],
      ["TRUE", true],
      ["1", true],
      ["yes", true],
      ["false", false],
      ["0", false],
      ["", false],
    ] as const) {
      process.env.SKAT_READ_ONLY = raw
      expect((await loadConfig()).readOnly, `SKAT_READ_ONLY=${JSON.stringify(raw)}`).toBe(expected)
    }
  })

  it("rejects a boolean it cannot make sense of", async () => {
    process.env.SKAT_READ_ONLY = "sometimes"
    await expect(loadConfig()).rejects.toThrow(/must be true or false/)
  })

  it("inverts SKAT_DISABLE_OPEN into allowOpen", async () => {
    process.env.SKAT_DISABLE_OPEN = "true"
    expect((await loadConfig()).allowOpen).toBe(false)
  })

  it("clamps the timeout into a sane range instead of failing", async () => {
    process.env.SKAT_TOOL_TIMEOUT_MS = "10"
    expect((await loadConfig()).toolTimeoutMs).toBe(5_000)
    process.env.SKAT_TOOL_TIMEOUT_MS = "999999"
    expect((await loadConfig()).toolTimeoutMs).toBe(120_000)
  })

  it("rejects a timeout that is not a number", async () => {
    process.env.SKAT_TOOL_TIMEOUT_MS = "soon"
    await expect(loadConfig()).rejects.toThrow(/must be a number/)
  })

  it("falls back to info for an unknown log level", async () => {
    process.env.SKAT_LOG_LEVEL = "loud"
    expect((await loadConfig()).logLevel).toBe("info")
  })

  it("treats an unsubstituted MCPB placeholder as unset", async () => {
    // Some hosts pass `${user_config.foo}` through verbatim when the user left
    // an optional setting blank. Taking that literally would fail the startup.
    process.env.SKAT_READ_ONLY = "${user_config.read_only}"
    process.env.SKAT_TOOL_TIMEOUT_MS = "${user_config.tool_timeout_ms}"
    process.env.SKAT_APP_URL = "${user_config.app_url}"
    const config = await loadConfig()
    expect(config.readOnly).toBe(false)
    expect(config.toolTimeoutMs).toBe(30_000)
    expect(config.appUrl).toBe("https://skat.simonottosen.dk")
  })
})

describe("loadConfig auto-discovery", () => {
  /** Serve the app's HTML, the way `<PublicEnvScript />` renders it. */
  function mockApp(html: string, ok = true) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      text: async () => html,
    } as Response)
  }

  it("reads the Supabase config out of the app's window.__ENV__", async () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    const fetchMock = mockApp(
      '<script>window.__ENV__ = {"NEXT_PUBLIC_SUPABASE_URL":"https://discovered.supabase.co","NEXT_PUBLIC_SUPABASE_ANON_KEY":"discovered-key"}</script>'
    )
    const config = await loadConfig()
    expect(fetchMock).toHaveBeenCalledWith("https://skat.simonottosen.dk", expect.anything())
    expect(config.supabaseUrl).toBe("https://discovered.supabase.co")
    expect(config.supabaseAnonKey).toBe("discovered-key")
  })

  it("does not go to the network when both values are configured", async () => {
    const fetchMock = mockApp("")
    await loadConfig()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("explains what to set when the app is unreachable", async () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ENOTFOUND"))
    await expect(loadConfig()).rejects.toThrow(/set SUPABASE_URL and SUPABASE_ANON_KEY/)
  })

  it("survives HTML with no window.__ENV__ in it", async () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    mockApp("<html><body>hello</body></html>")
    await expect(loadConfig()).rejects.toThrow(ConfigError)
  })
})

describe("applySupabaseEnv", () => {
  it("publishes the settings under the names the shared engine reads", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    applySupabaseEnv(await loadConfig())
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://project.supabase.co")
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("anon-key")
  })
})
