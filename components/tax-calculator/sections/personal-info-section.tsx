"use client"

import { useId } from "react"
import { Select, SelectItem, Toggle, TextInput } from "@carbon/react"
import { MunicipalitySelect } from "../municipality-select"
import { NumberInput } from "../number-input"
import type { SetTaxField, TaxInput, TaxYear } from "@/lib/tax/types"

interface PersonalInfoSectionProps {
  input: TaxInput
  setField: SetTaxField
}

export function PersonalInfoSection({
  input,
  setField,
}: PersonalInfoSectionProps) {
  const yearId = useId()
  const birthId = useId()

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Select
          id={yearId}
          labelText="Indkomstår"
          size="md"
          value={String(input.year)}
          onChange={(e) => setField("year", Number(e.target.value) as TaxYear)}
        >
          <SelectItem value="2024" text="2024" />
          <SelectItem value="2025" text="2025" />
          <SelectItem value="2026" text="2026" />
        </Select>
        <MunicipalitySelect
          value={input.municipality}
          onChange={(v) => setField("municipality", v)}
          year={input.year}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <TextInput
          id={birthId}
          type="date"
          size="md"
          labelText="Fødselsdato"
          value={input.birthDate}
          onChange={(e) => setField("birthDate", e.target.value)}
        />
        <div className="flex flex-col gap-3 pt-6">
          <Toggle
            id="churchMember"
            size="sm"
            hideLabel
            labelText="Medlem af folkekirken"
            toggled={input.churchMember}
            onToggle={(checked) => setField("churchMember", checked)}
          />
          <Toggle
            id="married"
            size="sm"
            hideLabel
            labelText="Gift"
            toggled={input.married}
            onToggle={(checked) => setField("married", checked)}
          />
          <Toggle
            id="singleParent"
            size="sm"
            hideLabel
            labelText="Enlig forsørger"
            toggled={input.singleParent}
            onToggle={(checked) => setField("singleParent", checked)}
          />
        </div>
      </div>

      {input.married && (
        <div className="grid grid-cols-2 gap-4">
          <NumberInput
            label="Ægtefælles personlige indkomst"
            value={input.spousePersonalIncome ?? 0}
            onChange={(v) => setField("spousePersonalIncome", v)}
          />
          <NumberInput
            label="Ægtefælles aktieindkomst"
            value={input.spouseStockIncome ?? 0}
            onChange={(v) => setField("spouseStockIncome", v)}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <NumberInput
          label="Børn under 18 år"
          value={input.childrenUnder18}
          onChange={(v) => setField("childrenUnder18", v)}
          suffix="stk."
        />
        <NumberInput
          label="Km til arbejde (tur/retur)"
          value={input.commuteDistanceKm}
          onChange={(v) => setField("commuteDistanceKm", v)}
          suffix="km"
        />
      </div>

      <NumberInput
        label="Arbejdsdage om året"
        value={input.workDaysPerYear}
        onChange={(v) => setField("workDaysPerYear", v)}
        suffix="dage"
        max={365}
      />
    </div>
  )
}
