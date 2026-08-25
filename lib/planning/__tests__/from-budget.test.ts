import { describe, it, expect } from "vitest"
import { mortgageFromBudget } from "../from-budget"
import {
  DEFAULT_MORTGAGE,
  computeMortgage,
  mortgageMonthlyTotal,
  type MortgageState,
} from "@/lib/budget/mortgage"

const enabled: MortgageState = {
  ...DEFAULT_MORTGAGE,
  enabled: true,
  homeValue: 2_500_000,
  ltv: 0.8, // a 2 mio. loan
  interestRate: 0.04,
  remainingYears: 20,
  bidragssats: 0.006,
}

describe("mortgageFromBudget", () => {
  it("carries the budget's own deduction and the rate that priced it", () => {
    const link = mortgageFromBudget(enabled, mortgageMonthlyTotal(enabled))
    expect(link.mortgageBudgetedMonthly).toBeCloseTo(
      computeMortgage(enabled).monthlyTotal,
      6
    )
    expect(link.mortgageBidragssats).toBe(0.006)
  })

  it("takes the summary's figure, not a second computation of it", () => {
    // The surplus the plan starts from was reduced by *this* number. Recomputing
    // it from the module would let the two drift the moment either page changes
    // how it rounds or what it includes — the shape of issue #2.
    const link = mortgageFromBudget(enabled, 9_999)
    expect(link.mortgageBudgetedMonthly).toBe(9_999)
  })

  it("carries nothing at all when the module is off", () => {
    // The default state of /budget. It deducts nothing, so the plan is told
    // nothing was deducted — and gets no bidragssats either, because a fee
    // without a deduction is charged against the saving for free.
    const off: MortgageState = { ...enabled, enabled: false }
    expect(mortgageFromBudget(off, 0)).toEqual({
      mortgageBidragssats: 0,
      mortgageBudgetedMonthly: 0,
    })
    // Even handed a payment, a disabled module cannot vouch for it.
    expect(mortgageFromBudget(off, 12_119).mortgageBudgetedMonthly).toBe(0)
    expect(mortgageFromBudget(off, 12_119).mortgageBidragssats).toBe(0)
  })

  it("never reports a negative deduction", () => {
    // A hand-back below zero would be a payment the household received; the
    // simulation would add it to the saving every year.
    expect(mortgageFromBudget(enabled, -5_000).mortgageBudgetedMonthly).toBe(0)
  })
})
