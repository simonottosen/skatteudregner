"use client"

import { useState } from "react"
import {
  Button,
  Checkbox,
  Dropdown,
  InlineNotification,
  NumberInput,
  Tag,
  TextInput,
} from "@carbon/react"
import { Add, ChevronDown, ChevronUp, TrashCan } from "@carbon/icons-react"
import { MoneyInput, num } from "./money-input"
import {
  PROPERTY_KINDS,
  PROPERTY_KIND_LABEL,
  newPlannedProperty,
  pensionerNedslagNotice,
  propertySummary,
  removeProperty,
  replaceProperty,
} from "@/lib/planning/properties"
import type { PlannedProperty, PropertyKind } from "@/lib/planning/types"

/**
 * The household's properties: what each is worth, what its plot is worth, and
 * the years it is owned.
 *
 * Every entry is edited in place rather than in a modal. A property is four
 * numbers the user checks against each other — a value against a grundværdi, a
 * purchase age against a sale age — and a dialog would hide the rest of the list
 * exactly when it is being compared.
 */
export function PropertyList({
  properties,
  currentAge,
  endAge,
  onChange,
}: {
  properties: PlannedProperty[]
  currentAge: number
  endAge: number
  onChange: (next: PlannedProperty[]) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const notice = pensionerNedslagNotice(properties)

  const add = (kind: PropertyKind) => {
    const created = newPlannedProperty(kind, currentAge)
    onChange([...properties, created])
    setOpenId(created.id)
  }

  return (
    <div className="space-y-3">
      {properties.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Ingen boliger. Tilføj din bolig for at få ejendomsskat, friværdi og
          boligens værdistigning med i fremskrivningen.
        </p>
      ) : (
        <ul className="space-y-2">
          {properties.map((p, i) => {
            const open = openId === p.id
            const patch = (fields: Partial<PlannedProperty>) =>
              onChange(replaceProperty(properties, { ...p, ...fields }))
            return (
              <li key={p.id} className="border bg-muted/20">
                <div className="flex items-center gap-2 p-2">
                  {i === 0 && (
                    <Tag type="cool-gray" size="sm">
                      Bolig med lån
                    </Tag>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {p.label || "(uden navn)"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {propertySummary(p, currentAge)}
                    </p>
                  </div>
                  <Button
                    kind="ghost"
                    size="sm"
                    hasIconOnly
                    renderIcon={open ? ChevronUp : ChevronDown}
                    iconDescription={open ? "Skjul" : "Redigér"}
                    onClick={() => setOpenId(open ? null : p.id)}
                  />
                  <Button
                    kind="danger--ghost"
                    size="sm"
                    hasIconOnly
                    renderIcon={TrashCan}
                    iconDescription="Fjern"
                    onClick={() => onChange(removeProperty(properties, p.id))}
                  />
                </div>
                {open && (
                  <div className="grid grid-cols-1 gap-4 border-t p-3 sm:grid-cols-2">
                    <TextInput
                      id={`prop-label-${p.id}`}
                      labelText="Navn"
                      value={p.label}
                      onChange={(e) => patch({ label: e.target.value })}
                    />
                    <Dropdown
                      id={`prop-kind-${p.id}`}
                      titleText="Type"
                      label="Vælg type"
                      items={PROPERTY_KINDS}
                      selectedItem={p.kind}
                      itemToString={(k) => (k ? PROPERTY_KIND_LABEL[k] : "")}
                      onChange={({ selectedItem }) => {
                        if (selectedItem) patch({ kind: selectedItem })
                      }}
                    />
                    <MoneyInput
                      id={`prop-value-${p.id}`}
                      label="Boligværdi"
                      value={p.value}
                      onChange={(v) => patch({ value: v })}
                    />
                    <MoneyInput
                      id={`prop-land-${p.id}`}
                      label="Grundværdi (til grundskyld)"
                      value={p.landValue}
                      onChange={(v) => patch({ landValue: v })}
                    />
                    <NumberInput
                      id={`prop-buy-${p.id}`}
                      label="Købsalder"
                      helperText="Din alder ved købet. Er den i dag eller tidligere, ejes boligen allerede."
                      min={0}
                      max={endAge}
                      value={p.acquisitionAge}
                      onChange={(_e, { value }) =>
                        patch({
                          acquisitionAge: num(value ?? 0, p.acquisitionAge),
                        })
                      }
                    />
                    <div className="space-y-2">
                      <Checkbox
                        id={`prop-sell-toggle-${p.id}`}
                        labelText="Boligen sælges undervejs"
                        checked={p.disposalAge !== null}
                        onChange={(_e, { checked }) =>
                          patch({
                            disposalAge: checked
                              ? Math.max(p.acquisitionAge + 1, currentAge + 1)
                              : null,
                          })
                        }
                      />
                      {p.disposalAge !== null && (
                        <NumberInput
                          id={`prop-sell-${p.id}`}
                          label="Salgsalder"
                          helperText="Første år uden boligen — der betales ikke ejendomsskat af den fra og med det år."
                          min={p.acquisitionAge}
                          max={endAge}
                          value={p.disposalAge}
                          onChange={(_e, { value }) =>
                            patch({
                              disposalAge: num(value ?? 0, p.disposalAge ?? 0),
                            })
                          }
                        />
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {notice && (
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title="Pensionistnedslag"
          subtitle={notice}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          kind="tertiary"
          size="sm"
          renderIcon={Add}
          onClick={() => add("helaarsbolig")}
        >
          Tilføj bolig
        </Button>
        <Button
          kind="ghost"
          size="sm"
          renderIcon={Add}
          onClick={() => add("fritidsbolig")}
        >
          Tilføj sommerhus
        </Button>
      </div>
    </div>
  )
}
