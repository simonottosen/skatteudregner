"use client"

import { useState } from "react"
import { Accordion, AccordionItem, InlineNotification } from "@carbon/react"
import { PdfUpload } from "./pdf-upload"
import { PAYSLIP_ASSUMED_FIELDS } from "@/lib/paycheck/to-tax-input"
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
  // Tracks the last import's document kind: a forskudsopgørelse fills the three
  // fields below, a payslip cannot, so the notice must clear when one follows
  // the other.
  const [payslipImported, setPayslipImported] = useState(false)

  return (
    <>
      <PdfUpload
        onImport={(data, kind) => {
          setPayslipImported(kind === "loenseddel")
          onImport(data)
        }}
      />
      <Accordion>
        <AccordionItem title="Personlige oplysninger" open>
          {payslipImported && (
            <InlineNotification
              className="mb-4 max-w-full"
              kind="info"
              lowContrast
              title="Tjek disse tre felter"
              subtitle={`${PAYSLIP_ASSUMED_FIELDS.join(", ")} står ikke på en lønseddel. Værdierne herunder er standardværdier — ikke noget vi har læst fra din PDF — og de påvirker skatten mærkbart.`}
              onCloseButtonClick={() => setPayslipImported(false)}
            />
          )}
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
