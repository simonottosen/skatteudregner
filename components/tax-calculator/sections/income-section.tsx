"use client"

import { NumberInput } from "../number-input"
import type { TaxInput } from "@/lib/tax/types"

interface IncomeSectionProps {
  input: TaxInput
  setField: <K extends keyof TaxInput>(field: K, value: TaxInput[K]) => void
}

export function IncomeSection({ input, setField }: IncomeSectionProps) {
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium">Indkomst med AM-bidrag</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberInput
          label="Arbejdsindkomst (A-indkomst)"
          value={input.workIncome}
          onChange={(v) => setField("workIncome", v)}
        />
        <NumberInput
          label="Honorarer (B-indkomst)"
          value={input.honorarIncome}
          onChange={(v) => setField("honorarIncome", v)}
        />
        <NumberInput
          label="Anden indkomst (bonus, aktieaflønning mv.)"
          value={input.otherAmIncome}
          onChange={(v) => setField("otherAmIncome", v)}
        />
      </div>

      <h4 className="text-sm font-medium">Indkomst uden AM-bidrag</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberInput
          label="Overførselsindkomst (dagpenge mv.)"
          value={input.transferIncome}
          onChange={(v) => setField("transferIncome", v)}
        />
        <NumberInput
          label="SU"
          value={input.suIncome}
          onChange={(v) => setField("suIncome", v)}
        />
        <NumberInput
          label="Øvrige overførselsindkomster"
          value={input.otherTransferIncome}
          onChange={(v) => setField("otherTransferIncome", v)}
        />
        <NumberInput
          label="Anden indkomst (udenlandsk pension mv.)"
          value={input.otherNonAmIncome}
          onChange={(v) => setField("otherNonAmIncome", v)}
        />
      </div>
    </div>
  )
}
