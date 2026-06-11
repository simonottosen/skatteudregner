"use client"

import { useRef } from "react"
import { Toggle } from "@carbon/react"
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
        <MunicipalitySelect
          value={(property as { municipality: string }).municipality}
          onChange={(v) => setPropertyField(propertyKey, "municipality", v)}
          year={year}
        />
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
      <div className="flex flex-wrap gap-6">
        <Toggle
          id={`${propertyKey}-purchasedBefore`}
          size="sm"
          hideLabel
          labelText="Købt før 1. juli 1998"
          toggled={property.purchasedBefore19980701}
          onToggle={(checked) =>
            setPropertyField(propertyKey, "purchasedBefore19980701", checked)
          }
        />
        <Toggle
          id={`${propertyKey}-isCondo`}
          size="sm"
          hideLabel
          labelText="Ejerlejlighed/fredet"
          toggled={property.isCondo}
          onToggle={(checked) =>
            setPropertyField(propertyKey, "isCondo", checked)
          }
        />
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
      <div ref={propertySwitchRef}>
        <Toggle
          id="enable-property"
          size="sm"
          hideLabel
          labelText="Helårsbolig"
          toggled={!!input.property}
          onToggle={(checked) => {
            toggleProperty("property", checked)
            if (checked) {
              setTimeout(() => {
                propertySwitchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }, 50)
            }
          }}
        />
      </div>
      {input.property && (
        <PropertyFields
          property={input.property}
          propertyKey="property"
          setPropertyField={setPropertyField}
          year={input.year}
        />
      )}

      <div ref={summerSwitchRef}>
        <Toggle
          id="enable-summerhouse"
          size="sm"
          hideLabel
          labelText="Sommerhus"
          toggled={!!input.summerHouse}
          onToggle={(checked) => {
            toggleProperty("summerHouse", checked)
            if (checked) {
              setTimeout(() => {
                summerSwitchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }, 50)
            }
          }}
        />
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
