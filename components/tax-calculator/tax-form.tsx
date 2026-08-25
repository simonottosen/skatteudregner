"use client"

import { Accordion, AccordionItem, InlineNotification } from "@carbon/react"
import { PdfUpload } from "./pdf-upload"
import {
  assumptionNotice,
  type DocumentKind,
  type TaxProvenance,
} from "@/lib/tax/provenance"
import { PersonalInfoSection } from "./sections/personal-info-section"
import { IncomeSection } from "./sections/income-section"
import { DeductionsSection } from "./sections/deductions-section"
import { CapitalIncomeSection } from "./sections/capital-income-section"
import { StockIncomeSection } from "./sections/stock-income-section"
import { PropertySection } from "./sections/property-section"
import type { PropertyInput, SetTaxField, TaxInput } from "@/lib/tax/types"

interface TaxFormProps {
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
  onImport: (
    data: Omit<Partial<TaxInput>, "property" | "summerHouse"> & { property?: Partial<PropertyInput> },
    kind: DocumentKind,
  ) => void
  /**
   * Which of `input`'s values came from a document. Owned per person rather than
   * by this component: one `TaxForm` instance serves both persons, so local
   * state would follow the form and describe person 1 while showing person 2.
   */
  provenance: TaxProvenance
  dismissImportNotice: () => void
}

export function TaxForm({
  input,
  setField,
  setPropertyField,
  toggleProperty,
  onImport,
  provenance,
  dismissImportNotice,
}: TaxFormProps) {
  const notice = assumptionNotice(provenance)

  return (
    <>
      <PdfUpload onImport={onImport} />
      <Accordion>
        <AccordionItem title="Personlige oplysninger" open>
          {notice && (
            <InlineNotification
              className="mb-4 max-w-full"
              kind="info"
              lowContrast
              title={notice.title}
              subtitle={notice.subtitle}
              onCloseButtonClick={dismissImportNotice}
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
