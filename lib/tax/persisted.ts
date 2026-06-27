/**
 * Read the persisted `tax_input` JSONB (one TaxInput per household person) and
 * compute taxes safely on the server. Mirrors the app's IMPORT reducer: stored
 * fields are merged onto a fresh default input, and property/summerHouse get
 * their own default merge so partial/old data can't produce NaNs.
 */

import { createDefaultInput } from "./defaults"
import { calculateTax } from "./calculator"
import type { PropertyInput, TaxInput, TaxResult } from "./types"

const DEFAULT_PROPERTY: PropertyInput = {
  propertyValue: 0,
  assessmentBasis: 0,
  landValue: 0,
  landAssessmentBasis: 0,
  purchasedBefore19980701: false,
  isCondo: false,
  ownershipShare: 1,
  personalTaxDiscount: 0,
}

/** Merge a stored (possibly partial) person object onto a fresh default input. */
export function mergeTaxInput(raw: unknown): TaxInput {
  const base = createDefaultInput()
  if (!raw || typeof raw !== "object") return base
  const o = raw as Record<string, unknown>
  const out = base as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(o)) {
    if (k === "property" || k === "summerHouse") continue
    if (v !== undefined) out[k] = v
  }
  if (o.property && typeof o.property === "object") {
    out.property = { ...DEFAULT_PROPERTY, ...(o.property as object) }
  }
  if (o.summerHouse && typeof o.summerHouse === "object") {
    out.summerHouse = {
      ...DEFAULT_PROPERTY,
      municipality: base.municipality,
      ...(o.summerHouse as object),
    }
  }
  return out as unknown as TaxInput
}

/**
 * Parse `tax_input` into one TaxInput per person (max 2). Accepts the current
 * `{ persons: TaxInput[] }` shape and the legacy single-object shape.
 */
export function readPersistedTaxInputs(raw: unknown): TaxInput[] {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>
    if (Array.isArray(o.persons)) {
      return (o.persons as unknown[]).slice(0, 2).map(mergeTaxInput)
    }
    if ("year" in o) return [mergeTaxInput(o)] // legacy single TaxInput
  }
  return []
}

/** calculateTax that returns null instead of throwing (e.g. unknown kommune). */
export function safeCalculateTax(input: TaxInput): TaxResult | null {
  try {
    return calculateTax(input)
  } catch {
    return null
  }
}
