import { describe, it, expect } from "vitest"
import {
  applyDerivedDefaults,
  homeFromSources,
  loansFromBudget,
  mortgageFromBudget,
  planFiguresFromBudget,
  propertiesFromBudget,
  type BudgetMortgage,
  type PlanningDerivedDefaults,
} from "../from-budget"
import { LOAN_TYPE_DEFAULTS, newPlannedLoan } from "../loans"
import { ASSESSMENT_FACTOR } from "../taxation"
import { DEFAULT_PLANNING_STATE, type PlannedProperty } from "../types"
import {
  DEFAULT_MORTGAGE,
  computeMortgage,
  mortgageMonthlyTotal,
  type MortgageState,
} from "@/lib/budget/mortgage"
import {
  computeBudgetSummary,
  defaultBudgetState,
  type BudgetCategory,
  type BudgetItem,
  type BudgetState,
} from "@/lib/budget/state"

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
  it("carries the budget's own deduction and the loan that priced it", () => {
    const link = mortgageFromBudget(
      enabled,
      mortgageMonthlyTotal(enabled),
      2_000_000
    )
    expect(link.mortgageBudgetedMonthly).toBeCloseTo(
      computeMortgage(enabled).monthlyTotal,
      6
    )
    expect(link.mortgage).toEqual({
      balance: 2_000_000,
      rate: 0.04,
      termYears: 20,
      bidragssats: 0.006,
    })
  })

  it("takes the summary's figure, not a second computation of it", () => {
    // The surplus the plan starts from was reduced by *this* number. Recomputing
    // it from the module would let the two drift the moment either page changes
    // how it rounds or what it includes — the shape of issue #2.
    const link = mortgageFromBudget(enabled, 9_999, 2_000_000)
    expect(link.mortgageBudgetedMonthly).toBe(9_999)
  })

  it("vouches for no deduction and no fee when the module is off", () => {
    // The default state of /budget. It deducts nothing, so the plan is told
    // nothing was deducted — and gets no bidragssats either, because a fee
    // without a deduction is charged against the saving for free.
    const off: MortgageState = { ...enabled, enabled: false }
    expect(mortgageFromBudget(off, 0, 0).mortgageBudgetedMonthly).toBe(0)
    expect(mortgageFromBudget(off, 0, 0).mortgage.bidragssats).toBe(0)
    // Even handed a payment, a disabled module cannot vouch for it.
    expect(mortgageFromBudget(off, 12_119, 0).mortgageBudgetedMonthly).toBe(0)
    expect(mortgageFromBudget(off, 12_119, 0).mortgage.bidragssats).toBe(0)
  })

  it("keeps the balance the caller derived with the module off", () => {
    // The renteudgifter typed on /skat imply a loan whether or not /budget's
    // realkredit section was ever filled in — that plan owes the money, and
    // `mortgageBudgetNotice` is what tells the user the budget does not know.
    const off: MortgageState = { ...enabled, enabled: false }
    const link = mortgageFromBudget(off, 0, 1_750_000)
    expect(link.mortgage.balance).toBe(1_750_000)
    // On the terms a hand-added realkreditlån would start on, since the module
    // that could have stated them is off.
    expect(link.mortgage.rate).toBe(LOAN_TYPE_DEFAULTS.realkredit.rate)
    expect(link.mortgage.termYears).toBe(
      LOAN_TYPE_DEFAULTS.realkredit.termMonths / 12
    )
  })

  it("never reports a negative deduction", () => {
    // A hand-back below zero would be a payment the household received; the
    // simulation would add it to the saving every year.
    expect(
      mortgageFromBudget(enabled, -5_000, 2_000_000).mortgageBudgetedMonthly
    ).toBe(0)
  })
})

describe("loansFromBudget", () => {
  const budgetMortgage: BudgetMortgage = {
    balance: 1_900_000,
    rate: 0.04,
    termYears: 20,
    bidragssats: 0.006,
  }

  it("gives a plan with no debt the loan the budget describes", () => {
    const [loan, ...rest] = loansFromBudget([], budgetMortgage, "prop-home")
    expect(rest).toEqual([])
    expect(loan).toMatchObject({
      type: "realkredit",
      propertyId: "prop-home",
      principal: 1_900_000,
      rate: 0.04,
      termMonths: 240,
      bidragssats: 0.006,
    })
    expect(loan.id).toBeTruthy()
  })

  it("re-prices the realkreditlån the plan already has", () => {
    const existing = newPlannedLoan("realkredit", "prop-home")
    const [loan, ...rest] = loansFromBudget(
      [existing],
      budgetMortgage,
      "prop-home"
    )
    expect(rest).toEqual([])
    // The same entry, so the row the user has open does not jump.
    expect(loan.id).toBe(existing.id)
    expect(loan.principal).toBe(1_900_000)
  })

  it("leaves the loans the other pages have never heard of alone", () => {
    // /budget knows about one housing line. The billån the user added on
    // /planlaegning has to survive the next edit to either page.
    const car = newPlannedLoan("bank", null)
    const next = loansFromBudget([car], budgetMortgage, "prop-home")
    expect(next).toHaveLength(2)
    expect(next.map((l) => l.type)).toEqual(["realkredit", "bank"])
    expect(next[1]).toEqual(car)
  })

  it("writes to the first realkreditlån and no other", () => {
    // A household with two: the budget's single housing line cannot say which
    // is which, so it re-prices one and leaves the second as the user typed it.
    const first = { ...newPlannedLoan("realkredit", "prop-home"), id: "loan-a" }
    const second = {
      ...newPlannedLoan("realkredit", "prop-home"),
      id: "loan-b",
      principal: 400_000,
    }
    const next = loansFromBudget([first, second], budgetMortgage, "prop-home")
    expect(next[0].principal).toBe(1_900_000)
    expect(next[1]).toEqual(second)
  })

  it("keeps an afdragsfri periode the budget cannot describe", () => {
    // `MortgageState.interestOnly` is a boolean with no end date, so it cannot
    // say how many years are left. Overwriting the user's own number would
    // start repaying a loan they said was afdragsfrit until 2031.
    const afdragsfri = {
      ...newPlannedLoan("realkredit", "prop-home"),
      interestOnlyYears: 5,
    }
    const [loan] = loansFromBudget([afdragsfri], budgetMortgage, "prop-home")
    expect(loan.interestOnlyYears).toBe(5)
  })

  it("does not delete a loan the budget has nothing to say about", () => {
    // "The module is off and /skat states no interest" is not "the household
    // paid the mortgage off"; only the user can make that second claim.
    const existing = newPlannedLoan("realkredit", "prop-home")
    expect(
      loansFromBudget([existing], { ...budgetMortgage, balance: 0 }, "prop-home")
    ).toEqual([existing])
  })

  it("leaves a renter's loan secured on nothing", () => {
    const [loan] = loansFromBudget([], budgetMortgage, null)
    expect(loan.propertyId).toBeNull()
  })

  it("gives the annuity a term to divide by", () => {
    // A `remainingYears` of nothing is a loan with no payments to make, and the
    // projection's annuity step would divide by its month count.
    const [loan] = loansFromBudget(
      [],
      { ...budgetMortgage, termYears: 0 },
      "prop-home"
    )
    expect(loan.termMonths).toBeGreaterThanOrEqual(1)
  })
})

/**
 * The issue-#36 household, summarised the way /budget summarises it: 50.000
 * kr./md. in, and whatever lines are handed in. Built through
 * `computeBudgetSummary` rather than by hand so the figures under test are the
 * ones the page actually produces, tags and all.
 */
function summaryOf(
  lines: [amount: number, categoryId: string][],
  mortgage: Partial<MortgageState> = {}
) {
  const base = defaultBudgetState()
  const categories: BudgetCategory[] = [
    { id: "bolig", name: "Bolig" },
    { id: "opsparing", name: "Opsparing", kind: "savings" },
    { id: "tag", name: "Nyt tag", kind: "sinking" },
    { id: "uncategorized", name: "Øvrigt" },
  ]
  const sharedItems: BudgetItem[] = lines.map(([amount, categoryId], i) => ({
    id: `b-${i}`,
    label: categoryId,
    amount,
    categoryId,
  }))
  const state: BudgetState = {
    ...base,
    mode: "single",
    person1: { ...base.person1, incomeSource: "manual", manualIncome: 50_000 },
    sharedItems,
    categories,
    mortgage: { ...base.mortgage, ...mortgage },
  }
  return computeBudgetSummary(state, 0, 0)
}

describe("planFiguresFromBudget", () => {
  it("credits a savings line to the contribution instead of the forbrug", () => {
    // The repro in issue #36, line for line. Tagging 4.000 kr. as savings
    // changes nothing about what the household consumes or puts away, so
    // neither figure may move — before the fix the contribution fell by 4.000
    // and the spending rose by the same 4.000, charging it twice.
    const without = planFiguresFromBudget(summaryOf([[24_000, "bolig"]]))
    const with_ = planFiguresFromBudget(
      summaryOf([
        [24_000, "bolig"],
        [4_000, "opsparing"],
      ])
    )
    expect(without).toEqual({ monthlyContribution: 26_000, annualSpending: 288_000 })
    expect(with_).toEqual(without)
  })

  it("leaves the 25× FI target where it was", () => {
    // The second half of the double count: the target is 25× the spending, so
    // an inflated forbrug pushed the FI date out on top of the smaller saving.
    const target = (lines: [number, string][]) =>
      planFiguresFromBudget(summaryOf(lines)).annualSpending * 25
    expect(
      target([
        [24_000, "bolig"],
        [4_000, "opsparing"],
      ])
    ).toBe(target([[24_000, "bolig"]]))
  })

  it("reconciles with the household's income, whatever it tags", () => {
    // Nothing lost and nothing counted twice: every krone of income is either
    // saved, consumed, or paid to the lender. Both figures are whole kroner —
    // the plan's inputs are — so they reconcile to within that rounding and no
    // further, which is a smaller gap than any tagging mistake could open.
    const lines: [number, string][] = [
      [18_000, "bolig"],
      [4_500, "opsparing"],
      [1_500, "tag"],
      [3_000, "uncategorized"],
    ]
    for (const mortgage of [{}, { enabled: true, homeValue: 2_000_000 }]) {
      const summary = summaryOf(lines, mortgage)
      const { monthlyContribution, annualSpending } =
        planFiguresFromBudget(summary)
      const accountedFor =
        monthlyContribution + annualSpending / 12 + summary.mortgageMonthly
      expect(Math.abs(accountedFor - summary.budgetIncome)).toBeLessThan(1)
    }
  })

  it("keeps a sinking fund in the forbrug rather than in the saving", () => {
    // The judgement call, pinned. A sinking fund is deferred consumption — the
    // money for a new roof is money that will be spent — so netting it out of
    // the FI denominator (`consumptionExpenses`) would price the household's
    // whole retirement on the roof never being replaced. Only `kind: "savings"`
    // moves; that is also what makes the contribution `totalSavings` rather
    // than `surplus`, which is this same figure with the sinking fund added.
    const figures = planFiguresFromBudget(
      summaryOf([
        [24_000, "bolig"],
        [2_000, "tag"],
      ])
    )
    expect(figures.monthlyContribution).toBe(24_000)
    expect(figures.annualSpending).toBe(26_000 * 12)
  })

  it("still floors an overspending household at a saving of zero", () => {
    // Unchanged behaviour, and the reason the deficit survives on `remaining`
    // for the page to warn about instead of becoming a negative contribution.
    const figures = planFiguresFromBudget(summaryOf([[60_000, "bolig"]]))
    expect(figures.monthlyContribution).toBe(0)
    expect(figures.annualSpending).toBe(720_000)
  })

  it("never reports a negative forbrug", () => {
    // A 25× target below zero would report a household already independent.
    expect(
      planFiguresFromBudget({
        budgetExpenses: 1_000,
        allocatedSavings: 5_000,
        totalSavings: 10_000,
      }).annualSpending
    ).toBe(0)
  })
})

const taxBases = { assessmentBasis: 2_400_000, landAssessmentBasis: 800_000 }
const noMortgage = { enabled: false, homeValue: 0 }

describe("homeFromSources", () => {
  it("recovers the home from the beskatningsgrundlag entered on /skat", () => {
    // Issue #50: the Bolig tab collects only the ~80 % grundlag, so reading
    // `propertyValue`/`landValue` — literal 0 everywhere in the app — meant a
    // home reached a plan solely through /budget's realkredit module.
    expect(homeFromSources(noMortgage, taxBases)).toEqual({
      value: 3_000_000,
      landValue: 1_000_000,
    })
  })

  it("hands the tax back exactly the grundlag the user typed", () => {
    // The round trip that makes converting sound rather than merely convenient:
    // `createPropertyPortfolioTax` multiplies the plan's value by this same
    // factor, so the projection taxes the entered number and not a re-estimate.
    const home = homeFromSources(noMortgage, taxBases)
    expect(home.value * ASSESSMENT_FACTOR).toBe(taxBases.assessmentBasis)
    expect(home.landValue * ASSESSMENT_FACTOR).toBe(
      taxBases.landAssessmentBasis
    )
  })

  it("uses an entered grundværdi even when the mortgage module is on", () => {
    // The half of #50 that is a wrong number rather than a missing one: with
    // `landValue` structurally 0 the heuristic always won, so grundskyld was
    // charged on 40 % of the home value however carefully the user had typed
    // their real grundværdi. 40 % of 3 mio. would be 1,2 mio.
    const home = homeFromSources(
      { enabled: true, homeValue: 3_000_000 },
      taxBases
    )
    expect(home).toEqual({ value: 3_000_000, landValue: 1_000_000 })
  })

  it("falls back to the 40 % heuristic only when no grundværdi was entered", () => {
    // Still a guess, but now a last resort rather than the only outcome.
    expect(
      homeFromSources({ enabled: true, homeValue: 3_000_000 }, undefined)
        .landValue
    ).toBe(1_200_000)
    expect(
      homeFromSources(noMortgage, { assessmentBasis: 2_400_000 }).landValue
    ).toBe(1_200_000)
  })

  it("prefers the market value the mortgage module was given outright", () => {
    // There the user stated the value itself; here it has to be recovered from
    // a basis, so the direct answer wins when the module has one.
    expect(
      homeFromSources({ enabled: true, homeValue: 4_100_000 }, taxBases).value
    ).toBe(4_100_000)
  })

  it("falls back to /skat when the mortgage module states no value", () => {
    // `homeValue` is 0 until the module is filled in, and a home worth nothing
    // is dropped downstream — so an empty module must not shadow the Bolig tab.
    expect(
      homeFromSources({ enabled: true, homeValue: 0 }, taxBases).value
    ).toBe(3_000_000)
  })

  it("describes no home when neither page has one", () => {
    expect(homeFromSources(noMortgage, undefined)).toEqual({
      value: 0,
      landValue: 0,
    })
    expect(
      homeFromSources(noMortgage, {
        assessmentBasis: 0,
        landAssessmentBasis: 0,
      })
    ).toEqual({ value: 0, landValue: 0 })
  })

  it("ignores a disabled module that still remembers a value", () => {
    // Turning the realkredit section off is a statement about the budget, not
    // about the home; /skat is then the only page still describing one.
    expect(
      homeFromSources({ enabled: false, homeValue: 9_000_000 }, taxBases).value
    ).toBe(3_000_000)
  })
})

const summerHouse: PlannedProperty = {
  id: "prop-summer",
  label: "Sommerhuset",
  kind: "fritidsbolig",
  use: "own",
  value: 1_800_000,
  landValue: 900_000,
  saleCostsPct: 0,
  acquisitionAge: 55,
  disposalAge: null,
  financing: null,
  housingReturn: null,
}
const theHome: PlannedProperty = {
  id: "prop-home",
  label: "Rækkehuset",
  kind: "helaarsbolig",
  use: "own",
  value: 3_000_000,
  landValue: 1_000_000,
  saleCostsPct: 0,
  acquisitionAge: 0,
  disposalAge: 80,
  financing: null,
  housingReturn: null,
}

describe("propertiesFromBudget", () => {
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

describe("applyDerivedDefaults", () => {
  const defaults = (
    over: Partial<PlanningDerivedDefaults> = {}
  ): PlanningDerivedDefaults => ({
    monthlyContribution: 7_500,
    annualSpending: 240_000,
    currentAge: 41,
    home: { value: 2_500_000, landValue: 900_000 },
    mortgage: {
      balance: 1_900_000,
      rate: 0.04,
      termYears: 20,
      bidragssats: 0.006,
    },
    mortgageBudgetedMonthly: 12_119,
    tax: { year: 2026, municipality: "Aarhus", churchMember: true },
    pension: {
      single: false,
      person1: { ratepensionAnnual: 30_000, folkepensionAge: 70 },
      person2: { folkepensionAge: 70 },
    },
    ...over,
  })

  it("gives a fresh plan the home it is linked to, not an empty list", () => {
    // The path every first visit takes: nothing is touched, so the defaults are
    // folded into a plan that owns no property yet. It has to come out owning
    // one, or the projection charges no ejendomsskat and counts no home equity.
    const next = applyDerivedDefaults(DEFAULT_PLANNING_STATE, defaults())
    expect(next.properties).toHaveLength(1)
    expect(next.properties[0]).toMatchObject({
      kind: "helaarsbolig",
      value: 2_500_000,
      landValue: 900_000,
    })
  })

  it("lands the debt and the home it is secured on in the same call", () => {
    // The shipped bug in one line: `mortgageBalance` rode in on the spread
    // while `properties` was never set, so a fresh homeowner carried the loan
    // against nothing and their net worth was short a whole house. The pant is
    // asserted too, because the loan is only secured on the home the same call
    // created if the merge reads the ids back out of the list it just built.
    for (const value of [1, 750_000, 2_500_000, 12_000_000]) {
      const next = applyDerivedDefaults(
        DEFAULT_PLANNING_STATE,
        defaults({
          home: { value, landValue: Math.round(value * 0.4) },
          mortgage: { ...defaults().mortgage, balance: Math.round(value * 0.8) },
        })
      )
      expect(next.loans).toHaveLength(1)
      expect(next.loans[0].principal).toBe(Math.round(value * 0.8))
      expect(next.properties).toHaveLength(1)
      expect(next.properties[0].value).toBe(value)
      expect(next.loans[0].propertyId).toBe(next.properties[0].id)
    }
  })

  it("does not invent a property out of a home worth nothing", () => {
    // A renter. The rest of the link still has to arrive, and the loan with it
    // — secured on nothing, which is what a renter's realkreditlån cannot be,
    // but the budget is the wrong place to argue about that.
    const next = applyDerivedDefaults(
      DEFAULT_PLANNING_STATE,
      defaults({ home: { value: 0, landValue: 0 } })
    )
    expect(next.properties).toEqual([])
    expect(next.monthlyContribution).toBe(7_500)
    expect(next.loans[0].principal).toBe(1_900_000)
    expect(next.loans[0].propertyId).toBeNull()
  })

  it("re-prices the home the plan already has instead of adding a second", () => {
    // `propertiesFromBudget` owns this rule and tests it; asserted here only so
    // the merge is known to route the home through it rather than past it.
    const next = applyDerivedDefaults(
      { ...DEFAULT_PLANNING_STATE, properties: [theHome, summerHouse] },
      defaults()
    )
    expect(next.properties).toEqual([
      { ...theHome, value: 2_500_000, landValue: 900_000 },
      summerHouse,
    ])
  })

  it("leaves behind no key a plan does not declare", () => {
    // `home` is two amounts to merge into a list, not a field of the plan. It
    // reached localStorage as one when the merge spread the defaults wholesale,
    // and TypeScript cannot see it: a spread gets no excess-property check.
    const next = applyDerivedDefaults(DEFAULT_PLANNING_STATE, defaults())
    expect(next).not.toHaveProperty("home")
    expect(Object.keys(next).sort()).toEqual(
      Object.keys(DEFAULT_PLANNING_STATE).sort()
    )
  })

  it("lands a /skat-only home in the plan with the mortgage module off", () => {
    // The whole of #50's first consequence in one call: fill in the Bolig tab,
    // never touch /budget's realkredit section, and the plan has to come out
    // owning the house — otherwise the projection carries neither the asset nor
    // its ejendomsskat, which is what every renter's plan looks like.
    const next = applyDerivedDefaults(
      DEFAULT_PLANNING_STATE,
      defaults({ home: homeFromSources(noMortgage, taxBases) })
    )
    expect(next.properties).toHaveLength(1)
    expect(next.properties[0]).toMatchObject({
      kind: "helaarsbolig",
      value: 3_000_000,
      landValue: 1_000_000,
    })
  })

  it("seeds the pension without emptying the pots already in the plan", () => {
    // The other pages know the contributions and the folkepensionsalder; the
    // balances are the plan's own and are not theirs to clear.
    const prev = {
      ...DEFAULT_PLANNING_STATE,
      pension: {
        ...DEFAULT_PLANNING_STATE.pension,
        person1: {
          ...DEFAULT_PLANNING_STATE.pension.person1,
          ratepensionBalance: 800_000,
        },
      },
    }
    const next = applyDerivedDefaults(prev, defaults())
    expect(next.pension.person1.ratepensionBalance).toBe(800_000)
    expect(next.pension.person1.ratepensionAnnual).toBe(30_000)
    expect(next.pension.person1.folkepensionAge).toBe(70)
    expect(next.pension.single).toBe(false)
  })
})
