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
import { MoneyInput, PercentField, num } from "./money-input"
import {
  DEFAULT_LTV,
  FINANCING_HELPER_TEXT,
  HOUSING_RETURN_HELPER_TEXT,
  PROPERTY_KINDS,
  PROPERTY_KIND_LABEL,
  PROPERTY_USES,
  PROPERTY_USE_LABEL,
  SALE_COSTS_HELPER_TEXT,
  clampHousingReturn,
  clampLtv,
  clampSaleCostsPct,
  newPlannedProperty,
  offersFinancing,
  pensionerNedslagNotice,
  propertySummary,
  removeProperty,
  rentalExclusionNotice,
  replaceProperty,
  withAcquisitionAge,
} from "@/lib/planning/properties"
import type { PlannedProperty, PropertyKind } from "@/lib/planning/types"

/**
 * The household's properties: what each is worth, what its plot is worth, the
 * years it is owned, how a future purchase is paid for and what it is expected
 * to appreciate by.
 *
 * The whole of the household's housing plan, moves included: selling up and
 * buying elsewhere is one entry given a salgsalder and a second one bought the
 * same year, which is also how a plan says "keep both" (issue #9).
 *
 * Every entry is edited in place rather than in a modal. A property is a handful
 * of numbers the user checks against each other — a value against a grundværdi,
 * a purchase age against a sale age — and a dialog would hide the rest of the
 * list exactly when it is being compared.
 */
export function PropertyList({
  properties,
  currentAge,
  endAge,
  housingReturn,
  onChange,
}: {
  properties: PlannedProperty[]
  currentAge: number
  endAge: number
  /** The plan's own appreciation, which a per-property rate starts out at. */
  housingReturn: number
  onChange: (next: PlannedProperty[]) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const notice = pensionerNedslagNotice(properties)
  const rentalNotice = rentalExclusionNotice(properties)

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
            // Read out here rather than off `p` in the onChange handlers below:
            // both fields render behind a `!== null` guard, but TypeScript will
            // not carry that narrowing into a callback, and the handlers pass
            // them to a clamp that takes `number`.
            //
            // `ownReturn` is renamed and not merely destructured: `housingReturn`
            // is also the prop holding the *plan's* rate, read below to seed the
            // checkbox. Destructuring under its own name would shadow it and
            // seed every row with its own rate instead of the plan's.
            const { financing, housingReturn: ownReturn } = p
            return (
              <li key={p.id} className="border bg-muted/20">
                <div className="flex items-center gap-2 p-2">
                  {/* Not "Bolig med lån" any more: each loan names the property
                      that secures it, and selling that property is what settles
                      it. What is still true of the first entry alone is that a
                      lån uden pant lands on it. */}
                  {i === 0 && (
                    <Tag type="cool-gray" size="sm">
                      Primær bolig
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
                    <Dropdown
                      id={`prop-use-${p.id}`}
                      titleText="Anvendelse"
                      label="Vælg anvendelse"
                      items={PROPERTY_USES}
                      selectedItem={p.use}
                      itemToString={(u) => (u ? PROPERTY_USE_LABEL[u] : "")}
                      onChange={({ selectedItem }) => {
                        if (selectedItem) patch({ use: selectedItem })
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
                    <div className="space-y-2">
                      <NumberInput
                        id={`prop-buy-${p.id}`}
                        label="Købsalder"
                        helperText="Din alder ved købet. Er den i dag eller tidligere, ejes boligen allerede."
                        min={0}
                        max={endAge}
                        value={p.acquisitionAge}
                        // Not a bare `{ acquisitionAge }`: moving the age back
                        // to today ends the purchase, and the belåningsgrad has
                        // to go with it — see {@link withAcquisitionAge}.
                        onChange={(_e, { value }) =>
                          patch(
                            withAcquisitionAge(
                              p,
                              num(value ?? 0, p.acquisitionAge),
                              currentAge
                            )
                          )
                        }
                      />
                      {/* Only on a purchase the fremskrivning actually makes:
                          an already-owned home's debt is a lån with its own
                          terms, not an LTV. */}
                      {offersFinancing(p, currentAge) && (
                        <>
                          <Checkbox
                            id={`prop-finance-toggle-${p.id}`}
                            labelText="Købet finansieres med lån"
                            checked={financing !== null}
                            onChange={(_e, { checked }) =>
                              patch({
                                financing: checked
                                  ? { ltv: DEFAULT_LTV }
                                  : null,
                              })
                            }
                          />
                          {financing !== null && (
                            <PercentField
                              id={`prop-ltv-${p.id}`}
                              label="Belåningsgrad"
                              helperText={FINANCING_HELPER_TEXT}
                              value={financing.ltv}
                              // Bounded where it is typed, like the sale costs
                              // below: this writes straight into the plan the
                              // projection reads. Falling back to the row's own
                              // share rather than to DEFAULT_LTV, for the
                              // reason clampSaleCostsPct sets out.
                              onChange={(v) =>
                                patch({
                                  financing: { ltv: clampLtv(v, financing.ltv) },
                                })
                              }
                            />
                          )}
                        </>
                      )}
                    </div>
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
                      {/* Shown with the sale age and not above it: a household
                          that never sells has nothing to pay an agent for, and
                          the field would otherwise ask every entry for a figure
                          that changes nothing. */}
                      {p.disposalAge !== null && (
                        <PercentField
                          id={`prop-sale-costs-${p.id}`}
                          label="Salgsomkostninger"
                          helperText={SALE_COSTS_HELPER_TEXT}
                          value={p.saleCostsPct}
                          // Bounded here and not only on reload: this writes
                          // straight into the plan the projection reads — see
                          // {@link clampSaleCostsPct} for what an unbounded
                          // share does to it, and for why the row's own figure
                          // is the fallback rather than the shared default.
                          onChange={(v) =>
                            patch({
                              saleCostsPct: clampSaleCostsPct(v, p.saleCostsPct),
                            })
                          }
                        />
                      )}
                    </div>
                    {/* Offered on every entry and not only on a purchase: a
                        sommerhus på Mors and a lejlighed i København do not
                        appreciate alike whether or not either was bought
                        today. */}
                    <div className="space-y-2">
                      <Checkbox
                        id={`prop-return-toggle-${p.id}`}
                        labelText="Eget forventet afkast"
                        checked={ownReturn !== null}
                        onChange={(_e, { checked }) =>
                          patch({
                            housingReturn: checked ? housingReturn : null,
                          })
                        }
                      />
                      {ownReturn !== null && (
                        <PercentField
                          id={`prop-return-${p.id}`}
                          label="Værdistigning pr. år"
                          helperText={HOUSING_RETURN_HELPER_TEXT}
                          value={ownReturn}
                          // Bounded here like the two fields above it, and
                          // falling back to the row's own rate rather than to
                          // the 0 this clamp used to bake in — on this field 0
                          // is a rate a household might mean, so being handed
                          // it is worse than on either share above.
                          onChange={(v) =>
                            patch({
                              housingReturn: clampHousingReturn(v, ownReturn),
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
      {rentalNotice && (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title="Udlejning er ikke med i beregningen"
          subtitle={rentalNotice}
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
