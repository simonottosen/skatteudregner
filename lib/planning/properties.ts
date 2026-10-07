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
 * What a sale costs when the plan does not say — 3 %.
 *
 * Bolius puts the average ejendomsmægler fee at about 85.000 kr., which on a
 * 3 mio. kr. bolig is 2,8 %, and the trade press puts the whole of a sale in the
 * 2–4 % range. So this is the middle of what a Danish sale observably costs,
 * the way {@link DEFAULT_LTV} is the most a household can be lent rather than a
 * guess at what it borrows.
 *
 * It is a share and not a kroner figure because the fee is partly fixed, which
 * makes the percentage fall as the price rises: nearer 3 % on a 3 mio. kr. hus
 * and nearer 2 % on a 6 mio. kr. one. A household at either end should type its
 * own — {@link SALE_COSTS_HELPER_TEXT} names the range for exactly that reason,
 * and named it for some time before the engine agreed with it.
 */
export const DEFAULT_SALE_COSTS_PCT = 0.03

/**
 * A sale-cost share held inside what a sale can cost.
 *
 * One bound for the form and the normalizer both, the way
 * `maxInterestOnlyYears` (`./loans`) is one bound for the loan's afdragsfrihed.
 * The form writes straight into the plan, so a bound only the normalizer
 * applied would let the live projection credit the household extra proceeds on
 * a negative share, or deduct half the house on 50 — and then quietly change
 * the figure to the bound on the next reload, so that the two projections of
 * one saved plan disagree.
 *
 * The fallback is the caller's, for the reason `clampLoanRate` (`./loans`)
 * gives: the two callers are not asking the same question. The normalizer is
 * reading a blob that may hold no figure at all and answers with
 * {@link DEFAULT_SALE_COSTS_PCT}; the form is bounding a figure the row already
 * carries, and Carbon's `NumberInput` reports a half-typed field as something
 * that is not a number — so a shared fallback would jump the input to 3 % in
 * the middle of typing a 4.
 */
export function clampSaleCostsPct(value: unknown, fallback: number): number {
  return clampNum(value, fallback, 0, MAX_SALE_COSTS_PCT)
}

/**
 * The loan-to-value the form offers on a new property, and what a plan saved
 * with no figure of its own is read as once it has one at all. 80 % is the
 * realkreditlovens limit for a helårsbolig (lov om realkreditlån § 5), so it is
 * the most a household can expect to be lent rather than a guess at what it will
 * borrow.
 */
export const DEFAULT_LTV = 0.8

/**
 * A loan-to-value held inside what can be borrowed against a house.
 *
 * Bounded at 1 rather than at the 80 % the law allows: a household can carry a
 * boligkredit or a seller's loan on top of the realkreditlån, and the projection
 * models what the plan says is owed rather than policing how it was raised.
 * Above 1 it would hand the household a house and change besides, and below 0 it
 * would pay the household for buying one — see `financedPrincipal` in
 * `./simulate`, which holds the same bound for a state it did not normalize.
 *
 * One function for the form and the normalizer both, like
 * {@link clampSaleCostsPct} above and for the same reason — but not the same
 * shape: only the bound is shared there, because its default is a figure a
 * household would be startled to be given mid-keystroke. This one still
 * defaults in the function, so clearing the belåningsgrad to retype it snaps
 * the field to 80 % on the way. Same defect, left alone here because changing
 * it changes what the form does rather than what a saved plan means.
 */
export function clampLtv(value: unknown): number {
  return clampNum(value, DEFAULT_LTV, 0, 1)
}

/**
 * A per-property appreciation held to a share a projection can survive.
 *
 * Below −1 the house would be worth less than nothing after a single year, and
 * above 1 it doubles every year until it is the whole of the household's net
 * worth — in both cases the fremskrivning stops saying anything about the plan.
 * Defaulted to 0 rather than to the plan's own rate, because an entry that
 * states a rate at all has opted out of the plan's: `null` is how it follows it.
 *
 * One function for the form and the normalizer both, like {@link clampLtv}
 * above — and defaulting in the function as it does, with the same snap on a
 * half-typed field that {@link clampSaleCostsPct} takes a caller's fallback to
 * avoid.
 */
export function clampHousingReturn(value: unknown): number {
  return clampNum(value, 0, -1, 1)
}

/**
 * Whether the form offers to finance this entry.
 *
 * Only a purchase the projection carries out, which is one dated strictly after
 * today: an entry acquired at or before `currentAge` is part of the opening
 * position, so there is no purchase to borrow for and whatever is owed on it is
 * a {@link PlannedLoan} stating the real terms. Offering an LTV there would
 * invent a second mortgage beside it — see {@link PlannedProperty.financing}.
 */
export function offersFinancing(
  property: Pick<PlannedProperty, "acquisitionAge">,
  currentAge: number
): boolean {
  return property.acquisitionAge > currentAge
}

/**
 * An entry's acquisition age, with financing it can no longer carry taken off.
 *
 * Moving the age back to today or earlier turns the purchase into part of the
 * opening position, and a leftover LTV would then sit on the entry unread —
 * inert while it is there, and silently back in force the moment the age is
 * pushed out again. The form shows what the plan says, so the plan has to stop
 * saying it.
 */
export function withAcquisitionAge(
  property: PlannedProperty,
  acquisitionAge: number,
  currentAge: number
): PlannedProperty {
  const next = { ...property, acquisitionAge }
  return offersFinancing(next, currentAge) ? next : { ...next, financing: null }
}

/** What the belåningsgrad field asks for. */
export const FINANCING_HELPER_TEXT =
  "Andel af købsprisen der lånes. Resten betales af opsparingen i købsåret. " +
  "Lånet får samme rente, bidragssats og afdragsfrihed som det største " +
  "realkreditlån, det afløser."

/** What the per-property return field asks for. */
export const HOUSING_RETURN_HELPER_TEXT =
  "Årlig værdistigning for netop denne bolig. Uden egen sats følger den " +
  "fremskrivningens generelle boligafkast."

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
 * one use the projection models.
 *
 * {@link DEFAULT_SALE_COSTS_PCT} is the one field here that does carry an
 * assumption, and deliberately. A value or a use left alone is visibly blank; a
 * sale cost left alone is not, and zero is a claim about the world rather than
 * an absence of one. See {@link PlannedProperty.saleCostsPct}.
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
    saleCostsPct: DEFAULT_SALE_COSTS_PCT,
    acquisitionAge: Math.max(0, Math.round(currentAge)),
    disposalAge: null,
    // All-equity, and the plan's own housing return. A row added to the list is
    // owned from today, and financing an already-owned house would invent a
    // mortgage beside the {@link PlannedLoan} that states the real one. The form
    // offers both as soon as the row is dated into the future.
    financing: null,
    housingReturn: null,
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
  // The LTV rides on the purchase clause rather than standing on its own,
  // because that is the year it describes — and it is named only where
  // {@link offersFinancing} says the projection reads it, so a figure left over
  // from an entry that has since been dated to today is not reported as if it
  // still financed anything.
  const financed =
    property.financing && offersFinancing(property, currentAge)
      ? ` med ${formatPercent(property.financing.ltv)} lån`
      : ""
  const bought =
    property.acquisitionAge <= currentAge
      ? "Ejes i dag"
      : `Købes som ${property.acquisitionAge}-årig${financed}`
  if (property.disposalAge === null) return bought
  // Named on every row that is sold, which since {@link DEFAULT_SALE_COSTS_PCT}
  // is nearly all of them — the opposite of what this guard was written for, and
  // kept anyway. The share is now an assumption the projection makes on the
  // household's behalf and one that costs it real money, so the row that carries
  // it silently is the row worth worrying about. What the guard still buys is
  // the converse: a household that typed 0 said a sale costs it nothing, and
  // "0,00% i salgsomkostninger" would report that claim back as if it were a
  // charge.
  const sale = `sælges som ${property.disposalAge}-årig`
  return property.saleCostsPct > 0
    ? `${bought} · ${sale} · ${formatPercent(property.saleCostsPct)} i salgsomkostninger`
    : `${bought} · ${sale}`
}

/**
 * Value, grundværdi and ownership window on one line.
 *
 * The use is named only when it is not `"own"`, and the appreciation only when
 * the entry states one of its own: both are defaults carried by most rows, so
 * spelling them out everywhere would bury the one row that says something the
 * rest do not.
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
    ...(property.housingReturn === null
      ? []
      : [`${formatPercent(property.housingReturn)} om året`]),
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
