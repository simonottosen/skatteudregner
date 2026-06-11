"use client"

import { useId, useMemo } from "react"
import { ComboBox } from "@carbon/react"
import { getMunicipalityList } from "@/lib/tax/municipalities"
import type { TaxYear } from "@/lib/tax/types"

interface MunicipalitySelectProps {
  value: string
  onChange: (value: string) => void
  year: TaxYear
}

interface MunicipalityItem {
  id: number
  name: string
  taxRate: number
}

export function MunicipalitySelect({
  value,
  onChange,
  year,
}: MunicipalitySelectProps) {
  const id = useId()

  const items = useMemo<MunicipalityItem[]>(
    () =>
      getMunicipalityList(year)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "da"))
        .map((m) => ({ id: m.code, name: m.name, taxRate: m.taxRate })),
    [year]
  )

  const selectedItem = items.find((m) => m.name === value) ?? null

  return (
    <ComboBox
      id={id}
      titleText="Kommune"
      placeholder="Vælg kommune..."
      items={items}
      selectedItem={selectedItem}
      itemToString={(item) =>
        item ? `${item.name} (${item.taxRate}%)` : ""
      }
      onChange={({ selectedItem }) => {
        if (selectedItem) onChange(selectedItem.name)
      }}
      size="md"
    />
  )
}
