/**
 * Pure derivations for the projection chart's annotations — milestone reference
 * lines and life-event dots.
 *
 * They live here rather than inside `planning-chart.tsx` because
 * `vitest.config.ts` collects only `**\/__tests__\/**\/*.test.ts`, so nothing
 * defined in a `.tsx` file is reachable by a test in this repo. The component
 * keeps the presentation (colour, label placement); this module decides which
 * annotations exist and what they say.
 */

import type { NewPlanningEvent, PlanningEvent, PlanningResult } from "./types"

/** Which wealth series the chart is currently drawing. */
export type WealthView = "total" | "detailed"

/** Whether an annotation describes the base plan or the compared scenario. */
export type MarkOrigin = "base" | "scenario"

export type MilestoneMetric = "fi" | "debtFree" | "retirement"

const MILESTONE_LABELS: Record<MilestoneMetric, string> = {
  fi: "Økonomisk fri",
  debtFree: "Gældfri",
  retirement: "Pension",
}

const MILESTONE_ORDER: MilestoneMetric[] = ["fi", "debtFree", "retirement"]

export interface MilestoneMark {
  key: string
  metric: MilestoneMetric
  age: number
  label: string
  origin: MarkOrigin
}

export interface EventMark {
  key: string
  age: number
  y: number
  label: string
  origin: MarkOrigin
}

/** The three milestone ages a plan produces, in a shape that is easy to diff. */
function milestoneAges(
  result: PlanningResult,
  retirementAge: number
): Record<MilestoneMetric, number | null> {
  return {
    fi: result.fiAge,
    debtFree: result.debtFreeAge,
    retirement: retirementAge,
  }
}

/**
 * The vertical milestone lines to draw. A scenario can move any of these — it
 * may override `retirementAge` outright, and a changed contribution routinely
 * moves `fiAge` — so drawing only the base plan's ages next to a scenario curve
 * misattributes them.
 *
 * Only milestones the two plans actually disagree on are doubled up; an age
 * both plans share belongs to both, so labelling it "(basis)" would be a lie,
 * and a chart this dense cannot afford six reference lines to say the same
 * thing twice.
 */
export function milestoneMarks(
  result: PlanningResult,
  retirementAge: number,
  scenarioResult?: PlanningResult | null,
  scenarioRetirementAge?: number
): MilestoneMark[] {
  const base = milestoneAges(result, retirementAge)
  const scenario = scenarioResult
    ? milestoneAges(scenarioResult, scenarioRetirementAge ?? retirementAge)
    : null

  const marks: MilestoneMark[] = []
  for (const metric of MILESTONE_ORDER) {
    const baseAge = base[metric]
    const scenarioAge = scenario?.[metric] ?? null
    // A milestone the scenario never reaches differs, but there is no line to
    // draw for it — so the base one stays unqualified rather than carrying a
    // "(basis)" suffix with nothing to contrast against.
    const contrasted = scenario != null && scenarioAge !== baseAge && scenarioAge != null

    if (baseAge != null) {
      marks.push({
        key: `base-${metric}`,
        metric,
        age: baseAge,
        label: `${MILESTONE_LABELS[metric]} · ${baseAge}${contrasted ? " (basis)" : ""}`,
        origin: "base",
      })
    }
    if (contrasted) {
      marks.push({
        key: `scenario-${metric}`,
        metric,
        age: scenarioAge,
        label: `${MILESTONE_LABELS[metric]} · ${scenarioAge} (scenarie)`,
        origin: "scenario",
      })
    }
  }
  return marks
}

/** The chart-row fields the event dots need to find a y-position. */
export interface MarkableRow {
  age: number
  netWorth: number
  investments: number
  scenarioNetWorth?: number
  scenarioInvestments?: number
}

/**
 * Dots marking where each life event fires, placed on whichever curve the
 * current view draws so they never float in empty space.
 *
 * Scenario-added events are placed on the *scenario* curve: they are the reason
 * that curve diverges, so a marker sitting on the base line would point at the
 * one plan the event does not affect. Events outside the relevant horizon are
 * dropped.
 */
export function eventMarks(
  rows: MarkableRow[],
  view: WealthView,
  baseEvents: readonly PlanningEvent[],
  scenarioEvents: readonly NewPlanningEvent[] = []
): EventMark[] {
  const rowByAge = new Map(rows.map((r) => [r.age, r]))
  const marks: EventMark[] = []

  for (const e of baseEvents) {
    const row = rowByAge.get(Math.round(e.age))
    if (!row) continue
    marks.push({
      key: `base-${e.id}`,
      age: row.age,
      y: view === "detailed" ? row.investments : row.netWorth,
      label: e.label,
      origin: "base",
    })
  }

  scenarioEvents.forEach((e, i) => {
    const row = rowByAge.get(Math.round(e.age))
    if (!row) return
    const y = view === "detailed" ? row.scenarioInvestments : row.scenarioNetWorth
    // Undefined past the scenario's own horizon, which can be shorter.
    if (y == null) return
    marks.push({
      key: `scenario-${i}`,
      age: row.age,
      y,
      label: e.label,
      origin: "scenario",
    })
  })

  return marks
}
