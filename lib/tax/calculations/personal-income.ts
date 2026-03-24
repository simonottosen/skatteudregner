import type { TaxInput, TaxRates } from "../types"
import type { AmBidragResult } from "./am-bidrag"

export interface PersonalIncomeResult {
  pensionBasis: number
  ekstraPensionBasis: number
  fradragBasis: number
  nonAmIncome: number
  pensionLivrenteDeduction: number
  pensionRatepensionDeduction: number
  personalIncomeDeductions: number
  personalIncome: number
}

export function calculatePersonalIncome(
  input: TaxInput,
  rates: TaxRates,
  amResult: AmBidragResult,
): PersonalIncomeResult {
  // Non-AM income
  const nonAmIncome =
    input.transferIncome +
    input.suIncome +
    input.otherTransferIncome +
    input.otherNonAmIncome

  // Employer pension is income NOT subject to AM-bidrag, added to personal income
  const employerPensionIncome = input.employerPension

  // Ratepension: employer-administered ratepension is already deducted from salary
  // before the lønindkomst is reported, so it should NOT be subtracted from personal income.
  // It affects beskæftigelsesfradrag basis and ekstra pensionsfradrag instead.
  const pensionRatepensionDeduction = Math.min(
    input.privatePensionRatepension,
    rates.ratepensionMax,
  )

  // Livrente deductions ARE subtracted from personal income
  const pensionLivrenteDeduction = input.privatePensionLivrente

  // Basis for ekstra pensionsfradrag (private pension contributions)
  const ekstraPensionBasis =
    input.privatePensionLivrente + input.privatePensionRatepension

  // Basis for beskæftigelses- and jobfradrag:
  // AM-bidragspligtig indkomst + ratepension grossed up for AM-bidrag
  // SKAT: "summen af AM-bidragspligtig indkomst og indskud til ratepension mv.
  //  med tillæg af AM-bidrag"
  const ratepensionGrossedUp = Math.ceil(
    pensionRatepensionDeduction / (1 - rates.amBidragRate),
  )
  const fradragBasis =
    amResult.totalAmBasis + employerPensionIncome + ratepensionGrossedUp

  // Pension basis for other calculations
  const employeePensionAfterAm =
    (input.employeePension + input.employerPension) * (1 - rates.amBidragRate)
  const pensionBasisForRatepension =
    employeePensionAfterAm + input.atpEmployee + input.atpNonEmployee

  // Personal income = AM basis - AM-bidrag + employer pension + non-AM income
  //                   - livrente deductions - personal income deductions
  // Note: ratepension is NOT subtracted (already reflected in lower salary)
  const personalIncome = Math.floor(
    amResult.totalAmBasis +
      employerPensionIncome +
      nonAmIncome -
      amResult.amBidrag -
      amResult.amBidragInsurance -
      pensionLivrenteDeduction -
      input.personalIncomeDeductions,
  )

  return {
    pensionBasis: pensionBasisForRatepension,
    ekstraPensionBasis,
    fradragBasis,
    nonAmIncome,
    pensionLivrenteDeduction,
    pensionRatepensionDeduction,
    personalIncomeDeductions: input.personalIncomeDeductions,
    personalIncome,
  }
}
