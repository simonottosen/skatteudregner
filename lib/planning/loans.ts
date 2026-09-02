/**
 * The loan list as the /planlaegning form works with it: the entries it adds and
 * removes, the migration from the two hard-coded debts that came before, and the
 * Danish it describes them in.
 *
 * Here rather than inside the form because `vitest.config.ts` collects only
 * `.ts` files — a rule written in a `.tsx` is a rule no test can reach. The form
 * keeps the inputs; everything that decides *what* to show lives here.
 */

import { clampNum, newId } from "./normalize"
import {
  DEFAULT_PLANNING_STATE,
  type LoanType,
  type PlannedLoan,
  type PlannedProperty,
} from "./types"
import { formatDKK, formatPercent } from "@/lib/format"

/** What each type is called in the form. */
export const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  realkredit: "Realkreditlån",
  bank: "Banklån",
}

export const LOAN_TYPES: LoanType[] = ["realkredit", "bank"]

/**
 * Rate and term a new loan of each type starts on.
 *
 * Read off the scalars this list replaces, so that a hand-added loan prices the
 * same as the field it stands in for. Unlike the balance these are not left at
 * zero: 0 % over 0 months is not a cautious guess but a free loan, and neither
 * number has a neutral value the form could fall back on.
 */
export const LOAN_TYPE_DEFAULTS: Record<
  LoanType,
  { rate: number; termMonths: number }
> = {
  realkredit: {
    rate: DEFAULT_PLANNING_STATE.mortgageRate,
    termMonths: DEFAULT_PLANNING_STATE.mortgageTermYears * 12,
  },
  bank: {
    rate: DEFAULT_PLANNING_STATE.otherDebtRate,
    termMonths: DEFAULT_PLANNING_STATE.otherDebtTermYears * 12,
  },
}

/** The 40 years `normalizePlanning` bounds both legacy loans by, in months. */
const MAX_TERM_MONTHS = 40 * 12

/**
 * Same bound as the budget's own bidragssats (`lib/budget/state.ts`), so a rate
 * that survives there survives the trip into a loan unchanged.
 */
const MAX_BIDRAGSSATS = 0.05

/**
 * A blank entry for the form to fill in: nothing borrowed yet, on the type's
 * usual rate and term, repaying from the first month.
 *
 * Zero kroner for the same reason `newPlannedProperty` starts at zero — an
 * amount the user did not type is one they would have to notice to correct — and
 * zero bidrag for the reason the plan's `mortgageBidragssats` defaults to zero:
 * an invented fee is charged against the saving every year.
 */
export function newPlannedLoan(
  type: LoanType,
  propertyId: string | null
): PlannedLoan {
  return {
    id: newId("loan"),
    propertyId,
    label: LOAN_TYPE_LABEL[type],
    type,
    principal: 0,
    rate: LOAN_TYPE_DEFAULTS[type].rate,
    termMonths: LOAN_TYPE_DEFAULTS[type].termMonths,
    interestOnlyYears: 0,
    bidragssats: 0,
  }
}

/** Replace the entry with `next.id`, or leave the list alone if it is gone. */
export function replaceLoan(
  list: readonly PlannedLoan[],
  next: PlannedLoan
): PlannedLoan[] {
  return list.map((l) => (l.id === next.id ? next : l))
}

export function removeLoan(
  list: readonly PlannedLoan[],
  id: string
): PlannedLoan[] {
  return list.filter((l) => l.id !== id)
}

/**
 * The term and the afdragsfrihed cliff, as the form says it.
 *
 * The cliff is given as an age rather than a duration because that is what the
 * user came to see: it lands on the same axis the projection is drawn on, and
 * "afdragsfri i 5 år" leaves them to do the addition themselves.
 */
export function repaymentSummary(loan: PlannedLoan, currentAge: number): string {
  const term =
    loan.termMonths % 12 === 0
      ? `${loan.termMonths / 12} år`
      : `${loan.termMonths} md.`
  if (loan.interestOnlyYears <= 0) return term
  const resumesAt = Math.round(currentAge + loan.interestOnlyYears)
  return `${term} · afdragsfri til du fylder ${resumesAt}`
}

/**
 * Which property secures the loan, as the form says it.
 *
 * A link no property answers to is named as unknown rather than shown as
 * unsecured: those are different debts, and only the user can say which this one
 * is. {@link missingSecurityNotice} says what to do about it.
 */
export function securitySummary(
  loan: PlannedLoan,
  properties: readonly PlannedProperty[]
): string {
  if (loan.propertyId === null) return "Uden pant"
  const secured = properties.find((p) => p.id === loan.propertyId)
  if (!secured) return "Ukendt bolig"
  return secured.label || "(uden navn)"
}

/** Type, balance, rate, term and what secures it, on one line. */
export function loanSummary(
  loan: PlannedLoan,
  properties: readonly PlannedProperty[],
  currentAge: number
): string {
  return [
    LOAN_TYPE_LABEL[loan.type],
    formatDKK(Math.round(loan.principal)),
    // Bidrag is named separately rather than folded into the rate: it is charged
    // on the balance like interest but buys no rentefradrag, so a household
    // comparing offers needs to see the two figures it was quoted.
    loan.bidragssats > 0
      ? `${formatPercent(loan.rate)} + ${formatPercent(loan.bidragssats)} bidrag`
      : formatPercent(loan.rate),
    repaymentSummary(loan, currentAge),
    securitySummary(loan, properties),
  ].join(" · ")
}

/**
 * What the user has to settle before the plan means what it says — or null when
 * every loan's security is accounted for.
 *
 * Reachable by removing a property a loan was secured on: the two lists are
 * edited apart, so the link outlives the property. Reported rather than quietly
 * repaired, because "secured on nothing" and "secured on the house I have just
 * deleted by mistake" are different plans.
 */
export function missingSecurityNotice(
  loans: readonly PlannedLoan[],
  properties: readonly PlannedProperty[]
): string | null {
  const owned = new Set(properties.map((p) => p.id))
  const dangling = loans.some(
    (l) => l.propertyId !== null && !owned.has(l.propertyId)
  )
  if (!dangling) return null
  return (
    "Et lån er knyttet til en bolig, planen ikke har. Vælg en anden bolig, " +
    "eller sæt lånet til uden pant."
  )
}

/**
 * What the other-debt fields are called once they are an entry in the list. Not
 * "Banklån", the way the migrated mortgage simply takes its type's name: the
 * field this comes from lumped student, car and consumer debt together, so
 * naming it after one of them puts a word in the user's mouth.
 */
const LEGACY_OTHER_DEBT_LABEL = "Anden gæld"

/**
 * A legacy term in years as the months the list holds.
 *
 * Floored at the whole year `normalizePlanning` floors the field at, so a term
 * of nothing migrates to a year rather than to the single month `loanFrom` would
 * otherwise round it up to. The ceiling is left to `loanFrom`, which bounds every
 * term the same however it arrived.
 */
const legacyTermMonths = (years: unknown, fallbackYears: number) =>
  clampNum(years, fallbackYears, 1) * 12

/**
 * Validate the fields of something already known to be an object — split from
 * {@link normalizeLoan} so the migration below, which builds its own object, can
 * reuse every bound without asserting away a null it cannot get.
 */
function loanFrom(o: Record<string, unknown>): PlannedLoan {
  const type: LoanType = o.type === "bank" ? "bank" : "realkredit"
  const defaults = LOAN_TYPE_DEFAULTS[type]
  const termMonths = Math.round(
    clampNum(o.termMonths, defaults.termMonths, 1, MAX_TERM_MONTHS)
  )
  return {
    id: typeof o.id === "string" ? o.id : newId("loan"),
    // Kept as it stands even when no property answers to it — see
    // `missingSecurityNotice` for why the link is not dropped here.
    propertyId: typeof o.propertyId === "string" ? o.propertyId : null,
    label:
      typeof o.label === "string" && o.label.trim()
        ? o.label
        : LOAN_TYPE_LABEL[type],
    type,
    principal: clampNum(o.principal, 0, 0),
    // One bound for both types, rather than the 0,2 the mortgage field had and
    // the 0,5 the other-debt field had: the type is a dropdown now, and a bound
    // that moved with it would rewrite a rate the user never touched.
    rate: clampNum(o.rate, defaults.rate, 0, 0.5),
    termMonths,
    // Afdragsfrihed sits inside the term; longer than the loan itself describes
    // a loan that is never repaid.
    interestOnlyYears: clampNum(o.interestOnlyYears, 0, 0, termMonths / 12),
    // Bidrag is what a realkreditinstitut charges for lending against property.
    // A banklån carries none, whatever a blob says it carries.
    bidragssats:
      type === "bank" ? 0 : clampNum(o.bidragssats, 0, 0, MAX_BIDRAGSSATS),
  }
}

/** Normalize one loan; returns null if it describes no loan at all. */
function normalizeLoan(raw: unknown): PlannedLoan | null {
  if (!raw || typeof raw !== "object") return null
  return loanFrom(raw as Record<string, unknown>)
}

/**
 * Read a plan blob's loan list, migrating it if it predates one.
 *
 * The plan used to hold exactly two debts as flat scalars: a realkreditlån
 * (`mortgage*`, secured on the first property — see {@link PlanningState}) and
 * one lumped other debt (`otherDebt*`, secured on nothing). Each becomes an
 * entry, and each is dropped when its balance is zero, so a household with no
 * bank debt comes back with a one-loan list rather than a loan of nothing.
 *
 * Keyed on the array being absent rather than on `version`, because a blob can
 * arrive from localStorage, Supabase or an MCP client with any version field it
 * likes, and the shape is the thing actually being asked about. That is also why
 * this takes the whole blob: the legacy amounts it falls back to are siblings of
 * the field it reads, not something a caller could pass separately.
 *
 * `properties` must be the plan's *normalized* list rather than the blob's own,
 * because `normalizeProperties` mints an id for every property that arrives
 * without one — a version-1 home gets a fresh id on each call. Securing the
 * migrated mortgage against a second normalization of the same blob would link
 * it to a property the plan does not keep.
 */
export function normalizeLoans(
  blob: unknown,
  properties: readonly PlannedProperty[]
): PlannedLoan[] {
  const o = (blob ?? {}) as Record<string, unknown>
  if (Array.isArray(o.loans)) {
    const out: PlannedLoan[] = []
    for (const raw of o.loans) {
      // A zero balance survives here, unlike in the migration below: this is a
      // row the user has just added and has yet to fill in.
      const loan = normalizeLoan(raw)
      if (loan) out.push(loan)
    }
    return out
  }

  const out: PlannedLoan[] = []
  const mortgageBalance = clampNum(o.mortgageBalance, 0, 0)
  if (mortgageBalance > 0) {
    out.push(
      loanFrom({
        type: "realkredit",
        propertyId: properties[0]?.id ?? null,
        principal: mortgageBalance,
        rate: o.mortgageRate,
        termMonths: legacyTermMonths(
          o.mortgageTermYears,
          DEFAULT_PLANNING_STATE.mortgageTermYears
        ),
        interestOnlyYears: o.mortgageInterestOnlyYears,
        bidragssats: o.mortgageBidragssats,
      })
    )
  }
  const otherDebtBalance = clampNum(o.otherDebtBalance, 0, 0)
  if (otherDebtBalance > 0) {
    out.push(
      loanFrom({
        type: "bank",
        label: LEGACY_OTHER_DEBT_LABEL,
        propertyId: null,
        principal: otherDebtBalance,
        rate: o.otherDebtRate,
        termMonths: legacyTermMonths(
          o.otherDebtTermYears,
          DEFAULT_PLANNING_STATE.otherDebtTermYears
        ),
      })
    )
  }
  return out
}
