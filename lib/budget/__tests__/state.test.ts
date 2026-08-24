import { describe, it, expect } from "vitest"
import {
  normalizeBudget,
  computeBudgetSummary,
  computeResultSummary,
  expensesByCategory,
  planningContribution,
} from "../state"

describe("normalizeBudget", () => {
  it("defaults an empty/invalid blob to a v5 single household", () => {
    const s = normalizeBudget(null)
    expect(s.version).toBe(5)
    expect(s.mode).toBe("single")
    expect(Array.isArray(s.sharedItems)).toBe(true)
  })
  it("migrates a legacy array of items into sharedItems", () => {
    const s = normalizeBudget([{ label: "Mad", amount: 2000, categoryId: "mad" }])
    expect(s.sharedItems).toHaveLength(1)
    expect(s.sharedItems[0].amount).toBe(2000)
  })
})

describe("computeBudgetSummary", () => {
  it("single: income from tax net, expenses from shared items", () => {
    const s = normalizeBudget({
      mode: "single",
      person1: { name: "P1", incomeSource: "skat", manualIncome: 0, items: [] },
      sharedItems: [
        { id: "a", label: "Mad", amount: 5000, categoryId: "mad" },
        { id: "b", label: "Bolig", amount: 10000, categoryId: "bolig" },
      ],
    })
    const sum = computeBudgetSummary(s, 30000, 0)
    expect(sum.budgetIncome).toBe(30000)
    expect(sum.budgetExpenses).toBe(15000)
    expect(sum.remaining).toBe(15000)
    expect(sum.savingsRate).toBeCloseTo(0.5, 6)
  })
  it("separate: sums both people's items + manual incomes", () => {
    const s = normalizeBudget({
      mode: "separate",
      person1: {
        name: "P1",
        incomeSource: "manual",
        manualIncome: 20000,
        items: [{ id: "x", label: "a", amount: 8000, categoryId: "mad" }],
      },
      person2: {
        name: "P2",
        incomeSource: "manual",
        manualIncome: 25000,
        items: [{ id: "y", label: "b", amount: 7000, categoryId: "mad" }],
      },
    })
    const sum = computeBudgetSummary(s, 0, 0)
    expect(sum.budgetIncome).toBe(45000)
    expect(sum.budgetExpenses).toBe(15000)
  })
})

describe("the mortgage comes off the surplus", () => {
  /** A household with a live realkredit loan on top of two ordinary expenses. */
  const withMortgage = () =>
    normalizeBudget({
      mode: "single",
      person1: { name: "P1", incomeSource: "skat", manualIncome: 0, items: [] },
      sharedItems: [
        { id: "a", label: "Mad", amount: 5000, categoryId: "mad" },
        { id: "b", label: "Forsikring", amount: 2000, categoryId: "forsikring" },
      ],
      mortgage: {
        enabled: true,
        homeValue: 3_000_000,
        remainingYears: 30,
        ltv: 0.8,
        interestRate: 0.04,
        bidragssats: 0.006,
        interestOnly: false,
      },
    })

  it("keeps budgetExpenses free of the mortgage", () => {
    const sum = computeBudgetSummary(withMortgage(), 40000, 0)
    // The categorised lines only — the realkredit payment is reported separately
    // so callers can label it ("Udgifter (inkl. lån)") without double-counting.
    expect(sum.budgetExpenses).toBe(7000)
    expect(sum.mortgageMonthly).toBeGreaterThan(0)
  })

  it("subtracts it from remaining and savingsRate", () => {
    const sum = computeBudgetSummary(withMortgage(), 40000, 0)
    expect(sum.remaining).toBeCloseTo(40000 - 7000 - sum.mortgageMonthly, 6)
    expect(sum.savingsRate).toBeCloseTo(sum.remaining / 40000, 6)
    // Without the fix this was 33000 — the surplus /resultat used to show.
    expect(sum.remaining).toBeLessThan(33000)
  })

  it("matches the contribution /planlaegning derives from the same budget", () => {
    const sum = computeBudgetSummary(withMortgage(), 40000, 0)
    // hooks/use-planning.ts feeds the simulator exactly this. Both sides call
    // planningContribution rather than re-deriving income − expenses − mortgage,
    // so there is no second formula left to drift (issue #2).
    expect(planningContribution(sum.remaining)).toBe(Math.round(sum.remaining))
  })

  it("reports a deficit rather than clamping at zero", () => {
    // A household whose loan alone outstrips its income must see the negative
    // number; only the simulator clamps, because a negative contribution is
    // meaningless there.
    const sum = computeBudgetSummary(withMortgage(), 8000, 0)
    expect(sum.remaining).toBeLessThan(0)
    expect(sum.savingsRate).toBeLessThan(0)
  })

  it("hands the simulator zero in a deficit without losing the shortfall", () => {
    const sum = computeBudgetSummary(withMortgage(), 8000, 0)
    // The clamp applies at the simulator boundary and nowhere else…
    expect(planningContribution(sum.remaining)).toBe(0)
    // …so `remaining` still carries the real shortfall, which is what /resultat
    // displays and what the "budget balancerer ikke" warning reads. Clamping it
    // any earlier would show a household in the red a plan that saves nothing
    // and says nothing about why.
    expect(Math.round(sum.remaining)).toBe(
      Math.round(8000 - 7000 - sum.mortgageMonthly)
    )
    expect(sum.remaining).toBeLessThan(0)
  })

  it("nets the mortgage out in separate mode too", () => {
    // The mortgage is a household obligation, so it comes off the surplus
    // whichever way the couple splits their expenses.
    // NB: /budget's two per-person cards still show `income − exp` and allocate
    // the mortgage nowhere, so their sum overstates by mortgageMonthly. That is
    // a display bug in components/budget/budget-planner.tsx, not here — this
    // pins the shared summary so a fix there has something to agree with.
    const s = normalizeBudget({
      mode: "separate",
      person1: {
        name: "P1",
        incomeSource: "manual",
        manualIncome: 20000,
        items: [{ id: "x", label: "a", amount: 8000, categoryId: "mad" }],
      },
      person2: {
        name: "P2",
        incomeSource: "manual",
        manualIncome: 25000,
        items: [{ id: "y", label: "b", amount: 7000, categoryId: "mad" }],
      },
      mortgage: {
        enabled: true,
        homeValue: 3_000_000,
        remainingYears: 30,
        ltv: 0.8,
        interestRate: 0.04,
        bidragssats: 0.006,
        interestOnly: false,
      },
    })
    const sum = computeBudgetSummary(s, 0, 0)
    expect(sum.mortgageMonthly).toBeGreaterThan(0)
    expect(sum.budgetExpenses).toBe(15000)
    expect(sum.remaining).toBeCloseTo(45000 - 15000 - sum.mortgageMonthly, 6)
    // The naive per-person sum the cards currently render.
    expect(sum.p1Income - sum.p1Total + (sum.p2Income - sum.p2Total)).toBeCloseTo(
      sum.remaining + sum.mortgageMonthly,
      6
    )
  })

  it("leaves a household without a mortgage untouched", () => {
    const s = normalizeBudget({
      mode: "single",
      person1: { name: "P1", incomeSource: "skat", manualIncome: 0, items: [] },
      sharedItems: [{ id: "a", label: "Mad", amount: 5000, categoryId: "mad" }],
    })
    const sum = computeBudgetSummary(s, 30000, 0)
    expect(sum.mortgageMonthly).toBe(0)
    expect(sum.remaining).toBe(25000)
  })
})

describe("computeResultSummary", () => {
  it("sums gross/tax/net and derives effective rate + monthly", () => {
    const r = computeResultSummary([
      { amBasis: 500000, insuranceBasis: 0, nonAmIncome: 0, totalTax: 150000, netIncome: 350000 },
      { amBasis: 300000, insuranceBasis: 0, nonAmIncome: 0, totalTax: 80000, netIncome: 220000 },
    ])
    expect(r.grossYear).toBe(800000)
    expect(r.taxYear).toBe(230000)
    expect(r.netYear).toBe(570000)
    expect(r.effectiveRate).toBeCloseTo(230000 / 800000, 6)
    expect(r.netMonthly).toBeCloseTo(570000 / 12, 4)
  })
})

describe("expensesByCategory", () => {
  it("aggregates items by category", () => {
    const s = normalizeBudget({
      mode: "single",
      sharedItems: [
        { id: "a", label: "Mad", amount: 1000, categoryId: "mad" },
        { id: "b", label: "Mere mad", amount: 500, categoryId: "mad" },
      ],
    })
    expect(expensesByCategory(s).find((c) => c.categoryId === "mad")?.total).toBe(1500)
  })
})
