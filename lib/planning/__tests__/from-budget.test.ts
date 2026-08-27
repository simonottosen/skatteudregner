import { describe, it, expect } from "vitest"
import { mortgageFromBudget, propertiesFromBudget } from "../from-budget"
import type { PlannedProperty } from "../types"
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

describe("propertiesFromBudget", () => {
  const summerHouse: PlannedProperty = {
    id: "prop-summer",
    label: "Sommerhuset",
    kind: "fritidsbolig",
    value: 1_800_000,
    landValue: 900_000,
    acquisitionAge: 55,
    disposalAge: null,
  }
  const theHome: PlannedProperty = {
    id: "prop-home",
    label: "Rækkehuset",
    kind: "helaarsbolig",
    value: 3_000_000,
    landValue: 1_000_000,
    acquisitionAge: 0,
    disposalAge: 80,
  }

  it("re-prices the home in place, keeping what only the plan knows", () => {
    // /skat and /budget know the two amounts and nothing else. The label, the
    // ownership window and the identity the loan is keyed on are the plan's own
    // and have to survive the next time either page changes.
    const [home, ...rest] = propertiesFromBudget([theHome, summerHouse], {
      value: 4_250_000,
      landValue: 1_400_000,
    })
    expect(home).toEqual({
      ...theHome,
      value: 4_250_000,
      landValue: 1_400_000,
    })
    expect(rest).toEqual([summerHouse])
  })

  it("leaves the summer house alone that neither page has heard of", () => {
    // Replacing the list wholesale is how it would disappear.
    const next = propertiesFromBudget([summerHouse], {
      value: 3_000_000,
      landValue: 0,
    })
    expect(next).toHaveLength(2)
    expect(next[1]).toEqual(summerHouse)
  })

  it("makes the loan-bearing home the plan does not lead with", () => {
    // The plan's loan is secured on `properties[0]`, so a list that starts with
    // a fritidsbolig has no home for the budget's amounts to land on.
    const [home] = propertiesFromBudget([summerHouse], {
      value: 3_000_000,
      landValue: 800_000,
    })
    expect(home).toMatchObject({
      kind: "helaarsbolig",
      label: "Bolig",
      value: 3_000_000,
      landValue: 800_000,
      acquisitionAge: 0,
      disposalAge: null,
    })
    expect(home.id).toBeTruthy()
  })

  it("leaves the list alone when the budget describes no home", () => {
    // "/skat has nothing to say about a property" and "the household sold up"
    // are different claims, and only the user can make the second one.
    const list = [theHome, summerHouse]
    expect(propertiesFromBudget(list, { value: 0, landValue: 0 })).toEqual(list)
    expect(propertiesFromBudget([], { value: 0, landValue: 0 })).toEqual([])
  })

  it("returns a new list rather than the one it was handed", () => {
    const list = [theHome]
    expect(propertiesFromBudget(list, { value: 0, landValue: 0 })).not.toBe(list)
  })

  it("carries whole, non-negative kroner into the tax", () => {
    const [home] = propertiesFromBudget([], {
      value: 3_000_000.6,
      landValue: -1,
    })
    expect(home.value).toBe(3_000_001)
    expect(home.landValue).toBe(0)
  })
})
