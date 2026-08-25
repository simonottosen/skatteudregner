/**
 * Where each field on a person's `TaxInput` came from: a document they uploaded,
 * a value they typed, or the calculator's own default.
 *
 * The distinction is invisible in the form itself. `birthDate` defaults to
 * 1980-01-01 and `municipality` to København, and on screen both look exactly as
 * authoritative as a figure read off a payslip — while moving the bill by
 * thousands of kroner. Tracking origin is what lets the UI say which is which.
 *
 * This is session state and is deliberately not persisted: it describes an
 * upload that happened in this session, and the upload receipt itself resets on
 * reload for the same reason. It is also held per person (in
 * `useTaxCalculator`'s reducer), because the form is a single component that
 * swaps which person it edits — component-local state would follow the form
 * rather than the person and report person 1's import while showing person 2.
 */

import type { TaxInputField } from "./types"

/**
 * Which document was uploaded. A payslip is parsed differently and fills a
 * different set of fields, so the user picks rather than us sniffing the file.
 */
export type DocumentKind = "forskudsopgoerelse" | "loenseddel"

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  forskudsopgoerelse: "Forskudsopgørelse",
  loenseddel: "Lønseddel",
}

export type FieldOrigin = "document" | "user" | "default"

/**
 * The defaults that are *not* neutral.
 *
 * Every other field in `createDefaultInput()` starts at 0 or false, which
 * contributes nothing — leaving those untouched says "none", which is a real
 * answer. These three instead assert something specific about the user (lives in
 * København, born in 1980, not in the folkekirke) that is often wrong and always
 * material.
 *
 * `workDaysPerYear` (220) is the near-miss: a genuine assumption, but it reaches
 * the result only through `commuteDistanceKm`, which defaults to 0.
 */
export const ASSUMED_FIELDS = [
  "municipality",
  "churchMember",
  "birthDate",
] as const satisfies readonly TaxInputField[]

export type AssumedField = (typeof ASSUMED_FIELDS)[number]

/** Named as the form labels them, so the notice points at something findable. */
export const ASSUMED_FIELD_LABELS: Record<AssumedField, string> = {
  municipality: "Kommune",
  churchMember: "Medlem af folkekirken",
  birthDate: "Fødselsdato",
}

export interface TaxProvenance {
  /** The last document imported for this person, or null if none this session. */
  kind: DocumentKind | null
  /** Non-default fields only — an absent key means the value is still a default. */
  origins: Partial<Record<TaxInputField, Exclude<FieldOrigin, "default">>>
  /** Whether the user has dismissed the "check these fields" notice. */
  noticeDismissed: boolean
}

export const EMPTY_PROVENANCE: TaxProvenance = {
  kind: null,
  origins: {},
  noticeDismissed: false,
}

export function fieldOrigin(
  provenance: TaxProvenance,
  field: TaxInputField
): FieldOrigin {
  return provenance.origins[field] ?? "default"
}

/**
 * Mark a field as the user's own answer.
 *
 * Returns the same object when nothing would change: this runs on every
 * keystroke, and callers memoise on the provenance reference.
 */
export function withUserEdit(
  provenance: TaxProvenance,
  field: TaxInputField
): TaxProvenance {
  if (provenance.origins[field] === "user") return provenance
  return {
    ...provenance,
    origins: { ...provenance.origins, [field]: "user" },
  }
}

/**
 * Record an import. Fields the document did not supply keep whatever origin they
 * had, so a municipality the user picked before uploading a payslip stays theirs
 * rather than reverting to an assumption.
 *
 * `undefined` values are skipped because the reducer skips them too — a key that
 * never reaches the form must not be reported as read from the document.
 */
export function withImport(
  provenance: TaxProvenance,
  data: Readonly<Record<string, unknown>>,
  kind: DocumentKind
): TaxProvenance {
  const origins = { ...provenance.origins }
  for (const [key, value] of Object.entries(data)) {
    if (key === "property" || key === "summerHouse") continue
    if (value === undefined) continue
    origins[key as TaxInputField] = "document"
  }
  return { kind, origins, noticeDismissed: false }
}

export function dismissNotice(provenance: TaxProvenance): TaxProvenance {
  if (provenance.noticeDismissed) return provenance
  return { ...provenance, noticeDismissed: true }
}

/** The fields this person's document actually filled. */
export function documentFields(provenance: TaxProvenance): TaxInputField[] {
  return (Object.keys(provenance.origins) as TaxInputField[]).filter(
    (f) => provenance.origins[f] === "document"
  )
}

/**
 * The material assumptions still standing — the `ASSUMED_FIELDS` that are
 * neither in the document nor answered by the user.
 *
 * Derived rather than hardcoded per document kind. A forskudsopgørelse fills all
 * three, a payslip none, and a partly-recognised forskudsopgørelse lands
 * somewhere between; "payslip ⇒ these three" would miss that last case. It also
 * means the notice shrinks as the user fills the fields in.
 */
export function assumedFields(provenance: TaxProvenance): AssumedField[] {
  return ASSUMED_FIELDS.filter((f) => fieldOrigin(provenance, f) === "default")
}

export function assumedFieldLabels(provenance: TaxProvenance): string[] {
  return assumedFields(provenance).map((f) => ASSUMED_FIELD_LABELS[f])
}

/**
 * The "check these fields" notice, or null when there is nothing to say: before
 * any import there is no receipt to qualify, and after one the notice lasts only
 * while something is still assumed and until the user dismisses it.
 *
 * The copy lives here rather than in the form because `vitest.config.ts` collects
 * only `**\/__tests__\/**\/*.test.ts` — nothing in a `.tsx` file is reachable by
 * a test in this repo, and the singular/plural split is exactly the kind of
 * thing that silently rots.
 */
export function assumptionNotice(
  provenance: TaxProvenance
): { title: string; subtitle: string } | null {
  if (provenance.kind === null || provenance.noticeDismissed) return null

  const labels = assumedFieldLabels(provenance)
  if (labels.length === 0) return null

  const one = labels.length === 1
  return {
    title: one ? "Tjek dette felt" : `Tjek disse ${labels.length} felter`,
    subtitle:
      `${labels.join(", ")} stod ikke i dokumentet. ` +
      (one
        ? "Værdien herunder er en standardværdi"
        : "Værdierne herunder er standardværdier") +
      " — ikke noget vi har læst fra din PDF — og " +
      (one ? "den påvirker" : "de påvirker") +
      " skatten mærkbart.",
  }
}

/**
 * A one-line receipt for the result panel, so a number the user is about to
 * trust says how much of it was actually read off their document. Null before
 * any import, when there is nothing to attribute.
 */
export function provenanceSummary(provenance: TaxProvenance): string | null {
  if (provenance.kind === null) return null

  const read = documentFields(provenance).length
  const assumed = assumedFields(provenance).length
  const parts = [
    `Baseret på ${DOCUMENT_LABELS[provenance.kind].toLowerCase()}`,
    `${read} ${read === 1 ? "felt" : "felter"} læst`,
  ]
  if (assumed > 0) {
    parts.push(`${assumed} ${assumed === 1 ? "antagelse" : "antagelser"}`)
  }
  return parts.join(" · ")
}
