"use client"

import { useRef } from "react"
import { TextInput, Toggle } from "@carbon/react"
import { NumberInput } from "../number-input"
import { MunicipalitySelect } from "../municipality-select"
import type { SetTaxField, TaxInput } from "@/lib/tax/types"

interface PropertySectionProps {
  input: TaxInput
  setField: SetTaxField
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
        {/* Ejendomsskatteloven § 23, stk. 3 and § 25, stk. 3 let a længstlevende
            ægtefælle succeed to the nedslag on the dwelling they keep, so the
            form has to be able to say so per bolig rather than per person. */}
        <Toggle
          id={`${propertyKey}-retainedFromSpouse`}
          size="sm"
          hideLabel
          labelText="Bevaret efter ægtefælles død eller flytning på plejehjem"
          toggled={property.retainedFromSpouse ?? false}
          onToggle={(checked) =>
            setPropertyField(propertyKey, "retainedFromSpouse", checked)
          }
        />
      </div>
      {property.retainedFromSpouse && (
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs">
            Kræver, at boligen tilhørte ægtefællen, og at I ikke var separeret
            ved dødsfaldet eller flytningen.
          </p>
          <Toggle
            id={`${propertyKey}-spouseAcquiredBefore`}
            size="sm"
            hideLabel
            labelText="Ægtefællen købte boligen før 1. juli 1998"
            toggled={property.spouseAcquiredBefore19980701 ?? false}
            onToggle={(checked) =>
              setPropertyField(
                propertyKey,
                "spouseAcquiredBefore19980701",
                checked,
              )
            }
          />
        </div>
      )}
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
  setField,
  setPropertyField,
  toggleProperty,
}: PropertySectionProps) {
  const propertySwitchRef = useRef<HTMLDivElement>(null)
  const summerSwitchRef = useRef<HTMLDivElement>(null)

  // Remarriage belongs to the person, not to any one dwelling, but it only
  // changes an answer once something has been succeeded to, so it is asked here
  // rather than on the Personlige tab.
  const hasSuccession =
    !!input.property?.retainedFromSpouse ||
    !!input.summerHouse?.retainedFromSpouse

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

      {hasSuccession && (
        <div className="space-y-1">
          <TextInput
            id="remarriageDate"
            type="date"
            size="md"
            labelText="Dato for nyt ægteskab"
            value={input.remarriageDate ?? ""}
            onChange={(e) => setField("remarriageDate", e.target.value)}
          />
          {/* § 25, stk. 3, 3. pkt. ends the pensionistnedslag from and including
              the income year of the new marriage. §§ 23-24 carry no such clause,
              so those two nedslag are untouched. */}
          <p className="text-muted-foreground text-xs">
            Pensionistnedslaget bortfalder fra og med det indkomstår, hvor et nyt
            ægteskab indgås. Lad feltet stå tomt, hvis du ikke har giftet dig
            igen.
          </p>
        </div>
      )}
    </div>
  )
}
