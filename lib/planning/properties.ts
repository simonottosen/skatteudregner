/**
 * The property list as the /planlaegning form works with it: the entries it
 * adds and removes, and the Danish it describes them in.
 *
 * Here rather than inside the form because `vitest.config.ts` collects only
 * `.ts` files — a rule written in a `.tsx` is a rule no test can reach. The form
 * keeps the inputs; everything that decides *what* to show lives here.
 */

import { DEFAULT_PROPERTY_LABEL, newId } from "./normalize"
import type { PlannedProperty, PropertyKind } from "./types"
import { formatDKK } from "@/lib/format"

/** What each kind is called in the form. */
export const PROPERTY_KIND_LABEL: Record<PropertyKind, string> = {
  helaarsbolig: "Helårsbolig",
  fritidsbolig: "Sommerhus",
}

export const PROPERTY_KINDS: PropertyKind[] = ["helaarsbolig", "fritidsbolig"]

/**
 * A blank entry for the form to fill in, owned from today and never sold.
 *
 * Zero kroner rather than a guessed value: an amount the user did not type is
 * one they would have to notice to correct, and a property worth nothing is
 * charged no tax in the meantime.
 */
export function newPlannedProperty(
  kind: PropertyKind,
  currentAge: number
): PlannedProperty {
  return {
    id: newId("prop"),
    label: DEFAULT_PROPERTY_LABEL[kind],
    kind,
    value: 0,
    landValue: 0,
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
 * The years a property is held, as the form says it.
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
  return property.disposalAge === null
    ? bought
    : `${bought} · sælges som ${property.disposalAge}-årig`
}

/** Value, grundværdi and ownership window on one line. */
export function propertySummary(
  property: PlannedProperty,
  currentAge: number
): string {
  return [
    PROPERTY_KIND_LABEL[property.kind],
    formatDKK(Math.round(property.value)),
    `grund ${formatDKK(Math.round(property.landValue))}`,
    ownershipSummary(property, currentAge),
  ].join(" · ")
}

/**
 * What the list understates, in the user's words — or null when it understates
 * nothing.
 *
 * Ejendomsskattelovens § 25 grants the pensionistnedslag per boligenhed, but to
 * the helårsbolig the pensioner lives in and the fritidsbolig they use: a second
 * of either kind has none to claim, and the projection taxes it in full. Worth
 * saying out loud, because a household that owns two flats would otherwise see a
 * number it cannot account for.
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
    "Pensionistnedslaget gives kun til én helårsbolig og ét sommerhus " +
    "(ejendomsskattelovens § 25). Øvrige boliger beskattes uden nedslag."
  )
}
