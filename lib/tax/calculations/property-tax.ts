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

/** Ejendomsskatteloven § 24, stk. 1. The rate carries no indexation clause. */
const PRE_1998_EXTRA_RATE = 0.0021

function hasBasis(
  property: PropertyInput | undefined,
): property is PropertyInput {
  return !!property && property.assessmentBasis > 0
}

function calculateEjendomsvaerdiSkat(
  property: PropertyInput | undefined,
  rates: TaxRates,
  pensionerNedslag: number,
): number {
  if (!hasBasis(property)) return 0

  const basis = property.assessmentBasis

  // § 22, stk. 2: the low rate covers only the part of the basis that does not
  // exceed the progression limit, and the high rate applies to the rest
  // *instead of* — not on top of — the low one.
  const progressionLimit = rates.ejendomsvaerdiSkatThreshold
  let tax = rates.ejendomsvaerdiSkatLowRate * Math.min(basis, progressionLimit)
  if (basis > progressionLimit) {
    tax += rates.ejendomsvaerdiSkatHighRate * (basis - progressionLimit)
  }

  if (property.purchasedBefore19980701) {
    // § 23, stk. 1: 1,0 promille of the basis, uncapped and open to every
    // property type. SKAT states the effect as paying 4,1 ‰ / 13,0 ‰ instead
    // of 5,1 ‰ / 14,0 ‰.
    tax -= rates.ejendomsvaerdiSkatPre1998Rate * basis

    // § 24: a *further* 2,1 promille, capped at 1.200 kr. per boligenhed.
    // Stk. 2 denies this second nedslag to ejerlejligheder and to fredede
    // ejendomme under ligningslovens § 15 K — the two cases the isCondo flag
    // marks ("Ejerlejlighed/fredet" in the form).
    if (!property.isCondo) {
      tax -= Math.min(
        rates.ejendomsvaerdiSkatPre1998MaxReduction,
        PRE_1998_EXTRA_RATE * basis,
      )
    }
  }

  tax -= pensionerNedslag

  // § 16: the tax on a jointly owned property falls on each owner by ejerandel,
  // after the nedslag in §§ 23-26. § 25, 3. pkt. floors the result at zero.
  return Math.max(0, tax * property.ownershipShare)
}

/**
 * The share of the § 25 pensioner nedslag that survives § 26's income
 * graduation.
 *
 * § 26 reduces "nedslaget efter § 25" — one amount belonging to the person — by
 * 5 % of income above the grundbeløb. Someone who owns both a helårsbolig and a
 * fritidsbolig meets that clawback once, against the combined 6.000 + 2.000 kr.,
 * so it cannot be recomputed against each property's own maximum. Expressing it
 * as a factor spends the graduation exactly once while leaving each property
 * with its own statutory amount.
 */
function pensionerNedslagFactor(input: TaxInput, rates: TaxRates): number {
  const age = calculateAge(input.birthDate, input.year)
  if (age < calculateRetirementAge(input.birthDate) && !input.singleParent) {
    return 0
  }

  const fullNedslag =
    (hasBasis(input.property) ? rates.ejendomsvaerdiSkatPensionerReduction : 0) +
    (hasBasis(input.summerHouse)
      ? rates.ejendomsvaerdiSkatPensionerReductionSummer
      : 0)
  if (fullNedslag === 0) return 0

  const totalIncome =
    input.workIncome +
    input.honorarIncome +
    input.otherAmIncome +
    input.transferIncome +
    input.suIncome
  const threshold = input.married
    ? rates.ejendomsvaerdiSkatPensionerIncomeThresholdMarried
    : rates.ejendomsvaerdiSkatPensionerIncomeThresholdSingle
  const graduation = Math.max(
    0,
    (totalIncome - threshold) * rates.ejendomsvaerdiSkatPensionerIncomeRate,
  )

  return Math.max(0, fullNedslag - graduation) / fullNedslag
}

export function calculatePropertyTax(
  input: TaxInput,
  rates: TaxRates,
  primaryMunicipality: MunicipalityData,
  summerMunicipality?: MunicipalityData,
): PropertyTaxResult {
  // Ejendomsværdiskat
  const nedslagFactor = pensionerNedslagFactor(input, rates)

  const ejendomsvaerdiSkatPrimary = Math.round(
    calculateEjendomsvaerdiSkat(
      input.property,
      rates,
      rates.ejendomsvaerdiSkatPensionerReduction * nedslagFactor,
    ),
  )

  const ejendomsvaerdiSkatSummer = Math.round(
    calculateEjendomsvaerdiSkat(
      input.summerHouse,
      rates,
      rates.ejendomsvaerdiSkatPensionerReductionSummer * nedslagFactor,
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
