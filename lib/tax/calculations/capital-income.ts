import type { TaxInput } from "../types"

export interface CapitalIncomeResult {
  netCapitalIncome: number
  netFinancialContracts: number
  totalCapitalIncome: number
  positiveCapitalIncome: number
}

export function calculateCapitalIncome(input: TaxInput): CapitalIncomeResult {
  const netCapitalIncome =
    input.bondGains +
    input.listedBondGains +
    input.investmentDividends +
    input.rentalIncome +
    input.investmentShareGains +
    input.unlistedBondGains +
    input.interestIncome -
    input.mortgageInterest -
    input.bankInterest -
    input.studentLoanInterest -
    input.otherDebtInterest -
    input.publicDebtInterest +
    input.foreignInterestNet +
    input.otherCapitalIncome

  const netFinancialContracts =
    input.financialContractIncome - input.financialContractPriorLoss

  const totalCapitalIncome = netCapitalIncome + netFinancialContracts
  const positiveCapitalIncome = Math.max(0, totalCapitalIncome)

  return {
    netCapitalIncome,
    netFinancialContracts,
    totalCapitalIncome,
    positiveCapitalIncome,
  }
}
