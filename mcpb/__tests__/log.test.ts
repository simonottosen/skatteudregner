/**
 * Logging invariants for the MCPB bundle.
 *
 * Two things must hold, or the extension is broken in ways that are painful to
 * diagnose: nothing but JSON-RPC may reach **stdout** (it is the wire), and the
 * user's password must never reach the host's log file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { captureConsole, errorMessage, log, parseLogLevel, setLogLevel } from "../src/log"

let stderrLines: string[]
let stdoutWrites: string[]

beforeEach(() => {
  stderrLines = []
  stdoutWrites = []
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderrLines.push(String(chunk))
    return true
  })
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdoutWrites.push(String(chunk))
    return true
  })
  setLogLevel("debug")
})

afterEach(() => {
  vi.restoreAllMocks()
  setLogLevel("info")
})

describe("log", () => {
  it("writes to stderr and never to stdout", () => {
    log.info("hello")
    expect(stderrLines.join("")).toContain("hello")
    expect(stdoutWrites).toEqual([])
  })

  it("tags each line with a timestamp, the server name and the level", () => {
    log.warn("careful")
    expect(stderrLines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[skatteberegner\] WARN careful\n$/)
  })

  it("redacts secrets out of the details object", () => {
    log.info("signing in", { email: "a@b.test", password: "hunter2", accessToken: "ey.J" })
    const line = stderrLines.join("")
    expect(line).toContain("a@b.test")
    expect(line).not.toContain("hunter2")
    expect(line).not.toContain("ey.J")
    expect(line).toContain("[redacted]")
  })

  it("suppresses anything below the configured level", () => {
    setLogLevel("warn")
    log.debug("noise")
    log.info("noise")
    log.warn("signal")
    expect(stderrLines.join("")).not.toContain("noise")
    expect(stderrLines.join("")).toContain("signal")
  })

  it("says nothing at all when silenced", () => {
    setLogLevel("silent")
    log.error("boom")
    expect(stderrLines).toEqual([])
  })

  it("does not throw on details it cannot serialize", () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => log.info("cyclic", cyclic)).not.toThrow()
    expect(stderrLines.join("")).toContain("not serializable")
  })
})

describe("captureConsole", () => {
  const original = { log: console.log, info: console.info, debug: console.debug, warn: console.warn }
  afterEach(() => Object.assign(console, original))

  it("moves console.log off stdout, so a stray call can't corrupt the protocol", () => {
    captureConsole()
    console.log("a stray log from a dependency")
    expect(stdoutWrites).toEqual([])
    expect(stderrLines.join("")).toContain("a stray log from a dependency")
  })

  it("serializes non-string arguments rather than printing [object Object]", () => {
    captureConsole()
    console.log("row", { id: 7 })
    expect(stderrLines.join("")).toContain('{"id":7}')
  })
})

describe("parseLogLevel", () => {
  it("accepts the documented levels, case-insensitively", () => {
    expect(parseLogLevel("DEBUG")).toBe("debug")
    expect(parseLogLevel("  silent ")).toBe("silent")
  })

  it("falls back rather than throwing on nonsense", () => {
    expect(parseLogLevel("chatty")).toBe("info")
    expect(parseLogLevel(undefined)).toBe("info")
  })
})

describe("errorMessage", () => {
  it("unwraps the useful part of anything that gets thrown", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom")
    expect(errorMessage("boom")).toBe("boom")
    expect(errorMessage({ code: 42 })).toBe('{"code":42}')
    expect(errorMessage(undefined)).toBe("undefined")
  })
})
