/**
 * Pure future-economy simulation engine.
 *
 * Projects total wealth (liquid investments + home equity) year by year. The
 * deterministic path uses the mean net return; a seeded Monte Carlo run draws
 * yearly investment returns from a normal distribution to produce a p10–p90
 * confidence band. Everything is deterministic given the same inputs, so the
 * chart never jitters between renders.
 */

import type {
  PlanningEvent,
  PlanningResult,
  PlanningState,
  PropertyEvent,
} from "./types"

// Danish realkredit assumptions, mirroring lib/budget/generate-budget.ts.
const MORTGAGE_RATE = 0.04
const MORTGAGE_TERM_MONTHS = 30 * 12

/** Mutable per-year balances tracked through the simulation. */
interface SimState {
  investments: number
  homeValue: number
  mortgage: number
  /** Housing return for the current home (a property event can change it). */
  housingReturn: number
  /** Monthly contribution (a recurring event can change it). */
  monthly: number
}

const MC_RUNS = 400
const MC_SEED = 0x9e3779b9

/** Mulberry32 — tiny, fast, deterministic PRNG seeded by an integer. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal via Box–Muller, driven by a uniform PRNG. */
function nextNormal(rng: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * One year of mortgage paydown: the principal portion of an annuity payment at
 * the assumed mortgage rate. Interest is already covered by budget expenses, so
 * only the principal reduction matters for equity. Returns the new balance.
 */
function amortizeYear(mortgage: number): number {
  if (mortgage <= 0) return 0
  const rMonth = MORTGAGE_RATE / 12
  const annuity =
    (mortgage * rMonth) / (1 - Math.pow(1 + rMonth, -MORTGAGE_TERM_MONTHS))
  // Principal repaid over the next 12 months.
  let balance = mortgage
  for (let m = 0; m < 12 && balance > 0; m++) {
    const interest = balance * rMonth
    balance = Math.max(0, balance - (annuity - interest))
  }
  return balance
}

/** Apply a single life event to the running state (mutates and returns it). */
function applyEvent(s: SimState, event: PlanningEvent, globalHousingReturn: number): SimState {
  switch (event.type) {
    case "expense":
      s.investments -= event.amount
      break
    case "windfall":
      s.investments += event.amount
      break
    case "recurring":
      s.monthly += event.monthlyDelta
      break
    case "property": {
      const ev = event as PropertyEvent
      // Sell the current home: realise equity into investments.
      s.investments += s.homeValue - s.mortgage
      // Buy the new home: down payment out of investments, rest financed.
      const ltv = Math.min(1, Math.max(0, ev.mortgageLtv))
      s.investments -= ev.newValue * (1 - ltv)
      s.homeValue = ev.newValue
      s.mortgage = ev.newValue * ltv
      s.housingReturn = ev.housingReturnOverride ?? globalHousingReturn
      break
    }
  }
  return s
}

/** Events grouped by the age at which they fire. */
function eventsByAge(events: PlanningEvent[]): Map<number, PlanningEvent[]> {
  const map = new Map<number, PlanningEvent[]>()
  for (const e of events) {
    const arr = map.get(e.age) ?? []
    arr.push(e)
    map.set(e.age, arr)
  }
  return map
}

/**
 * Run one full trajectory. `investmentReturnFor(yearIndex)` supplies the net
 * investment return for each step — a constant for the deterministic path, or a
 * random draw for a Monte Carlo run. Returns per-year totals (length = years+1,
 * including the starting year).
 */
function runPath(
  state: PlanningState,
  investmentReturnFor: (yearIndex: number) => number
): { investments: number[]; netWorth: number[] } {
  const years = Math.max(0, Math.round(state.endAge - state.currentAge))
  const byAge = eventsByAge(state.events)
  const s: SimState = {
    investments: state.startInvestments,
    homeValue: state.homeValue,
    mortgage: state.mortgageBalance,
    housingReturn: state.assumptions.housingReturn,
    monthly: state.monthlyContribution,
  }

  // Apply any events registered at the starting age before recording year 0.
  for (const e of byAge.get(state.currentAge) ?? []) {
    applyEvent(s, e, state.assumptions.housingReturn)
  }

  const investments: number[] = [Math.max(0, s.investments)]
  const netWorth: number[] = [s.investments + (s.homeValue - s.mortgage)]

  let contribution = s.monthly * 12
  for (let y = 1; y <= years; y++) {
    const age = state.currentAge + y

    // Grow + contribute (contribution grows each year).
    s.investments = s.investments * (1 + investmentReturnFor(y)) + contribution
    contribution *= 1 + state.assumptions.contributionGrowth

    // Home appreciation + mortgage paydown.
    s.homeValue *= 1 + s.housingReturn
    s.mortgage = amortizeYear(s.mortgage)

    // Life events at this age (recurring deltas affect next year's contribution).
    const before = s.monthly
    for (const e of byAge.get(age) ?? []) {
      applyEvent(s, e, state.assumptions.housingReturn)
    }
    if (s.monthly !== before) contribution = s.monthly * 12

    investments.push(Math.max(0, s.investments))
    netWorth.push(Math.max(0, s.investments) + (s.homeValue - s.mortgage))
  }

  return { investments, netWorth }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.round((p / 100) * (sortedAsc.length - 1)))
  )
  return sortedAsc[idx]
}

/**
 * Simulate the household's wealth trajectory. Produces the deterministic median
 * path, a p10–p90 confidence band from a seeded Monte Carlo, and the FI age
 * (first year liquid investments cover 1/SWR × inflation-grown annual spending).
 */
export function simulatePlanning(state: PlanningState): PlanningResult {
  const years = Math.max(0, Math.round(state.endAge - state.currentAge))
  const { investmentReturn, investmentFee, volatility, inflation, safeWithdrawalRate } =
    state.assumptions
  const meanReturn = investmentReturn - investmentFee

  // Deterministic path (median).
  const deterministic = runPath(state, () => meanReturn)

  // Monte Carlo paths for the band (only investment return is randomised).
  const mcNetWorthByYear: number[][] = Array.from({ length: years + 1 }, () => [])
  const rng = mulberry32(MC_SEED)
  for (let run = 0; run < MC_RUNS; run++) {
    const path = runPath(state, () => meanReturn + volatility * nextNormal(rng))
    for (let y = 0; y <= years; y++) mcNetWorthByYear[y].push(path.netWorth[y])
  }

  const fiMultiple = safeWithdrawalRate > 0 ? 1 / safeWithdrawalRate : 25
  let fiAge: number | null = null

  const points = deterministic.netWorth.map((netWorth, y) => {
    const age = state.currentAge + y
    const investments = deterministic.investments[y]
    const homeEquity = netWorth - investments

    // FI: first year liquid investments cover the inflation-grown spending need.
    if (fiAge === null) {
      const spendingNeed =
        state.annualSpending * Math.pow(1 + inflation, y) * fiMultiple
      if (spendingNeed > 0 && investments >= spendingNeed) fiAge = age
    }

    const sorted = [...mcNetWorthByYear[y]].sort((a, b) => a - b)
    return {
      age,
      investments,
      homeEquity,
      netWorth,
      band: [percentile(sorted, 10), percentile(sorted, 90)] as [number, number],
    }
  })

  return { points, fiAge }
}
