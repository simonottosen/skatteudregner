import { describe, it, expect } from "vitest"
import { eventMarks, milestoneMarks, type MarkableRow } from "../chart-marks"
import type { PlanningEvent, PlanningResult } from "../types"

/** Only the milestone fields matter here; the chart reads nothing else. */
function makeResult(
  fiAge: number | null,
  debtFreeAge: number | null = null
): PlanningResult {
  return {
    points: [],
    fiAge,
    debtFreeAge,
    ruinAge: null,
    successProbability: 1,
  }
}

describe("milestoneMarks", () => {
  it("leaves the base labels unqualified when no scenario is being compared", () => {
    const marks = milestoneMarks(makeResult(52, 58), 65)
    expect(marks.map((m) => m.label)).toEqual([
      "Økonomisk fri · 52",
      "Gældfri · 58",
      "Pension · 65",
    ])
    expect(marks.every((m) => m.origin === "base")).toBe(true)
  })

  it("contrasts only the milestones the scenario actually moves", () => {
    // Saving more reaches FI five years earlier but changes nothing else.
    const marks = milestoneMarks(makeResult(52, 58), 65, makeResult(47, 58), 65)
    expect(marks.map((m) => m.label)).toEqual([
      "Økonomisk fri · 52 (basis)",
      "Økonomisk fri · 47 (scenarie)",
      // Untouched by the scenario, so it belongs to both plans and stays plain.
      "Gældfri · 58",
      "Pension · 65",
    ])
    expect(marks.filter((m) => m.origin === "scenario")).toHaveLength(1)
  })

  it("draws the scenario's own retirement age when it overrides it", () => {
    const marks = milestoneMarks(makeResult(null), 65, makeResult(null), 60)
    expect(marks.map((m) => m.label)).toEqual([
      "Pension · 65 (basis)",
      "Pension · 60 (scenarie)",
    ])
    const scenarioMark = marks.find((m) => m.origin === "scenario")
    expect(scenarioMark?.age).toBe(60)
    expect(scenarioMark?.metric).toBe("retirement")
  })

  it("falls back to the base retirement age when the scenario leaves it alone", () => {
    const marks = milestoneMarks(makeResult(null), 65, makeResult(null))
    expect(marks.map((m) => m.label)).toEqual(["Pension · 65"])
  })

  it("marks a milestone only the scenario reaches", () => {
    const marks = milestoneMarks(makeResult(null), 65, makeResult(47), 65)
    expect(marks.map((m) => m.label)).toEqual([
      "Økonomisk fri · 47 (scenarie)",
      "Pension · 65",
    ])
  })

  it("never labels a base milestone '(basis)' without a counterpart to contrast", () => {
    // The scenario never reaches FI, so there is no purple line to draw. A lone
    // "(basis)" would point at an annotation that is not on the chart.
    const marks = milestoneMarks(makeResult(52), 65, makeResult(null), 65)
    expect(marks.map((m) => m.label)).toEqual([
      "Økonomisk fri · 52",
      "Pension · 65",
    ])
  })
})

const ROWS: MarkableRow[] = [
  { age: 30, netWorth: 100, investments: 40, scenarioNetWorth: 110, scenarioInvestments: 50 },
  { age: 31, netWorth: 200, investments: 80, scenarioNetWorth: 240, scenarioInvestments: 95 },
  // Past the scenario's own (shorter) horizon.
  { age: 32, netWorth: 300, investments: 120 },
]

const BASE_EVENTS: PlanningEvent[] = [
  { id: "e1", type: "windfall", label: "Arv", age: 31, amount: 500 },
]

describe("eventMarks", () => {
  it("places base events on the base curve for the current view", () => {
    expect(eventMarks(ROWS, "total", BASE_EVENTS)).toEqual([
      { key: "base-e1", age: 31, y: 200, label: "Arv", origin: "base" },
    ])
    expect(eventMarks(ROWS, "detailed", BASE_EVENTS)[0].y).toBe(80)
  })

  it("places scenario-added events on the scenario curve, not the base one", () => {
    // The whole point: the scenario event is *why* the purple curve diverges,
    // so its marker has to sit on the purple curve.
    const marks = eventMarks(ROWS, "total", [], [
      { type: "recurring", label: "Sparer mere", age: 31, monthlyDelta: 2500 },
    ])
    expect(marks).toEqual([
      { key: "scenario-0", age: 31, y: 240, label: "Sparer mere", origin: "scenario" },
    ])
    expect(marks[0].y).not.toBe(200) // the base curve's value at 31
  })

  it("reads the scenario curve's investments in the detailed view", () => {
    const marks = eventMarks(ROWS, "detailed", [], [
      { type: "windfall", label: "Bonus", age: 30, amount: 1000 },
    ])
    expect(marks[0].y).toBe(50)
  })

  it("drops events outside the horizon of the curve they belong to", () => {
    const beyondChart = eventMarks(ROWS, "total", [
      { id: "e9", type: "windfall", label: "For sent", age: 99, amount: 1 },
    ])
    expect(beyondChart).toEqual([])

    // Age 32 is on the chart, but the scenario's curve stops before it.
    const beyondScenario = eventMarks(ROWS, "total", [], [
      { type: "windfall", label: "Efter scenariet", age: 32, amount: 1 },
    ])
    expect(beyondScenario).toEqual([])
  })

  it("keys base and scenario marks apart so they cannot collide", () => {
    const marks = eventMarks(ROWS, "total", BASE_EVENTS, [
      { type: "recurring", label: "Sparer mere", age: 30, monthlyDelta: 100 },
      { type: "windfall", label: "Bonus", age: 31, amount: 100 },
    ])
    expect(marks).toHaveLength(3)
    expect(new Set(marks.map((m) => m.key)).size).toBe(3)
  })
})
