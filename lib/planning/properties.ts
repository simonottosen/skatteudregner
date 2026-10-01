/**
 * The property list as the /planlaegning form works with it: the entries it
 * adds and removes, and the Danish it describes them in.
 *
 * Here rather than inside the form because `vitest.config.ts` collects only
 * `.ts` files — a rule written in a `.tsx` is a rule no test can reach. The form
 * keeps the inputs; everything that decides *what* to show lives here.
 */

import { DEFAULT_PROPERTY_LABEL, clampNum, newId } from "./normalize"
import type { PlannedProperty, PropertyKind, PropertyUse } from "./types"
import { formatDKK, formatPercent } from "@/lib/format"

/** What each kind is called in the form. */
export const PROPERTY_KIND_LABEL: Record<PropertyKind, string> = {
  helaarsbolig: "Helårsbolig",
  fritidsbolig: "Sommerhus",
}

export const PROPERTY_KINDS: PropertyKind[] = ["helaarsbolig", "fritidsbolig"]

/** What each use is called in the form. */
export const PROPERTY_USE_LABEL: Record<PropertyUse, string> = {
  own: "Egen brug",
  vacant: "Står tom",
  rented: "Udlejet",
}

export const PROPERTY_USES: PropertyUse[] = ["own", "vacant", "rented"]

/**
 * Most of a property a sale may cost, as a share of the price.
 *
 * Far above any real sale — Danish ejendomsmægler, advokat and tingbogsafgift
 * together land in the low single digits — because the bound is here to stop a
 * typed-in percentage from handing the household nothing, or less than nothing,
 * for the house it sold, not to tell it what a sale costs.
 */
const MAX_SALE_COSTS_PCT = 0.2

/**
 * A sale-cost share held inside what a sale can cost, and defaulted to the free
 * sale {@link PlannedProperty.saleCostsPct} describes when it is no figure at
 * all.
 *
 * One function for the form and the normalizer both, the way
 * `maxInterestOnlyYears` (`./loans`) is one bound for the loan's afdragsfrihed.
 * The form writes straight into the plan, so a bound only the normalizer
 * applied would let the live projection credit the household extra proceeds on
 * a negative share, or deduct half the house on 50 — and then quietly change
 * the figure to the bound on the next reload, so that the two projections of
 * one saved plan disagree.
 */
export function clampSaleCostsPct(value: unknown): number {
  return clampNum(value, 0, 0, MAX_SALE_COSTS_PCT)
}

/**
 * What the sale-cost field asks for.
 *
 * Here rather than in the form for the reason given at the top of this module:
 * a full Danish sentence is copy, and copy a test can reach is copy that cannot
 * drift from what the field does. The typical range is named because the bound
 * is not a hint — 20 % would pass and ruin the projection — so the sentence has
 * to be where the user looks for the figure.
 */
export const SALE_COSTS_HELPER_TEXT =
  "Mægler, advokat og tinglysning i procent af salgsprisen. Typisk 2–4 %."

/**
 * A blank entry for the form to fill in, owned from today and never sold.
 *
 * Zero kroner rather than a guessed value: an amount the user did not type is
 * one they would have to notice to correct, and a property worth nothing is
 * charged no tax in the meantime. Owner-occupied for the same reason: it is the
 * one use the projection models, so an entry left alone carries no assumption.
 */
export function newPlannedProperty(
  kind: PropertyKind,
  currentAge: number
): PlannedProperty {
  return {
    id: newId("prop"),
    label: DEFAULT_PROPERTY_LABEL[kind],
    kind,
    use: "own",
    value: 0,
    landValue: 0,
    // A sale that costs nothing, which the form then asks about — see
    // {@link PlannedProperty.saleCostsPct} for why the default is not a
    // realistic figure.
    saleCostsPct: 0,
    acquisitionAge: Math.max(0, Math.round(currentAge)),
    disposalAge: null,
  }
}

/** Replace the entry with `next.id`, or leave the list alone if it is gone. */
export function replaceProperty(
  list: readonly PlannedProperty[],
  next: PlannedProperty
): PlannedProperty[] {
  return list.map((p) => (p.id === next.id ? next : p))
}

export function removeProperty(
  list: readonly PlannedProperty[],
  id: string
): PlannedProperty[] {
  return list.filter((p) => p.id !== id)
}

/**
 * The years a property is held — and what letting go of it costs — as the form
 * says it.
 *
 * Ownership is the half-open interval the simulation reads it as — held from
 * `acquisitionAge`, gone in the year of `disposalAge` — so "sælges som 70-årig"
 * means the 70th year is the first untaxed one, not the last taxed one.
 */
export function ownershipSummary(
  property: PlannedProperty,
  currentAge: number
): string {
  const bought =
    property.acquisitionAge <= currentAge
      ? "Ejes i dag"
      : `Købes som ${property.acquisitionAge}-årig`
  if (property.disposalAge === null) return bought
  // Sale costs are named only when there are any, and only on a property that is
  // sold. The field defaults to zero — see {@link PlannedProperty.saleCostsPct} —
  // so "0,00% i salgsomkostninger" would appear on every row that has a sale age
  // and tell the user nothing, while the one row that *was* given a figure is the
  // one worth seeing without opening it.
  const sale = `sælges som ${property.disposalAge}-årig`
  return property.saleCostsPct > 0
    ? `${bought} · ${sale} · ${formatPercent(property.saleCostsPct)} i salgsomkostninger`
    : `${bought} · ${sale}`
}

/**
 * Value, grundværdi and ownership window on one line.
 *
 * The use is named only when it is not `"own"`: it is the default on every
 * entry, so spelling out "Egen brug" on each row would bury the one row that
 * says something the projection does not model.
 */
export function propertySummary(
  property: PlannedProperty,
  currentAge: number
): string {
  return [
    PROPERTY_KIND_LABEL[property.kind],
    ...(property.use === "own" ? [] : [PROPERTY_USE_LABEL[property.use]]),
    formatDKK(Math.round(property.value)),
    `grund ${formatDKK(Math.round(property.landValue))}`,
    ownershipSummary(property, currentAge),
  ].join(" · ")
}

/**
 * What the projection understates, in the user's words — or null when it
 * understates nothing.
 *
 * The one-per-kind limit is this projection's, not the law's: ejendomsskattelovens
 * § 25 grants the pensionistnedslag per boligenhed and caps no household at one
 * of each. The tax engine is handed a single helårsbolig and a single
 * fritidsbolig (`input.property` / `input.summerHouse`), so a second of either
 * kind is taxed with no nedslag and the ejendomsskat comes out too high. Say so
 * as our limitation — a household that owns two flats would otherwise read a
 * charge it cannot account for as the law's doing.
 */
export function pensionerNedslagNotice(
  properties: readonly PlannedProperty[]
): string | null {
  let homes = 0
  let summers = 0
  for (const p of properties) {
    if (p.kind === "fritidsbolig") summers++
    else homes++
  }
  if (homes <= 1 && summers <= 1) return null
  return (
    "Beregningen giver kun pensionistnedslag til én helårsbolig og ét " +
    "sommerhus. Øvrige boliger beskattes uden nedslag, så den beregnede " +
    "ejendomsskat er sat lidt for højt."
  )
}

/**
 * What the projection understates about a let-out property, in the user's
 * words — or null when nothing is let out.
 *
 * All three omissions get named, because naming only the income would read as
 * if the projection were merely being conservative. It is not: rent in against
 * costs and tax out can land either way, so there is no "too high" or "too low"
 * to promise here — unlike {@link pensionerNedslagNotice}, which knows its
 * error has a sign. Why none of it is modelled is {@link PropertyUse}'s to
 * explain.
 */
export function rentalExclusionNotice(
  properties: readonly PlannedProperty[]
): string | null {
  if (!properties.some((p) => p.use === "rented")) return null
  return (
    "Beregningen regner ikke på udlejning. Hverken lejeindtægt, " +
    "driftsudgifter eller skat af overskuddet indgår i fremskrivningen, så " +
    "udlejede boliger tæller kun med deres værdi og deres ejendomsskat."
  )
}
