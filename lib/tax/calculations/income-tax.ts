import type { TaxRates, MunicipalityData } from "../types"

export interface IncomeTaxResult {
  amBidragTotal: number
  bundSkat: number
  mellemSkat: number
  mellemSkatCapital: number
  topSkat: number
  topTopSkat: number
  personFradragStatCredit: number
  kommuneSkat: number
  kirkeSkat: number
  personFradragKommuneCredit: number
  totalIncomeTax: number
  marginalTaxRate: number
}

export function calculateIncomeTax(
  rates: TaxRates,
  municipality: MunicipalityData,
  churchMember: boolean,
  amBidragTotal: number,
  personalIncome: number,
  positiveCapitalIncome: number,
  taxableIncome: number,
  married: boolean,
  spousePersonalIncome?: number,
): IncomeTaxResult {
  const kommuneRate = municipality.taxRate / 100
  const kircheRate = churchMember ? municipality.churchTaxRate / 100 : 0
  const kommuneKircheRate = kommuneRate + kircheRate

  // Bundskat: rate × (personalIncome + positiveCapitalIncome)
  const bundSkat = rates.bundSkatRate * (personalIncome + positiveCapitalIncome)

  // Mellemskat threshold (can be doubled if married and spouse doesn't use it)
  let mellemSkatThreshold = rates.mellemSkatThreshold
  if (married && spousePersonalIncome !== undefined) {
    const spouseUnused = Math.max(0, rates.mellemSkatThreshold - spousePersonalIncome)
    mellemSkatThreshold += spouseUnused
  }

  // Mellemskat on personal income
  // For 2026: skatteloft check applies
  const mellemSkatRateEffective = computeEffectiveMellemRate(
    rates,
    kommuneRate,
    kircheRate,
  )
  const mellemSkat =
    mellemSkatRateEffective * Math.max(0, personalIncome - mellemSkatThreshold)

  // Mellemskat on capital income (4.59% on capital > threshold)
  const mellemSkatCapital =
    rates.mellemSkatCapitalRate *
    Math.max(0, positiveCapitalIncome - rates.capitalKapitalindkomstThreshold)

  // Topskat – skatteloft covers bundskat + topskat + kommune + kirke
  // Mellemskat (2026+) is outside the skatteloft
  const topSkatRateEffective =
    rates.topSkatRate > 0
      ? Math.min(
          rates.topSkatRate,
          Math.max(
            0,
            rates.skatteLoft -
              rates.bundSkatRate -
              kommuneRate -
              kircheRate,
          ),
        )
      : 0
  const topSkat =
    topSkatRateEffective * Math.max(0, personalIncome - rates.topSkatThreshold)

  // Top-topskat
  const topTopSkat =
    rates.topTopSkatRate * Math.max(0, personalIncome - rates.topTopSkatThreshold)

  // Personfradrag credit (stat)
  const personFradragStatCredit =
    rates.bundSkatRate * Math.min(personalIncome, rates.personFradrag)

  // Kommuneskat + kirkeskat on taxable income
  const kommuneSkat = kommuneRate * taxableIncome
  const kirkeSkat = kircheRate * taxableIncome

  // Personfradrag credit (kommune/kirke)
  const personFradragKommuneCredit =
    kommuneKircheRate * Math.min(taxableIncome, rates.personFradrag)

  const totalIncomeTax = Math.round(
    amBidragTotal +
      bundSkat +
      mellemSkat +
      mellemSkatCapital +
      topSkat +
      topTopSkat -
      personFradragStatCredit +
      kommuneSkat +
      kirkeSkat -
      personFradragKommuneCredit,
  )

  // Marginal tax rate on work income
  const marginalTaxRate = computeMarginalRate(
    rates,
    personalIncome,
    kommuneRate,
    kircheRate,
  )

  return {
    amBidragTotal,
    bundSkat: Math.round(bundSkat),
    mellemSkat: Math.round(mellemSkat),
    mellemSkatCapital: Math.round(mellemSkatCapital),
    topSkat: Math.round(topSkat),
    topTopSkat: Math.round(topTopSkat),
    personFradragStatCredit: Math.round(personFradragStatCredit),
    kommuneSkat: Math.round(kommuneSkat),
    kirkeSkat: Math.round(kirkeSkat),
    personFradragKommuneCredit: Math.round(personFradragKommuneCredit),
    totalIncomeTax,
    marginalTaxRate,
  }
}

function computeEffectiveMellemRate(
  rates: TaxRates,
  kommuneRate: number,
  kircheRate: number,
): number {
  if (rates.mellemSkatRate <= 0) return 0
  // Check skatteloft: bundskat + mellemskat + kommune + kirke <= skatteloft
  const baseRate = rates.bundSkatRate + kommuneRate + kircheRate
  const available = Math.max(0, rates.skatteLoft - baseRate)
  return Math.min(rates.mellemSkatRate, available)
}

function computeMarginalRate(
  rates: TaxRates,
  personalIncome: number,
  kommuneRate: number,
  kircheRate: number,
): number {
  // AM-bidrag rate
  const amRate = rates.amBidragRate
  const afterAm = 1 - amRate

  // Skatteloft covers: bundskat + topskat + kommune + kirke (NOT mellemskat)
  let skatteloftSubject = rates.bundSkatRate + kommuneRate + kircheRate

  // Add topskat if above threshold
  if (personalIncome >= rates.topSkatThreshold && rates.topSkatRate > 0) {
    skatteloftSubject += rates.topSkatRate
  }

  // Cap skatteloft-subject rates at the skatteloft
  const cappedSkatteloft = Math.min(skatteloftSubject, rates.skatteLoft)

  // Mellemskat is outside the skatteloft — add separately
  let marginal = cappedSkatteloft
  if (personalIncome >= rates.mellemSkatThreshold) {
    marginal += computeEffectiveMellemRate(rates, kommuneRate, kircheRate)
  }

  // Add top-topskat if above threshold (also outside skatteloft)
  if (personalIncome >= rates.topTopSkatThreshold && rates.topTopSkatRate > 0) {
    marginal += rates.topTopSkatRate
  }

  // Total marginal = AM + (1-AM) * income tax marginal
  return amRate + afterAm * marginal
}
