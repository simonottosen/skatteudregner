"use client"

import { NumberInput } from "../number-input"
import type { SetTaxField, TaxInput } from "@/lib/tax/types"

interface StockIncomeSectionProps {
  input: TaxInput
  setField: SetTaxField
}

export function StockIncomeSection({
  input,
  setField,
}: StockIncomeSectionProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberInput
          label="Kursgevinst ved salg af aktier"
          value={input.stockSaleGains}
          onChange={(v) => setField("stockSaleGains", v)}
        />
        <NumberInput
          label="Udbytte fra danske aktier"
          value={input.danishDividends}
          onChange={(v) => setField("danishDividends", v)}
        />
        <NumberInput
          label="Udbytte fra udenlandske aktier"
          value={input.foreignDividends}
          onChange={(v) => setField("foreignDividends", v)}
        />
        <NumberInput
          label="Negativ aktieindkomst (tidligere år)"
          value={input.negativeStockIncomePriorYears}
          onChange={(v) => setField("negativeStockIncomePriorYears", v)}
        />
        <NumberInput
          label="Betalt udenlandsk udbytteskat"
          value={input.foreignDividendTaxPaid}
          onChange={(v) => setField("foreignDividendTaxPaid", v)}
        />
        <NumberInput
          label="Indeholdt dansk udbytteskat"
          value={input.danishDividendTaxWithheld}
          onChange={(v) => setField("danishDividendTaxWithheld", v)}
        />
      </div>
    </div>
  )
}
