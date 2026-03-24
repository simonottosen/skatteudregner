"use client"

import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MunicipalitySelect } from "../municipality-select"
import { NumberInput } from "../number-input"
import type { TaxInput, TaxYear } from "@/lib/tax/types"

interface PersonalInfoSectionProps {
  input: TaxInput
  setField: <K extends keyof TaxInput>(field: K, value: TaxInput[K]) => void
}

export function PersonalInfoSection({
  input,
  setField,
}: PersonalInfoSectionProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Indkomstår</Label>
          <Select
            value={String(input.year)}
            onValueChange={(v) => setField("year", Number(v) as TaxYear)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2024">2024</SelectItem>
              <SelectItem value="2025">2025</SelectItem>
              <SelectItem value="2026">2026</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Kommune</Label>
          <MunicipalitySelect
            value={input.municipality}
            onChange={(v) => setField("municipality", v)}
            year={input.year}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Fødselsdato</Label>
          <Input
            type="date"
            value={input.birthDate}
            onChange={(e) => setField("birthDate", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-3 pt-2">
          <div className="flex items-center gap-2">
            <Switch
              checked={input.churchMember}
              onCheckedChange={(v) => setField("churchMember", v)}
            />
            <Label className="text-xs">Medlem af folkekirken</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={input.married}
              onCheckedChange={(v) => setField("married", v)}
            />
            <Label className="text-xs">Gift</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={input.singleParent}
              onCheckedChange={(v) => setField("singleParent", v)}
            />
            <Label className="text-xs">Enlig forsørger</Label>
          </div>
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
