/**
 * Taxation for the planning simulation, built on the real Danish tax engine in
 * `@/lib/tax`. This replaces the earlier hand-rolled approximation so the
 * projection uses the same rules as the /skat page: AM-bidrag, bund/mellem/top/
 * top-top-skat, kommune- + kirkeskat, personfradrag, and the aktieindkomst
 * progression limit (incl. the married doubling).
 *
 * Multi-decade bracket creep is avoided by holding the rules at a fixed year and
 * applying them to *real* (today's-kroner) income: a nominal amount at year
 * offset `t` is deflated by (1+inflation)^t, taxed, and the resulting tax is
 * re-inflated. So an income that is constant in real terms pays a constant real
 * tax — exactly how indexed brackets behave.
 */

import type { PlanningTaxProfile } from "./types"
import { createDefaultInput } from "@/lib/tax/defaults"
import { calculateTax } from "@/lib/tax/calculator"
import { getRates } from "@/lib/tax/rates"
import { calculateStockTax } from "@/lib/tax/calculations/stock-tax"

/** Per-call context: where the household lives and how far out we are. */
export interface TaxContext {
  /** Year offset from the start of the projection (0 = today). */
  t: number
  /** General inflation, used to index the brackets to real terms. */
  inflation: number
  profile: PlanningTaxProfile
  /** Couple vs. single — doubles the aktieindkomst limit + transfers thresholds. */
  married: boolean
}

/** Deflation factor that turns a nominal year-`t` amount into today's kroner. */
function realFactor(ctx: TaxContext): number {
  return Math.pow(1 + ctx.inflation, ctx.t)
}

/**
 * Personal income tax on a year's taxable pension income for one person
 * (ratepension + livrente + folkepension). Pension payouts carry no AM-bidrag
 * and earn no beskæftigelsesfradrag, so the gross amount is mapped to non-AM
 * personal income. `spouseTaxableNominal` lets the mellem-/topskat thresholds
 * transfer between partners.
 */
export function pensionIncomeTax(
  nominalTaxable: number,
  ctx: TaxContext,
  spouseTaxableNominal?: number
): number {
  if (nominalTaxable <= 0) return 0
  const f = realFactor(ctx)
  const input = createDefaultInput()
  input.year = ctx.profile.year
  input.municipality = ctx.profile.municipality
  input.churchMember = ctx.profile.churchMember
  input.married = ctx.married
  input.otherNonAmIncome = nominalTaxable / f
  if (ctx.married && spouseTaxableNominal !== undefined) {
    input.spousePersonalIncome = Math.max(0, spouseTaxableNominal / f)
  }
  const realTax = Math.max(0, calculateTax(input).totalIncomeTax)
  return realTax * f
}

/** Aktieindkomst tax on a year's realised investment gain (27 % / 42 %). */
export function stockGainTax(nominalGain: number, ctx: TaxContext): number {
  if (nominalGain <= 0) return 0
  const f = realFactor(ctx)
  const input = createDefaultInput()
  input.year = ctx.profile.year
  input.married = ctx.married
  input.stockSaleGains = nominalGain / f
  const realTax = calculateStockTax(input, getRates(ctx.profile.year)).totalStockTax
  return realTax * f
}

/**
 * Smallest gross sale whose proceeds, after aktieindkomst tax, net `nominalNet`,
 * when a fraction `gainFraction` of each krone sold is a taxable gain. Inverts
 * the two-bracket stock tax (using the same married-doubled progression limit as
 * `stockGainTax`) so a drawdown sells exactly enough — no spurious borrowing.
 */
export function grossUpStockSale(
  nominalNet: number,
  gainFraction: number,
  ctx: TaxContext
): number {
  if (nominalNet <= 0) return 0
  const g = Math.min(1, Math.max(0, gainFraction))
  if (g <= 0) return nominalNet
  const f = realFactor(ctx)
  const realNet = nominalNet / f
  const rates = getRates(ctx.profile.year)
  // A household pot attributes the spouse's full unused band → limit doubles.
  const limit = ctx.married
    ? rates.stockProgressionLimit * 2
    : rates.stockProgressionLimit
  // Low bracket: realNet = sell · (1 − low·g).
  const lowSell = realNet / (1 - rates.stockTaxLowRate * g)
  if (lowSell * g <= limit) return lowSell * f
  // High bracket: realNet = sell · (1 − high·g) + (high − low)·limit.
  const offset = (rates.stockTaxHighRate - rates.stockTaxLowRate) * limit
  const highSell = (realNet - offset) / (1 - rates.stockTaxHighRate * g)
  return highSell * f
}
