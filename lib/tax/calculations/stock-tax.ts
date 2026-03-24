import type { TaxInput, TaxRates } from "../types"

export interface StockTaxResult {
  stockIncome: number
  stockTaxLow: number
  stockTaxHigh: number
  totalStockTax: number
}

export function calculateStockTax(
  input: TaxInput,
  rates: TaxRates,
): StockTaxResult {
  const grossStockIncome =
    input.stockSaleGains +
    input.danishDividends +
    input.foreignDividends -
    input.stockDeductions -
    input.negativeStockIncomePriorYears

  const stockIncome = Math.max(0, grossStockIncome)

  // Determine progression limit (can be doubled if married)
  let progressionLimit = rates.stockProgressionLimit
  if (input.married) {
    const spouseUsed = Math.min(
      input.spouseStockIncome ?? 0,
      rates.stockProgressionLimit,
    )
    const spouseUnused = rates.stockProgressionLimit - spouseUsed
    progressionLimit += spouseUnused
  }

  const incomeAtLowRate = Math.min(stockIncome, progressionLimit)
  const incomeAtHighRate = Math.max(0, stockIncome - progressionLimit)

  const stockTaxLow = Math.round(rates.stockTaxLowRate * incomeAtLowRate)
  const stockTaxHigh = Math.round(rates.stockTaxHighRate * incomeAtHighRate)
  const totalStockTax = stockTaxLow + stockTaxHigh

  return {
    stockIncome,
    stockTaxLow,
    stockTaxHigh,
    totalStockTax,
  }
}
