import { describe, it, expect } from "vitest"
import { formatDKK, formatPercent, parseDKK } from "@/lib/format"

describe("formatDKK", () => {
  it("formats positive amount", () => {
    expect(formatDKK(1234567)).toBe("1.234.567 kr.")
  })
  it("formats negative amount", () => {
    expect(formatDKK(-5000)).toBe("-5.000 kr.")
  })
  it("formats zero", () => {
    expect(formatDKK(0)).toBe("0 kr.")
  })
  it("formats small amount", () => {
    expect(formatDKK(42)).toBe("42 kr.")
  })
  it("rounds decimals", () => {
    expect(formatDKK(1234.6)).toBe("1.235 kr.")
  })
})

describe("formatPercent", () => {
  it("formats rate", () => {
    expect(formatPercent(0.4457)).toBe("44,57%")
  })
  it("formats zero", () => {
    expect(formatPercent(0)).toBe("0,00%")
  })
  it("formats small rate", () => {
    expect(formatPercent(0.08)).toBe("8,00%")
  })
})

describe("parseDKK", () => {
  it("parses dotted amount", () => {
    expect(parseDKK("1.234.567")).toBe(1234567)
  })
  it("parses with kr suffix", () => {
    expect(parseDKK("1.234.567 kr.")).toBe(1234567)
  })
  it("parses with comma decimal", () => {
    expect(parseDKK("1.234,50")).toBe(1234.5)
  })
  it("parses plain number", () => {
    expect(parseDKK("5000")).toBe(5000)
  })
})
