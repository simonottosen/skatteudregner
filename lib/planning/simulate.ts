/**
 * Pure future-economy simulation engine.
 *
 * Projects total wealth (liquid investments + home equity) year by year. The
 * deterministic path uses the mean net return; a seeded Monte Carlo run draws
 * yearly investment returns from a normal distribution to produce a p10–p90
 * confidence band. Everything is deterministic given the same inputs, so the
 * chart never jitters between renders.
 *
 * Monthly contributions stop at the retirement age. The deterministic path also
 * tracks where each year's growth comes from — contributions, home appreciation
 * (+ mortgage paydown), and investment returns — for the growth-sources view.
 */

import type {
  PlanningEvent,
  PlanningResult,
  PlanningState,
  PropertyEvent,
} from "./types"
import {
  PRIVATE_PAYOUT_OFFSET,
  annuityPayment,
  folkepensionAfterModregning,
} from "./pension"

// A fresh realkredit loan (e.g. after buying a new home) defaults to 30 years.
const MORTGAGE_TERM_MONTHS = 30 * 12

/** Mutable per-year balances tracked through the simulation. */
interface SimState {
  investments: number
  homeValue: number
  mortgage: number
  /** Months left on the current mortgage (drives the amortization annuity). */
  mortgageMonthsLeft: number
  /** Housing return for the current home (a property event can change it). */
  housingReturn: number
  /** Monthly contribution (a recurring event can change it). */
  monthly: number
}

interface PathResult {
  investments: number[]
  netWorth: number[]
  /** Per-year amount contributed to investments. */
  contributions: number[]
  /** Per-year home equity gain (appreciation + afdrag). */
  housingGains: number[]
  /** Per-year investment return earned. */
  investmentGains: number[]
  /** Per-year outstanding mortgage balance. */
  mortgage: number[]
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
function amortizeYear(
  mortgage: number,
  rate: number,
  monthsLeft: number
): number {
  if (mortgage <= 0) return 0
  // Past the loan term there are no more scheduled payments — leave any
  // balance (e.g. equity borrowed during retirement) untouched.
  if (monthsLeft <= 0) return mortgage
  const rMonth = rate / 12
  const annuity =
    rMonth > 0
      ? (mortgage * rMonth) / (1 - Math.pow(1 + rMonth, -monthsLeft))
      : mortgage / monthsLeft
  let balance = mortgage
  for (let m = 0; m < 12 && balance > 0; m++) {
    const interest = balance * rMonth
    balance = Math.max(0, balance - (annuity - interest))
  }
  return balance
}

/** Apply a single life event to the running state (mutates and returns it). */
function applyEvent(
  s: SimState,
  event: PlanningEvent,
  globalHousingReturn: number
): SimState {
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
      s.investments += s.homeValue - s.mortgage
      const ltv = Math.min(1, Math.max(0, ev.mortgageLtv))
      s.investments -= ev.newValue * (1 - ltv)
      s.homeValue = ev.newValue
      s.mortgage = ev.newValue * ltv
      s.mortgageMonthsLeft = MORTGAGE_TERM_MONTHS // fresh 30-year loan
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
 * Gross annual retirement income per year (index 0..years), from the private
 * pension pots and folkepension. Deterministic (pension pots use the fixed
 * pensionReturn). Pots are filled by annual contributions until retirement,
 * then paid out from the earliest payout age (folkepensionsalder − 3, but not
 * before the chosen retirement age).
 */
function onePersonIncomeByYear(
  state: PlanningState,
  person: PlanningState["pension"]["person1"]
): number[] {
  const years = Math.max(0, Math.round(state.endAge - state.currentAge))
  const p = state.pension
  const income = new Array<number>(years + 1).fill(0)
  const r = p.pensionReturn
  const privateAge = Math.max(
    state.retirementAge,
    person.folkepensionAge - PRIVATE_PAYOUT_OFFSET
  )

  let rate = person.ratepensionBalance
  let liv = person.livrenteBalance
  let alder = person.aldersopsparingBalance
  let rateYearsLeft = Math.max(1, Math.round(p.ratepensionYears))
  let alderYearsLeft = Math.max(1, Math.round(p.ratepensionYears))

  // Annual contributions are assumed to grow with inflation.
  const inflation = state.assumptions.inflation
  let rateContribution = person.ratepensionAnnual
  let livContribution = person.livrenteAnnual
  let alderContribution = person.aldersopsparingAnnual

  for (let y = 1; y <= years; y++) {
    const age = state.currentAge + y
    if (age < state.retirementAge) {
      rate += rateContribution
      liv += livContribution
      alder += alderContribution
      rateContribution *= 1 + inflation
      livContribution *= 1 + inflation
      alderContribution *= 1 + inflation
    }
    rate *= 1 + r
    liv *= 1 + r
    alder *= 1 + r

    let ratePay = 0
    let livPay = 0
    let alderPay = 0
    if (age >= privateAge) {
      if (rateYearsLeft > 0) {
        ratePay = Math.min(rate, annuityPayment(rate, r, rateYearsLeft))
        rate -= ratePay
        rateYearsLeft--
      }
      if (alderYearsLeft > 0) {
        alderPay = Math.min(alder, annuityPayment(alder, r, alderYearsLeft))
        alder -= alderPay
        alderYearsLeft--
      }
      // Livrente is lifelong → spread the balance over the remaining sim years.
      const livYearsLeft = state.endAge - age + 1
      livPay = Math.min(liv, annuityPayment(liv, r, livYearsLeft))
      liv -= livPay
    }

    let folke = 0
    if (p.includeFolkepension && age >= person.folkepensionAge) {
      // Aldersopsparing is exempt from modregning; ratepension + livrente count.
      folke = folkepensionAfterModregning(ratePay + livPay, p.single)
    }

    income[y] = ratePay + livPay + alderPay + folke
  }
  return income
}

/** Household retirement income — sum across both partners when a couple. */
function pensionIncomeByYear(state: PlanningState): number[] {
  const years = Math.max(0, Math.round(state.endAge - state.currentAge))
  const persons = state.pension.single
    ? [state.pension.person1]
    : [state.pension.person1, state.pension.person2]
  const income = new Array<number>(years + 1).fill(0)
  for (const person of persons) {
    const inc = onePersonIncomeByYear(state, person)
    for (let y = 0; y <= years; y++) income[y] += inc[y]
  }

  return income
}

/**
 * Run one full trajectory. `investmentReturnFor(yearIndex)` supplies the net
 * investment return for each step — a constant for the deterministic path, or a
 * random draw for a Monte Carlo run. Returns per-year totals (length = years+1,
 * including the starting year).
 *
 * `incomeByYear` is the gross retirement income; from the retirement age the
 * portfolio takes in (retirement income − annual spending) instead of a
 * contribution, i.e. it draws down when pensions don't cover spending.
 */
function runPath(
  state: PlanningState,
  investmentReturnFor: (yearIndex: number) => number,
  incomeByYear: number[]
): PathResult {
  const years = Math.max(0, Math.round(state.endAge - state.currentAge))
  const byAge = eventsByAge(state.events)
  const s: SimState = {
    investments: state.startInvestments,
    homeValue: state.homeValue,
    mortgage: state.mortgageBalance,
    mortgageMonthsLeft: Math.max(1, Math.round(state.mortgageTermYears * 12)),
    housingReturn: state.assumptions.housingReturn,
    monthly: state.monthlyContribution,
  }

  // Apply any events registered at the starting age before recording year 0.
  for (const e of byAge.get(state.currentAge) ?? []) {
    applyEvent(s, e, state.assumptions.housingReturn)
  }

  const investments: number[] = [Math.max(0, s.investments)]
  const netWorth: number[] = [s.investments + (s.homeValue - s.mortgage)]
  const contributions: number[] = [0]
  const housingGains: number[] = [0]
  const investmentGains: number[] = [0]
  const mortgageSeries: number[] = [s.mortgage]

  let contribution = s.monthly * 12
  for (let y = 1; y <= years; y++) {
    const age = state.currentAge + y
    const retired = age >= state.retirementAge
    // Spending grows with inflation. While working it's paid from salary (no
    // portfolio effect); in retirement the portfolio must cover it (pension
    // income first, then drawdown).
    const inflatedSpending =
      state.annualSpending * Math.pow(1 + state.assumptions.inflation, y)
    const flow = retired ? incomeByYear[y] - inflatedSpending : contribution

    // Investments: return on the existing balance, then this year's flow.
    const invBefore = s.investments
    const gain = invBefore * investmentReturnFor(y)
    s.investments = invBefore + gain + flow
    if (!retired) contribution *= 1 + state.assumptions.contributionGrowth

    // Home appreciation + mortgage paydown.
    const equityBefore = s.homeValue - s.mortgage
    s.homeValue *= 1 + s.housingReturn
    s.mortgage = amortizeYear(s.mortgage, state.mortgageRate, s.mortgageMonthsLeft)
    s.mortgageMonthsLeft = Math.max(0, s.mortgageMonthsLeft - 12)

    // In retirement, once investments run out, fund the rest of the spending
    // by borrowing against the home equity (mortgage rises, friværdi falls).
    if (retired && s.investments < 0) {
      const deficit = -s.investments
      const availableEquity = Math.max(0, s.homeValue - s.mortgage)
      const borrow = Math.min(deficit, availableEquity)
      s.mortgage += borrow
      s.investments += borrow // 0 if fully covered, else still negative
    }
    if (s.investments < 0) s.investments = 0 // insolvent → clamp

    // Equity change captures appreciation + afdrag − any retirement borrowing.
    const housingGain = s.homeValue - s.mortgage - equityBefore

    // Life events at this age (recurring deltas affect next year's contribution).
    const beforeMonthly = s.monthly
    for (const e of byAge.get(age) ?? []) {
      applyEvent(s, e, state.assumptions.housingReturn)
    }
    if (s.monthly !== beforeMonthly) contribution = s.monthly * 12

    investments.push(s.investments)
    netWorth.push(s.investments + (s.homeValue - s.mortgage))
    // "Indbetalinger" only counts deposits while working — not the
    // retirement drawdown, which is a withdrawal, not a contribution.
    contributions.push(retired ? 0 : flow)
    housingGains.push(housingGain)
    investmentGains.push(gain)
    mortgageSeries.push(s.mortgage)
  }

  return {
    investments,
    netWorth,
    contributions,
    housingGains,
    investmentGains,
    mortgage: mortgageSeries,
  }
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
 * path, a p10–p90 confidence band from a seeded Monte Carlo, the per-year
 * growth-source breakdown, and the FI age (first year liquid investments cover
 * 1/SWR × inflation-grown annual spending).
 */
export function simulatePlanning(state: PlanningState): PlanningResult {
  const years = Math.max(0, Math.round(state.endAge - state.currentAge))
  const { investmentReturn, investmentFee, volatility, inflation, safeWithdrawalRate } =
    state.assumptions
  const meanReturn = investmentReturn - investmentFee

  // Gross retirement income per year (deterministic — shared by all paths).
  const incomeByYear = pensionIncomeByYear(state)

  // Deterministic path (median + growth sources).
  const deterministic = runPath(state, () => meanReturn, incomeByYear)

  // Monte Carlo paths for the bands (only investment return is randomised).
  const mcNetWorthByYear: number[][] = Array.from({ length: years + 1 }, () => [])
  const mcInvestmentsByYear: number[][] = Array.from(
    { length: years + 1 },
    () => []
  )
  const rng = mulberry32(MC_SEED)
  for (let run = 0; run < MC_RUNS; run++) {
    const path = runPath(
      state,
      () => meanReturn + volatility * nextNormal(rng),
      incomeByYear
    )
    for (let y = 0; y <= years; y++) {
      mcNetWorthByYear[y].push(path.netWorth[y])
      mcInvestmentsByYear[y].push(path.investments[y])
    }
  }

  const fiMultiple = safeWithdrawalRate > 0 ? 1 / safeWithdrawalRate : 25
  let fiAge: number | null = null

  // Debt-free: first year the mortgage hits ~0 (only if there was a loan).
  let debtFreeAge: number | null = null
  if (state.mortgageBalance > 0) {
    for (let y = 1; y < deterministic.mortgage.length; y++) {
      if (deterministic.mortgage[y] <= 1) {
        debtFreeAge = state.currentAge + y
        break
      }
    }
  }

  let cumContrib = 0
  let cumHousing = 0
  let cumInvest = 0

  const points = deterministic.netWorth.map((netWorth, y) => {
    const age = state.currentAge + y
    const investments = deterministic.investments[y]
    const homeEquity = netWorth - investments

    cumContrib += deterministic.contributions[y]
    cumHousing += deterministic.housingGains[y]
    cumInvest += deterministic.investmentGains[y]

    if (fiAge === null) {
      const spendingNeed =
        state.annualSpending * Math.pow(1 + inflation, y) * fiMultiple
      if (spendingNeed > 0 && investments >= spendingNeed) fiAge = age
    }

    const sorted = [...mcNetWorthByYear[y]].sort((a, b) => a - b)
    const sortedInv = [...mcInvestmentsByYear[y]].sort((a, b) => a - b)
    return {
      age,
      investments,
      homeEquity,
      netWorth,
      band: [percentile(sorted, 10), percentile(sorted, 90)] as [number, number],
      investmentsBand: [
        percentile(sortedInv, 10),
        percentile(sortedInv, 90),
      ] as [number, number],
      contributionsTotal: cumContrib,
      housingGainsTotal: cumHousing,
      investmentGainsTotal: cumInvest,
      contributionYoY: deterministic.contributions[y],
      housingGainYoY: deterministic.housingGains[y],
      investmentGainYoY: deterministic.investmentGains[y],
      retirementIncome: incomeByYear[y],
    }
  })

  return { points, fiAge, debtFreeAge }
}
