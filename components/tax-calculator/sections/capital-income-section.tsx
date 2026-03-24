"use client"

import { NumberInput } from "../number-input"
import type { TaxInput } from "@/lib/tax/types"

interface CapitalIncomeSectionProps {
  input: TaxInput
  setField: <K extends keyof TaxInput>(field: K, value: TaxInput[K]) => void
}

export function CapitalIncomeSection({
  input,
  setField,
}: CapitalIncomeSectionProps) {
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium">Kapitalindtægter</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberInput
          label="Renteindtægter"
          value={input.interestIncome}
          onChange={(v) => setField("interestIncome", v)}
        />
        <NumberInput
          label="Lejeindtægter"
          value={input.rentalIncome}
          onChange={(v) => setField("rentalIncome", v)}
        />
        <NumberInput
          label="Gevinst/tab obligationer"
          value={input.bondGains}
          onChange={(v) => setField("bondGains", v)}
        />
        <NumberInput
          label="Anden kapitalindkomst"
          value={input.otherCapitalIncome}
          onChange={(v) => setField("otherCapitalIncome", v)}
        />
      </div>

      <h4 className="text-sm font-medium">Renteudgifter</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberInput
          label="Realkreditrenter"
          value={input.mortgageInterest}
          onChange={(v) => setField("mortgageInterest", v)}
        />
        <NumberInput
          label="Banklånsrenter"
          value={input.bankInterest}
          onChange={(v) => setField("bankInterest", v)}
        />
        <NumberInput
          label="Studielånsrenter"
          value={input.studentLoanInterest}
          onChange={(v) => setField("studentLoanInterest", v)}
        />
        <NumberInput
          label="Andre renteudgifter"
          value={input.otherDebtInterest}
          onChange={(v) => setField("otherDebtInterest", v)}
        />
      </div>
    </div>
  )
}
