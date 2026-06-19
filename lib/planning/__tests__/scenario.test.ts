import { describe, it, expect } from "vitest"
import { DEFAULT_PLANNING_STATE, type PlanningState } from "../types"
import { applyScenario } from "../scenario"
import { normalizePlanning } from "../normalize"
import { summarize } from "../summary"

function makeState(overrides: Partial<PlanningState> = {}): PlanningState {
  return {
    ...DEFAULT_PLANNING_STATE,
    assumptions: { ...DEFAULT_PLANNING_STATE.assumptions, ...(overrides.assumptions ?? {}) },
    ...overrides,
  }
}

describe("applyScenario", () => {
  it("merges scalar overrides, assumption overrides and appends events", () => {
    const base = makeState({
      monthlyContribution: 10_000,
      events: [{ id: "e0", type: "expense", label: "x", age: 40, amount: 1000 }],
    })
    const out = applyScenario(base, {
      overrides: { monthlyContribution: 15_000, retirementAge: 62 },
      assumptionOverrides: { investmentReturn: 0.08 },
      addEvents: [
        { type: "recurring", label: "Løn +5 %", age: 31, monthlyDelta: 2500 },
      ],
    })
    expect(out.monthlyContribution).toBe(15_000)
    expect(out.retirementAge).toBe(62)
    expect(out.assumptions.investmentReturn).toBe(0.08)
    // Other assumptions untouched.
    expect(out.assumptions.inflation).toBe(base.assumptions.inflation)
    // Base event kept, scenario event appended with a fresh id.
    expect(out.events).toHaveLength(2)
    expect(out.events[1].type).toBe("recurring")
    expect(out.events[1].id).toBeTruthy()
    // Base state is not mutated.
    expect(base.monthlyContribution).toBe(10_000)
    expect(base.events).toHaveLength(1)
  })
})

describe("normalizePlanning (scenarios)", () => {
  it("round-trips a scenario through JSON + normalize", () => {
    const base = makeState({
      scenarios: [
        {
          id: "sc1",
          name: "Løn +5 %",
          createdAt: "2026-01-01T00:00:00.000Z",
          changes: {
            overrides: { monthlyContribution: 20_000 },
            addEvents: [
              { type: "recurring", label: "boost", age: 31, monthlyDelta: 2500 },
            ],
          },
        },
      ],
    })
    const round = normalizePlanning(JSON.parse(JSON.stringify(base)))
    expect(round.scenarios).toHaveLength(1)
    expect(round.scenarios[0].name).toBe("Løn +5 %")
    expect(round.scenarios[0].changes.overrides?.monthlyContribution).toBe(20_000)
    expect(round.scenarios[0].changes.addEvents?.[0]).toMatchObject({
      type: "recurring",
      monthlyDelta: 2500,
    })
  })

  it("drops malformed scenarios and unknown override keys", () => {
    const round = normalizePlanning({
      ...DEFAULT_PLANNING_STATE,
      scenarios: [
        null,
        { id: "x", changes: { overrides: { bogusField: 1, cashBuffer: 50_000 } } },
      ],
    })
    expect(round.scenarios).toHaveLength(1)
    const ov = round.scenarios[0].changes.overrides!
    expect(ov.cashBuffer).toBe(50_000)
    expect("bogusField" in ov).toBe(false)
  })
})

describe("summarize", () => {
  it("reports both nominal and today's-kroner figures", () => {
    const s = summarize(
      makeState({
        currentAge: 35,
        endAge: 90,
        retirementAge: 65,
        startInvestments: 100_000,
        monthlyContribution: 10_000,
        annualSpending: 300_000,
      })
    )
    expect(s.netWorthAtRetirement.nominal).toBeGreaterThan(0)
    // Positive inflation → today's-kr value is below the nominal future value.
    expect(s.netWorthAtRetirement.real).toBeLessThan(s.netWorthAtRetirement.nominal)
    expect(typeof s.successProbability).toBe("number")
  })

  it("a 'salary +X/mo invested' scenario raises net worth at retirement", () => {
    const base = makeState({
      currentAge: 35,
      endAge: 90,
      retirementAge: 65,
      startInvestments: 100_000,
      monthlyContribution: 10_000,
      annualSpending: 300_000,
    })
    const boosted = applyScenario(base, {
      addEvents: [
        { type: "recurring", label: "Løn +5 %", age: 35, monthlyDelta: 3000 },
      ],
    })
    expect(summarize(boosted).netWorthAtRetirement.nominal).toBeGreaterThan(
      summarize(base).netWorthAtRetirement.nominal
    )
  })
})
