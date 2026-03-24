import type { TaxInput, TaxRates, PropertyInput, MunicipalityData } from "../types"
import { calculateAge, calculateRetirementAge } from "./itemized-deductions"

export interface PropertyTaxResult {
  ejendomsvaerdiSkatPrimary: number
  ejendomsvaerdiSkatSummer: number
  totalEjendomsvaerdiSkat: number
  grundskyldPrimary: number
  grundskyldSummer: number
  personalTaxDiscount: number
  totalPropertyTax: number
}

function calculateEjendomsvaerdiSkat(
  property: PropertyInput | undefined,
  rates: TaxRates,
  isCondo: boolean,
  input: TaxInput,
  isPrimary: boolean,
): number {
  if (!property || property.assessmentBasis <= 0) return 0

  const basis = property.assessmentBasis
  const share = property.ownershipShare

  // Base rate (condo gets lower effective rate from deducting pre-1998 adjustment)
  const lowRate = isCondo
    ? rates.ejendomsvaerdiSkatLowRate - rates.ejendomsvaerdiSkatPre1998Rate
    : rates.ejendomsvaerdiSkatLowRate
  const highRate = isCondo
    ? rates.ejendomsvaerdiSkatHighRate - rates.ejendomsvaerdiSkatPre1998Rate
    : rates.ejendomsvaerdiSkatHighRate

  let tax = lowRate * basis * share
  if (basis > rates.ejendomsvaerdiSkatThreshold) {
    tax +=
      highRate * (basis - rates.ejendomsvaerdiSkatThreshold) * share
  }

  // Pre-1998 purchase extra reduction
  if (property.purchasedBefore19980701) {
    const reduction = Math.min(
      rates.ejendomsvaerdiSkatPre1998MaxReduction,
      Math.floor(
        Math.max(0, basis - rates.ejendomsvaerdiSkatPre1998MaxReduction) *
          rates.ejendomsvaerdiSkatPre1998Rate,
      ),
    ) * share
    tax -= reduction
  }

  // Pensioner reduction
  const age = calculateAge(input.birthDate, input.year)
  const retAge = calculateRetirementAge(input.birthDate)
  if (age >= retAge || input.singleParent) {
    const maxReduction = isPrimary
      ? rates.ejendomsvaerdiSkatPensionerReduction
      : rates.ejendomsvaerdiSkatPensionerReductionSummer

    // Income-based graduation of reduction
    const totalIncome =
      input.workIncome +
      input.honorarIncome +
      input.otherAmIncome +
      input.transferIncome +
      input.suIncome
    const threshold = input.married
      ? rates.ejendomsvaerdiSkatPensionerIncomeThresholdMarried
      : rates.ejendomsvaerdiSkatPensionerIncomeThresholdSingle

    const incomeReduction = Math.max(
      0,
      (totalIncome - threshold) * rates.ejendomsvaerdiSkatPensionerIncomeRate,
    )
    const actualReduction = Math.max(0, maxReduction - incomeReduction)
    tax -= actualReduction * share
  }

  return Math.max(0, tax)
}

export function calculatePropertyTax(
  input: TaxInput,
  rates: TaxRates,
  primaryMunicipality: MunicipalityData,
  summerMunicipality?: MunicipalityData,
): PropertyTaxResult {
  // Ejendomsværdiskat
  const ejendomsvaerdiSkatPrimary = Math.round(
    calculateEjendomsvaerdiSkat(
      input.property,
      rates,
      input.property?.isCondo ?? false,
      input,
      true,
    ),
  )

  const ejendomsvaerdiSkatSummer = Math.round(
    calculateEjendomsvaerdiSkat(
      input.summerHouse,
      rates,
      input.summerHouse?.isCondo ?? false,
      input,
      false,
    ),
  )

  const totalEjendomsvaerdiSkat =
    ejendomsvaerdiSkatPrimary + ejendomsvaerdiSkatSummer

  // Grundskyld
  const grundskyldPrimary = input.property
    ? Math.round(
        (primaryMunicipality.grundskyldRate / 1000) *
          input.property.landAssessmentBasis *
          input.property.ownershipShare,
      )
    : 0

  const grundskyldSummer =
    input.summerHouse && summerMunicipality
      ? Math.round(
          (summerMunicipality.grundskyldRate / 1000) *
            input.summerHouse.landAssessmentBasis *
            input.summerHouse.ownershipShare,
        )
      : 0

  // Personal tax discount
  const personalTaxDiscount =
    (input.property?.personalTaxDiscount ?? 0) +
    (input.summerHouse?.personalTaxDiscount ?? 0)

  const totalPropertyTax = Math.max(
    0,
    totalEjendomsvaerdiSkat + grundskyldPrimary + grundskyldSummer - personalTaxDiscount,
  )

  return {
    ejendomsvaerdiSkatPrimary,
    ejendomsvaerdiSkatSummer,
    totalEjendomsvaerdiSkat,
    grundskyldPrimary,
    grundskyldSummer,
    personalTaxDiscount,
    totalPropertyTax,
  }
}
