import { describe, it, expect } from "vitest"
import type { TaxYear } from "@/lib/tax/types"

describe("Test infrastructure", () => {
  it("should support TaxYear type", () => {
    const year: TaxYear = 2026
    expect(year).toBe(2026)
  })

  it("should import from barrel export", async () => {
    const mod = await import("@/lib/tax")
    expect(mod).toBeDefined()
  })
})
