import { describe, it, expect } from "vitest"
import {
  generateBudget,
  estimateMortgage,
  estimateMortgagePayment,
} from "../generate-budget"

function byLabel(items: { label: string; amount: number }[], label: string) {
  return items.find((i) => i.label === label)
}

describe("generateBudget", () => {
  it("scales food and core costs for a single adult renter", () => {
    const items = generateBudget({
      adults: 1,
      children: 0,
      cars: 0,
      housingCost: 8000,
      ownsHome: false,
      vacationLevel: "low",
    })

    expect(byLabel(items, "Husleje / boliglån")?.amount).toBe(8000)
    expect(byLabel(items, "Dagligvarer")?.amount).toBe(1750)
    // No children → no childcare; no car → no car costs; renter → no maintenance.
    expect(byLabel(items, "Børnepasning (institution/SFO)")).toBeUndefined()
    expect(byLabel(items, "Bil (afdrag/leasing)")).toBeUndefined()
    expect(byLabel(items, "Vedligehold af bolig")).toBeUndefined()
    // Public transport higher when carless.
    expect(byLabel(items, "Offentlig transport")?.amount).toBe(600)
  })

  it("produces a family-of-4 owner budget with children and a car", () => {
    const items = generateBudget({
      adults: 2,
      children: 2,
      cars: 1,
      housingCost: 10000,
      ownsHome: true,
      vacationLevel: "medium",
    })

    expect(byLabel(items, "Dagligvarer")?.amount).toBe(6300) // 1750*2 + 1400*2
    expect(byLabel(items, "Børnepasning (institution/SFO)")?.amount).toBe(4000)
    // Owners get a maintenance line; property tax is NOT bundled in here.
    expect(byLabel(items, "Vedligehold af bolig")?.amount).toBe(900)
    expect(byLabel(items, "Bil (afdrag/leasing)")?.amount).toBe(2500)
    expect(byLabel(items, "Offentlig transport")?.amount).toBe(600) // (300)*2 with a car

    const total = items.reduce((s, i) => s + i.amount, 0)
    expect(total).toBeGreaterThan(28000)
    expect(total).toBeLessThan(42000)
  })

  it("never returns zero-amount items and rounds to nearest 50", () => {
    const items = generateBudget({
      adults: 2,
      children: 1,
      cars: 2,
      housingCost: 12345,
      ownsHome: true,
      vacationLevel: "high",
    })

    for (const item of items) {
      expect(item.amount).toBeGreaterThan(0)
      expect(item.amount % 50).toBe(0)
    }
  })

  it("scales discretionary spending with lifestyle but keeps fixed costs stable", () => {
    const base = {
      adults: 2,
      children: 0,
      cars: 1,
      housingCost: 10000,
      ownsHome: false,
      vacationLevel: "medium" as const,
    }
    const frugal = generateBudget({ ...base, lifestyle: -1 })
    const average = generateBudget({ ...base, lifestyle: 0 })
    const lavish = generateBudget({ ...base, lifestyle: 1 })

    // Discretionary lines move ±50% at the extremes.
    const food = (items: { label: string; amount: number }[]) =>
      byLabel(items, "Dagligvarer")?.amount ?? 0
    expect(food(average)).toBe(3500) // 1750 * 2
    expect(food(frugal)).toBe(1750) // ×0.5
    expect(food(lavish)).toBe(5250) // ×1.5

    const vacation = (items: { label: string; amount: number }[]) =>
      byLabel(items, "Ferie (opsparing)")?.amount ?? 0
    expect(vacation(lavish)).toBeGreaterThan(vacation(average))
    expect(vacation(frugal)).toBeLessThan(vacation(average))

    // Insurances and rent must not move with lifestyle.
    for (const label of [
      "Husleje / boliglån",
      "Indbo- og ulykkesforsikring",
      "Sundhedsforsikring og medicin",
      "A-kasse og fagforening",
    ]) {
      expect(byLabel(frugal, label)?.amount).toBe(byLabel(lavish, label)?.amount)
    }
  })

  it("estimates a monthly mortgage payment from annual interest", () => {
    expect(estimateMortgagePayment(0)).toBe(0)
    // ~1.0M loan implied by 40.000 kr./yr interest at 4%, 30-yr annuity.
    const payment = estimateMortgagePayment(40000)
    expect(payment).toBeGreaterThan(4000)
    expect(payment).toBeLessThan(5500)
    expect(payment % 100).toBe(0)
  })

  it("breaks the mortgage payment into interest and afdrag", () => {
    expect(estimateMortgage(0)).toEqual({
      interest: 0,
      afdrag: 0,
      total: 0,
      principal: 0,
    })

    const m = estimateMortgage(40000)
    // Monthly interest is the annual interest / 12.
    expect(m.interest).toBe(Math.round(40000 / 12))
    // Afdrag (principal repayment) is derived from the rate and is positive.
    expect(m.afdrag).toBeGreaterThan(0)
    // Implied principal at the assumed 4% rate.
    expect(m.principal).toBe(1_000_000)
    // Interest + afdrag should be within rounding of the total payment.
    expect(Math.abs(m.interest + m.afdrag - m.total)).toBeLessThanOrEqual(100)
  })
})
