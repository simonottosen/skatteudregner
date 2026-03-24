import { describe, it, expect } from "vitest"
import { getMunicipality, getMunicipalityList } from "@/lib/tax/municipalities"
import type { TaxYear } from "@/lib/tax/types"

describe("Municipalities", () => {
  it("1.8 - 98 municipalities loaded for each year", () => {
    for (const year of [2024, 2025, 2026] as TaxYear[]) {
      expect(getMunicipalityList(year)).toHaveLength(98)
    }
  })

  it("1.9 - København lookup works", () => {
    const kbh = getMunicipality("København", 2026)
    expect(kbh).toBeDefined()
    expect(kbh!.code).toBe(101)
    expect(kbh!.taxRate).toBeCloseTo(23.39, 1)
  })

  it("1.10 - all municipalities have required fields", () => {
    for (const m of getMunicipalityList(2026)) {
      expect(m.name).toBeTruthy()
      expect(m.code).toBeGreaterThan(0)
      expect(m.taxRate).toBeGreaterThan(0)
      expect(typeof m.churchTaxRate).toBe("number")
      expect(typeof m.grundskyldRate).toBe("number")
      expect(typeof m.isRural).toBe("boolean")
    }
  })

  it("1.10 - all tax rates in reasonable range", () => {
    for (const m of getMunicipalityList(2026)) {
      expect(m.taxRate).toBeGreaterThanOrEqual(20)
      expect(m.taxRate).toBeLessThanOrEqual(28)
      expect(m.churchTaxRate).toBeGreaterThanOrEqual(0.3)
      expect(m.churchTaxRate).toBeLessThanOrEqual(1.5)
    }
  })

  it("1.11 - rural communes exist", () => {
    const ruralCount = getMunicipalityList(2026).filter(
      (m) => m.isRural,
    ).length
    expect(ruralCount).toBeGreaterThanOrEqual(1)
  })

  it("returns undefined for unknown municipality", () => {
    expect(getMunicipality("Narnia")).toBeUndefined()
  })

  it("Greve has correct 2026 data", () => {
    const greve = getMunicipality("Greve", 2026)
    expect(greve).toBeDefined()
    expect(greve!.region).toBe("Sjælland")
  })

  it("rural communes include known examples", () => {
    const list = getMunicipalityList(2026)
    const hjorring = list.find((m) => m.name === "Hjørring")
    expect(hjorring?.isRural).toBe(true)
    const bornholm = list.find((m) => m.name === "Bornholm")
    expect(bornholm?.isRural).toBe(true)
  })
})
