import { describe, it, expect } from "vitest"
import { computeBudgetSummary, normalizeBudget } from "../state"
import { savingsBreakdownView } from "../savings-view"

/** 30.000 in; `savings` and `sinking` are monthly kroner in those buckets. */
function summary(opts: { savings?: number; sinking?: number; mortgage?: boolean }) {
  const state = normalizeBudget({
    mode: "single",
    person1: { name: "P1", incomeSource: "skat", manualIncome: 0, items: [] },
    categories: [
      { id: "mad", name: "Mad og dagligvarer" },
      { id: "opsparing", name: "Opsparing" },
      { id: "hensat", name: "Bilreparation" },
    ],
    sharedItems: [
      { id: "a", label: "Mad", amount: 5000, categoryId: "mad" },
      { id: "b", label: "Opsparing", amount: opts.savings ?? 0, categoryId: "opsparing" },
      { id: "c", label: "Bilreparation", amount: opts.sinking ?? 0, categoryId: "hensat" },
    ],
    mortgage: opts.mortgage
      ? {
          enabled: true,
          homeValue: 1_000_000,
          remainingYears: 30,
          ltv: 0.5,
          interestRate: 0.04,
          bidragssats: 0.006,
          interestOnly: false,
        }
      : undefined,
  })
  return computeBudgetSummary(state, 30000, 0)
}

describe("savingsBreakdownView", () => {
  it("stays quiet when nothing is tagged", () => {
    // With no savings line the breakdown would only restate "Til rådighed"
    // under new labels.
    expect(savingsBreakdownView(summary({}))).toBeNull()
  })

  it("shows consumption, the allocation and the real saving", () => {
    const view = savingsBreakdownView(summary({ savings: 3000 }))
    expect(view?.figures).toEqual([
      { label: "Forbrug", amount: 5000 },
      { label: "Afsat til opsparing", amount: 3000 },
      { label: "Reel opsparing / md.", amount: 25000, highlight: true },
    ])
  })

  it("adds the mortgage to the consumption figure it labels", () => {
    const view = savingsBreakdownView(summary({ savings: 3000, mortgage: true }))
    const forbrug = view?.figures[0]
    expect(forbrug?.label).toBe("Forbrug (inkl. lån)")
    expect(forbrug?.amount).toBeGreaterThan(5000)
  })

  it("gives sinking funds a line of their own", () => {
    const view = savingsBreakdownView(summary({ savings: 3000, sinking: 1000 }))
    expect(view?.figures.map((f) => f.label)).toEqual([
      "Forbrug",
      "Hensat til kendte udgifter",
      "Afsat til opsparing",
      "Reel opsparing / md.",
    ])
    // The set-aside is neither consumed nor saved: it is exactly the gap.
    expect(view?.figures[1].amount).toBe(1000)
    expect(view?.figures[3].amount).toBe(24000)
  })

  it("renders for a household that only has sinking funds", () => {
    const view = savingsBreakdownView(summary({ sinking: 1000 }))
    expect(view?.figures.map((f) => f.label)).not.toContain("Afsat til opsparing")
    expect(view?.notes).toHaveLength(2)
  })

  it("explains why the savings rate on Resultat is lower", () => {
    // The rate there still counts savings as an expense; a user watching that
    // number should not have to guess why this page disagrees.
    const notes = savingsBreakdownView(summary({ savings: 3000 }))?.notes ?? []
    expect(notes.some((n) => n.includes("Opsparingsraten på Resultat"))).toBe(true)
  })
})
