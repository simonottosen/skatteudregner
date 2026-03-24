export interface TaxableIncomeResult {
  taxableIncome: number
}

export function calculateTaxableIncome(
  personalIncome: number,
  totalCapitalIncome: number,
  totalItemizedDeductions: number,
): TaxableIncomeResult {
  // Skattepligtig indkomst = personlig indkomst + kapitalindkomst - ligningsmæssige fradrag
  // totalCapitalIncome can be negative (net interest expenses)
  // totalItemizedDeductions is positive (sum of all fradrag that reduce taxable income)
  const taxableIncome = Math.max(
    0,
    Math.floor(personalIncome + totalCapitalIncome - totalItemizedDeductions),
  )
  return { taxableIncome }
}
