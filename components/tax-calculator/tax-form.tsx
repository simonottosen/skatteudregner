"use client"

import { Accordion, AccordionItem } from "@carbon/react"
import { PdfUpload } from "./pdf-upload"
import { PersonalInfoSection } from "./sections/personal-info-section"
import { IncomeSection } from "./sections/income-section"
import { DeductionsSection } from "./sections/deductions-section"
import { CapitalIncomeSection } from "./sections/capital-income-section"
import { StockIncomeSection } from "./sections/stock-income-section"
import { PropertySection } from "./sections/property-section"
import type { TaxInput, PropertyInput } from "@/lib/tax/types"

interface TaxFormProps {
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
  onImport: (data: Omit<Partial<TaxInput>, "property" | "summerHouse"> & { property?: Partial<PropertyInput> }) => void
}

export function TaxForm({
  input,
  setField,
  setPropertyField,
  toggleProperty,
  onImport,
}: TaxFormProps) {
  return (
    <>
      <PdfUpload onImport={onImport} />
      <Accordion>
        <AccordionItem title="Personlige oplysninger" open>
          <PersonalInfoSection input={input} setField={setField} />
        </AccordionItem>

        <AccordionItem title="Indkomst" open>
          <IncomeSection input={input} setField={setField} />
        </AccordionItem>

        <AccordionItem title="Pension og fradrag">
          <DeductionsSection input={input} setField={setField} />
        </AccordionItem>

        <AccordionItem title="Kapitalindkomst">
          <CapitalIncomeSection input={input} setField={setField} />
        </AccordionItem>

        <AccordionItem title="Aktieindkomst">
          <StockIncomeSection input={input} setField={setField} />
        </AccordionItem>

        <AccordionItem title="Bolig">
          <PropertySection
            input={input}
            setField={setField}
            setPropertyField={setPropertyField}
            toggleProperty={toggleProperty}
          />
        </AccordionItem>
      </Accordion>
    </>
  )
}
