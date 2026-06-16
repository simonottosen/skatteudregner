import { describe, it, expect } from "vitest"
import { simulatePlanning } from "../simulate"
import { DEFAULT_PLANNING_STATE, type PlanningState } from "../types"

function makeState(overrides: Partial<PlanningState> = {}): PlanningState {
  return {
    ...DEFAULT_PLANNING_STATE,
    assumptions: { ...DEFAULT_PLANNING_STATE.assumptions, ...(overrides.assumptions ?? {}) },
    ...overrides,
  }
}

describe("simulatePlanning", () => {
  it("returns one point per year inclusive of start and end", () => {
    const res = simulatePlanning(makeState({ currentAge: 30, endAge: 90 }))
    expect(res.points).toHaveLength(61)
    expect(res.points[0].age).toBe(30)
    expect(res.points.at(-1)!.age).toBe(90)
  })

  it("compounds investments with contributions and no volatility band spread", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 30,
        endAge: 31,
        startInvestments: 100000,
        monthlyContribution: 0,
        homeValue: 0,
        mortgageBalance: 0,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0.05,
          investmentFee: 0,
          volatility: 0, // deterministic → band collapses to the median
        },
      })
    )
    // 100000 * 1.05 = 105000 after one year.
    expect(res.points[1].investments).toBeCloseTo(105000, 0)
    expect(res.points[1].band[0]).toBeCloseTo(105000, 0)
    expect(res.points[1].band[1]).toBeCloseTo(105000, 0)
  })

  it("grows the annual contribution each year", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 30,
        endAge: 32,
        startInvestments: 0,
        monthlyContribution: 1000, // 12.000/yr
        homeValue: 0,
        mortgageBalance: 0,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          volatility: 0,
          contributionGrowth: 0.1,
        },
      })
    )
    // Year 1: 12.000. Year 2: 12.000 + 13.200 = 25.200.
    expect(res.points[1].investments).toBeCloseTo(12000, 0)
    expect(res.points[2].investments).toBeCloseTo(25200, 0)
  })

  it("includes home equity that grows and gains from mortgage paydown", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 40,
        endAge: 41,
        startInvestments: 0,
        monthlyContribution: 0,
        homeValue: 2_000_000,
        mortgageBalance: 1_000_000,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          housingReturn: 0.02,
          volatility: 0,
        },
      })
    )
    // Equity start = 1.0M; after a year home +2% and mortgage shrinks → equity up.
    expect(res.points[0].homeEquity).toBeCloseTo(1_000_000, 0)
    expect(res.points[1].homeEquity).toBeGreaterThan(1_040_000)
    expect(res.points[1].netWorth).toBe(res.points[1].homeEquity)
  })

  it("applies a one-time expense at the right age", () => {
    const base = makeState({
      currentAge: 30,
      endAge: 35,
      startInvestments: 500000,
      monthlyContribution: 0,
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        investmentReturn: 0,
        investmentFee: 0,
        volatility: 0,
      },
    })
    const withExpense = simulatePlanning({
      ...base,
      events: [{ id: "e1", type: "expense", label: "Bryllup", age: 32, amount: 200000 }],
    })
    const at32 = withExpense.points.find((p) => p.age === 32)!
    expect(at32.investments).toBeCloseTo(300000, 0)
  })

  it("applies a windfall and a recurring contribution change", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 30,
        endAge: 33,
        startInvestments: 0,
        monthlyContribution: 0,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          volatility: 0,
          contributionGrowth: 0,
        },
        events: [
          { id: "w1", type: "windfall", label: "Arv", age: 31, amount: 100000 },
          { id: "r1", type: "recurring", label: "Lønhop", age: 31, monthlyDelta: 5000 },
        ],
      })
    )
    // Age 31: +100k windfall, contribution still 0 that year → 100k.
    expect(res.points.find((p) => p.age === 31)!.investments).toBeCloseTo(100000, 0)
    // Age 32: +60k/yr from the recurring change → 160k.
    expect(res.points.find((p) => p.age === 32)!.investments).toBeCloseTo(160000, 0)
  })

  it("handles a property reallocation (sell + buy with mortgage)", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 40,
        endAge: 41,
        startInvestments: 0,
        monthlyContribution: 0,
        homeValue: 2_000_000,
        mortgageBalance: 500_000, // equity = 1.5M
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          housingReturn: 0,
          volatility: 0,
        },
        events: [
          {
            id: "p1",
            type: "property",
            label: "Nyt hus",
            age: 40,
            newValue: 3_000_000,
            mortgageLtv: 0.8,
          },
        ],
      })
    )
    // At age 40: realise 1.5M equity, pay 20% down (600k) → investments = 0.9M.
    const at40 = res.points.find((p) => p.age === 40)!
    expect(at40.investments).toBeCloseTo(900_000, 0)
    expect(at40.homeEquity).toBeCloseTo(600_000, 0) // 3.0M - 2.4M mortgage
  })

  it("detects FI age when investments reach 25x annual spending", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 30,
        endAge: 70,
        startInvestments: 1_000_000,
        monthlyContribution: 20000,
        homeValue: 0,
        mortgageBalance: 0,
        annualSpending: 300000, // FI target = 7.5M (25x)
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          inflation: 0,
          safeWithdrawalRate: 0.04,
        },
      })
    )
    expect(res.fiAge).not.toBeNull()
    const fiPoint = res.points.find((p) => p.age === res.fiAge)!
    expect(fiPoint.investments).toBeGreaterThanOrEqual(7_500_000)
  })

  it("is deterministic across runs and keeps p10 <= median <= p90", () => {
    const state = makeState({
      currentAge: 30,
      endAge: 60,
      startInvestments: 200000,
      monthlyContribution: 10000,
    })
    const a = simulatePlanning(state)
    const b = simulatePlanning(state)
    expect(a.points.at(-1)!.band).toEqual(b.points.at(-1)!.band)

    const last = a.points.at(-1)!
    expect(last.band[0]).toBeLessThanOrEqual(last.netWorth)
    expect(last.netWorth).toBeLessThanOrEqual(last.band[1])
  })
})
