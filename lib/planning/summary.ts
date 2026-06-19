/**
 * Shared, pure helpers for turning a PlanningResult into display/report numbers:
 * deflation to today's kroner and a compact summary. Reused by the app's
 * planning overview and by the MCP server's what-if tools.
 */

import { simulatePlanning } from "./simulate"
import type { PlanningPoint, PlanningResult, PlanningState } from "./types"

/** Inflation deflator for a given age relative to the simulation start. */
function deflator(inflation: number, age: number, currentAge: number): number {
  return Math.pow(1 + inflation, age - currentAge)
}

/**
 * Deflate every monetary field of a PlanningResult to today's kroner. `age` and
 * the non-monetary summary fields (fiAge, successProbability, …) are unchanged.
 */
export function toTodayKroner(
  result: PlanningResult,
  inflation: number,
  currentAge: number
): PlanningResult {
  const points: PlanningPoint[] = result.points.map((p) => {
    const f = deflator(inflation, p.age, currentAge)
    return {
      age: p.age,
      investments: p.investments / f,
      homeEquity: p.homeEquity / f,
      cash: p.cash / f,
      otherDebt: p.otherDebt / f,
      netWorth: p.netWorth / f,
      band: [p.band[0] / f, p.band[1] / f],
      investmentsBand: [p.investmentsBand[0] / f, p.investmentsBand[1] / f],
      contributionsTotal: p.contributionsTotal / f,
      housingGainsTotal: p.housingGainsTotal / f,
      investmentGainsTotal: p.investmentGainsTotal / f,
      contributionYoY: p.contributionYoY / f,
      housingGainYoY: p.housingGainYoY / f,
      investmentGainYoY: p.investmentGainYoY / f,
      retirementIncome: p.retirementIncome / f,
      taxPaid: p.taxPaid / f,
      spending: p.spending / f,
      investmentsSold: p.investmentsSold / f,
      borrowed: p.borrowed / f,
      propertyTax: p.propertyTax / f,
    }
  })
  return { ...result, points }
}

/** A figure reported in both nominal and today's-kroner terms. */
export interface DualAmount {
  nominal: number
  real: number
}

export interface PlanningSummary {
  fiAge: number | null
  debtFreeAge: number | null
  ruinAge: number | null
  /** Share (0–1) of Monte Carlo runs that fund spending for the whole horizon. */
  successProbability: number
  /** Total net worth at the retirement age. */
  netWorthAtRetirement: DualAmount
  /** Total net worth at the simulation end age. */
  netWorthAtEnd: DualAmount
  /** Steady-state yearly pension income after tax (year after folkepension). */
  annualPensionAfterTax: DualAmount
}

/** The steady-state pension year — the year after the latest folkepensionsalder
 * — so the one-off tax-free aldersopsparing lump doesn't distort the figure. */
function pensionSteadyStateAge(state: PlanningState): number {
  return state.pension.single
    ? state.pension.person1.folkepensionAge
    : Math.max(
        state.pension.person1.folkepensionAge,
        state.pension.person2.folkepensionAge
      )
}

/** Run the simulation and extract the headline figures (nominal + today's-kr). */
export function summarize(state: PlanningState): PlanningSummary {
  const result = simulatePlanning(state)
  const { inflation } = state.assumptions
  const dual = (age: number, value: number): DualAmount => ({
    nominal: value,
    real: value / deflator(inflation, age, state.currentAge),
  })

  const retirementPoint =
    result.points.find((p) => p.age === state.retirementAge) ??
    result.points.at(-1)!
  const endPoint = result.points.at(-1)!

  const folke = pensionSteadyStateAge(state)
  const pensionPoint =
    result.points.find((p) => p.age === folke + 1) ??
    result.points.find((p) => p.age >= folke && p.retirementIncome > 0) ??
    result.points.find((p) => p.retirementIncome > 0)

  return {
    fiAge: result.fiAge,
    debtFreeAge: result.debtFreeAge,
    ruinAge: result.ruinAge,
    successProbability: result.successProbability,
    netWorthAtRetirement: dual(retirementPoint.age, retirementPoint.netWorth),
    netWorthAtEnd: dual(endPoint.age, endPoint.netWorth),
    annualPensionAfterTax: pensionPoint
      ? dual(pensionPoint.age, pensionPoint.retirementIncome)
      : { nominal: 0, real: 0 },
  }
}
