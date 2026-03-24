"use client"

import { useCallback } from "react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
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
  const scrollIntoView = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const trigger = e.currentTarget
    const isExpanding = trigger.getAttribute("data-state") === "closed"
    if (isExpanding) {
      setTimeout(() => {
        trigger.scrollIntoView({ behavior: "smooth", block: "start" })
      }, 150)
    }
  }, [])

  return (
    <>
    <PdfUpload onImport={onImport} />
    <Accordion
      type="multiple"
      defaultValue={["personal", "income"]}
      className="w-full"
    >
      <AccordionItem value="personal">
        <AccordionTrigger className="text-sm font-medium" onClick={scrollIntoView}>
          Personlige oplysninger
        </AccordionTrigger>
        <AccordionContent>
          <PersonalInfoSection input={input} setField={setField} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="income">
        <AccordionTrigger className="text-sm font-medium" onClick={scrollIntoView}>
          Indkomst
        </AccordionTrigger>
        <AccordionContent>
          <IncomeSection input={input} setField={setField} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="deductions">
        <AccordionTrigger className="text-sm font-medium" onClick={scrollIntoView}>
          Pension og fradrag
        </AccordionTrigger>
        <AccordionContent>
          <DeductionsSection input={input} setField={setField} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="capital">
        <AccordionTrigger className="text-sm font-medium" onClick={scrollIntoView}>
          Kapitalindkomst
        </AccordionTrigger>
        <AccordionContent>
          <CapitalIncomeSection input={input} setField={setField} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="stocks">
        <AccordionTrigger className="text-sm font-medium" onClick={scrollIntoView}>
          Aktieindkomst
        </AccordionTrigger>
        <AccordionContent>
          <StockIncomeSection input={input} setField={setField} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="property">
        <AccordionTrigger className="text-sm font-medium" onClick={scrollIntoView}>
          Bolig
        </AccordionTrigger>
        <AccordionContent>
          <PropertySection
            input={input}
            setField={setField}
            setPropertyField={setPropertyField}
            toggleProperty={toggleProperty}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
    </>
  )
}
