/**
 * Shared, pure helpers for turning a plan into display/report output: deflation
 * to today's kroner, a compact summary, and the notices that go with them.
 * Reused by the app's planning overview and by the MCP server's what-if tools.
 *
 * The Danish copy lives here rather than in the page because `.tsx` is outside
 * the test runner's reach (`vitest.config.ts`), and a notice nobody can test is
 * a notice that ships with the wrong number in it.
 */

import { modelledMortgageMonthly, simulatePlanning } from "./simulate"
import type { PlanningPoint, PlanningResult, PlanningState } from "./types"
import { formatDKK } from "@/lib/format"

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

/**
 * Extract the headline figures from an already-simulated result. Split out of
 * `summarize` so a caller that needs both the summary and the points (the
 * planning page charts them) pays for one Monte Carlo run, not two.
 *
 * `result` must be the *nominal* output of `simulatePlanning(state)` — the
 * real-terms figures are derived here, so passing a `toTodayKroner` result
 * would deflate twice.
 */
export function summarizeResult(
  result: PlanningResult,
  state: PlanningState
): PlanningSummary {
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

/** Run the simulation and extract the headline figures (nominal + today's-kr). */
export function summarize(state: PlanningState): PlanningSummary {
  return summarizeResult(simulatePlanning(state), state)
}

/**
 * Flags a plan that carries a mortgage its budget never paid for.
 *
 * The simulation charges the modelled payment less the one the budget deducted.
 * When the budget's mortgage module is off it deducts nothing — yet the planning
 * balance may still have been inferred from the interest entered on /skat, or
 * typed straight in. The plan then describes itself two ways at once, and
 * neither reading is safe to adopt in silence: charging the whole payment guts
 * the saving of a household whose contribution was already net of it, while
 * handing one back conjures a five-figure income out of nothing for a household
 * whose contribution was gross.
 *
 * So the projection does the arithmetic the stated inputs imply — it charges the
 * payment — and this says so, the way /budget already warns about an expense
 * line that duplicates the mortgage module. Returns null when there is nothing
 * to reconcile: a budget that does deduct, or a payment of zero — which covers
 * "no loan" too, since a balance of zero costs nothing to service.
 */
export function mortgageBudgetNotice(
  state: PlanningState
): { title: string; subtitle: string } | null {
  if (state.mortgageBudgetedMonthly > 0) return null
  const monthly = modelledMortgageMonthly(state)
  if (monthly <= 0) return null
  return {
    title: "Boliglånet er ikke med i dit budget",
    subtitle:
      `Planen regner med en restgæld på ${formatDKK(state.mortgageBalance)}, ` +
      "men dit budget trækker ingen boligydelse fra. Ydelsen på ca. " +
      `${formatDKK(monthly)}/md. bliver derfor trukket fra din månedlige ` +
      "opsparing. Slå realkreditlånet til på budgetsiden, hvis din opsparing " +
      "allerede er opgjort efter ydelsen.",
  }
}
