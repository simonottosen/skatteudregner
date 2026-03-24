"use client"

import { NumberInput } from "../number-input"
import type { TaxInput } from "@/lib/tax/types"
import { getRates } from "@/lib/tax/rates"

interface DeductionsSectionProps {
  input: TaxInput
  setField: <K extends keyof TaxInput>(field: K, value: TaxInput[K]) => void
}

export function DeductionsSection({ input, setField }: DeductionsSectionProps) {
  const rates = getRates(input.year)

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium">Pensionsindbetalinger</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberInput
          label="Eget pensionsbidrag"
          value={input.employeePension}
          onChange={(v) => setField("employeePension", v)}
        />
        <NumberInput
          label="Arbejdsgivers pensionsbidrag"
          value={input.employerPension}
          onChange={(v) => setField("employerPension", v)}
        />
        <NumberInput
          label="ATP-bidrag (arbejdsgiver)"
          value={input.atpEmployee}
          onChange={(v) => setField("atpEmployee", v)}
        />
        <NumberInput
          label="Privat livrente"
          value={input.privatePensionLivrente}
          onChange={(v) => setField("privatePensionLivrente", v)}
        />
        <NumberInput
          label="Privat ratepension"
          value={input.privatePensionRatepension}
          onChange={(v) => setField("privatePensionRatepension", v)}
          hint={`maks. ${rates.ratepensionMax.toLocaleString("da-DK")} kr.`}
        />
      </div>

      <h4 className="text-sm font-medium">Ligningsmæssige fradrag</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberInput
          label="Fagligt kontingent"
          value={input.unionFees}
          onChange={(v) => setField("unionFees", v)}
          hint={`maks. ${rates.unionFeesMax.toLocaleString("da-DK")} kr.`}
        />
        <NumberInput
          label="A-kasse, efterløn"
          value={input.aKasse}
          onChange={(v) => setField("aKasse", v)}
        />
        <NumberInput
          label="Gaver til velgørenhed"
          value={input.charitableDonations}
          onChange={(v) => setField("charitableDonations", v)}
          hint={`maks. ${rates.charitableDonationsMax.toLocaleString("da-DK")} kr.`}
        />
        <NumberInput
          label="Servicefradrag"
          value={input.serviceDeduction}
          onChange={(v) => setField("serviceDeduction", v)}
          hint={`maks. ${rates.serviceDeductionMax.toLocaleString("da-DK")} kr.`}
        />
        <NumberInput
          label="Grøn istandsættelse"
          value={input.greenRenovation}
          onChange={(v) => setField("greenRenovation", v)}
          hint={`maks. ${rates.greenRenovationMax.toLocaleString("da-DK")} kr.`}
        />
        <NumberInput
          label="Dobbelt husførelse"
          value={input.doubleHousehold}
          onChange={(v) => setField("doubleHousehold", v)}
          hint={`maks. ${rates.doubleHouseholdMax.toLocaleString("da-DK")} kr.`}
        />
        <NumberInput
          label="Underholdsbidrag"
          value={input.alimony}
          onChange={(v) => setField("alimony", v)}
        />
        <NumberInput
          label="Øvrige lønmodtagerudgifter"
          value={input.otherEmployeeExpenses}
          onChange={(v) => setField("otherEmployeeExpenses", v)}
          hint={`bundgrænse ${rates.otherEmployeeExpensesThreshold.toLocaleString("da-DK")} kr.`}
        />
        <NumberInput
          label="Gaver til forskning"
          value={input.researchDonations}
          onChange={(v) => setField("researchDonations", v)}
        />
        <NumberInput
          label="Øvrige fradrag"
          value={input.otherDeductions}
          onChange={(v) => setField("otherDeductions", v)}
        />
      </div>
    </div>
  )
}
