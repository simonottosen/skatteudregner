import { describe, it, expect } from "vitest"
import { getRates, TAX_RATES } from "@/lib/tax/rates"
import type { TaxYear } from "@/lib/tax/types"

describe("Tax rates", () => {
  it("1.1 - rates exist for all supported years", () => {
    for (const year of [2024, 2025, 2026] as TaxYear[]) {
      expect(TAX_RATES[year]).toBeDefined()
      expect(getRates(year).year).toBe(year)
    }
  })

  it("1.2 - AM-bidrag is 8% for all years", () => {
    for (const year of [2024, 2025, 2026] as TaxYear[]) {
      expect(getRates(year).amBidragRate).toBe(0.08)
    }
  })

  it("1.3 - 2026 has mellemskat=7.5%, topskat=7.5%, top-topskat=5%", () => {
    const r = getRates(2026)
    expect(r.mellemSkatRate).toBe(0.075)
    expect(r.topSkatRate).toBe(0.075)
    expect(r.topTopSkatRate).toBe(0.05)
  })

  it("1.4 - 2024/2025 have no top-topskat", () => {
    expect(getRates(2024).topTopSkatRate).toBe(0)
    expect(getRates(2025).topTopSkatRate).toBe(0)
  })

  it("1.5 - personfradrag 2026 = 54100", () => {
    expect(getRates(2026).personFradrag).toBe(54100)
  })

  it("1.6 - skatteloft 2026 = 44.57%", () => {
    expect(getRates(2026).skatteLoft).toBe(0.4457)
  })

  it("1.7 - stock progression limit 2026 = 79400", () => {
    expect(getRates(2026).stockProgressionLimit).toBe(79400)
  })

  it("1.8 - throws for unsupported year", () => {
    expect(() => getRates(2023 as TaxYear)).toThrow()
  })

  it("2026 mellemskat threshold = 641200", () => {
    expect(getRates(2026).mellemSkatThreshold).toBe(641200)
  })

  it("2026 topskat threshold = 777900", () => {
    expect(getRates(2026).topSkatThreshold).toBe(777900)
  })

  it("2026 top-topskat threshold = 2592700", () => {
    expect(getRates(2026).topTopSkatThreshold).toBe(2592700)
  })

  it("2026 beskæftigelsesfradrag rate = 12.75%, max = 63300", () => {
    const r = getRates(2026)
    expect(r.beskaeftigelsesFradragRate).toBe(0.1275)
    expect(r.beskaeftigelsesFradragMax).toBe(63300)
  })

  it("2026 ratepension max = 68700", () => {
    expect(getRates(2026).ratepensionMax).toBe(68700)
  })

  it("2026 capital income threshold = 55000", () => {
    expect(getRates(2026).capitalKapitalindkomstThreshold).toBe(55000)
  })
})
