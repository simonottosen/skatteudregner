import type { TaxInput, TaxRates } from "../types"

export interface AmBidragResult {
  amBasis: number
  insuranceBasis: number
  totalAmBasis: number
  amBidrag: number
  amBidragInsurance: number
}

export function calculateAmBidrag(
  input: TaxInput,
  rates: TaxRates,
): AmBidragResult {
  const amBasis =
    input.workIncome + input.honorarIncome + input.otherAmIncome

  const totalInsuranceCosts =
    input.insuranceCostsFromSkat + input.otherInsuranceCosts
  const insuranceBasis = Math.ceil(totalInsuranceCosts / (1 - rates.amBidragRate))

  const totalAmBasis = amBasis + insuranceBasis

  const amBidrag = Math.floor(rates.amBidragRate * amBasis)
  const amBidragInsurance = Math.floor(insuranceBasis * rates.amBidragRate)

  return {
    amBasis,
    insuranceBasis,
    totalAmBasis,
    amBidrag,
    amBidragInsurance,
  }
}
