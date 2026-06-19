/**
 * Layer a named scenario's changes on top of a base plan. Pure — reused by the
 * app's comparison view and by the MCP server's what-if tools.
 */

import type {
  PlanningEvent,
  PlanningState,
  ScenarioChanges,
} from "./types"
import { newId } from "./normalize"

/**
 * Produce a new PlanningState with the scenario changes applied:
 * scalar overrides replace base fields, assumption overrides are merged, and
 * `addEvents` are appended to the base events (each given a fresh id). The base
 * state is not mutated.
 */
export function applyScenario(
  base: PlanningState,
  changes: ScenarioChanges
): PlanningState {
  const addedEvents: PlanningEvent[] = (changes.addEvents ?? []).map(
    (e) => ({ ...e, id: newId("sc-ev") }) as PlanningEvent
  )
  return {
    ...base,
    ...(changes.overrides ?? {}),
    assumptions: { ...base.assumptions, ...(changes.assumptionOverrides ?? {}) },
    events: [...base.events, ...addedEvents],
  }
}
