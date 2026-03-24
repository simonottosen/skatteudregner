"use client"

import { useRef } from "react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { NumberInput } from "../number-input"
import { MunicipalitySelect } from "../municipality-select"
import type { TaxInput } from "@/lib/tax/types"

interface PropertySectionProps {
  input: TaxInput
  setField: <K extends keyof TaxInput>(field: K, value: TaxInput[K]) => void
  setPropertyField: (
    property: "property" | "summerHouse",
    field: string,
    value: unknown,
  ) => void
  toggleProperty: (
    property: "property" | "summerHouse",
    enabled: boolean,
  ) => void
}

function PropertyFields({
  property,
  propertyKey,
  setPropertyField,
  year,
  showMunicipality,
}: {
  property: NonNullable<TaxInput["property"]>
  propertyKey: "property" | "summerHouse"
  setPropertyField: PropertySectionProps["setPropertyField"]
  year: TaxInput["year"]
  showMunicipality?: boolean
}) {
  return (
    <div className="space-y-3">
      {showMunicipality && "municipality" in property && (
        <div className="space-y-1">
          <Label className="text-xs">Kommune (sommerhus)</Label>
          <MunicipalitySelect
            value={(property as { municipality: string }).municipality}
            onChange={(v) =>
              setPropertyField(propertyKey, "municipality", v)
            }
            year={year}
          />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberInput
          label="Ejendomsværdi (beskatningsgrundlag)"
          value={property.assessmentBasis}
          onChange={(v) =>
            setPropertyField(propertyKey, "assessmentBasis", v)
          }
        />
        <NumberInput
          label="Grundværdi (beskatningsgrundlag)"
          value={property.landAssessmentBasis}
          onChange={(v) =>
            setPropertyField(propertyKey, "landAssessmentBasis", v)
          }
        />
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <Switch
            checked={property.purchasedBefore19980701}
            onCheckedChange={(v) =>
              setPropertyField(propertyKey, "purchasedBefore19980701", v)
            }
          />
          <Label className="text-xs">Købt før 1. juli 1998</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={property.isCondo}
            onCheckedChange={(v) =>
              setPropertyField(propertyKey, "isCondo", v)
            }
          />
          <Label className="text-xs">Ejerlejlighed/fredet</Label>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberInput
          label="Ejerandel"
          value={property.ownershipShare * 100}
          onChange={(v) =>
            setPropertyField(propertyKey, "ownershipShare", v / 100)
          }
          suffix="%"
          max={100}
        />
        <NumberInput
          label="Personlig skatterabat"
          value={property.personalTaxDiscount}
          onChange={(v) =>
            setPropertyField(propertyKey, "personalTaxDiscount", v)
          }
        />
      </div>
    </div>
  )
}

export function PropertySection({
  input,
  setPropertyField,
  toggleProperty,
}: PropertySectionProps) {
  const propertySwitchRef = useRef<HTMLDivElement>(null)
  const summerSwitchRef = useRef<HTMLDivElement>(null)

  return (
    <div className="space-y-4">
      <div ref={propertySwitchRef} className="flex items-center gap-2">
        <Switch
          checked={!!input.property}
          onCheckedChange={(v) => {
            toggleProperty("property", v)
            if (v) {
              setTimeout(() => {
                propertySwitchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }, 50)
            }
          }}
        />
        <Label className="text-sm font-medium">Helårsbolig</Label>
      </div>
      {input.property && (
        <PropertyFields
          property={input.property}
          propertyKey="property"
          setPropertyField={setPropertyField}
          year={input.year}
        />
      )}

      <div ref={summerSwitchRef} className="flex items-center gap-2">
        <Switch
          checked={!!input.summerHouse}
          onCheckedChange={(v) => {
            toggleProperty("summerHouse", v)
            if (v) {
              setTimeout(() => {
                summerSwitchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }, 50)
            }
          }}
        />
        <Label className="text-sm font-medium">Sommerhus</Label>
      </div>
      {input.summerHouse && (
        <PropertyFields
          property={input.summerHouse}
          propertyKey="summerHouse"
          setPropertyField={setPropertyField}
          year={input.year}
          showMunicipality
        />
      )}
    </div>
  )
}
