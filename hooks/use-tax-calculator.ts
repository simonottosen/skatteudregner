"use client"

import { useCallback, useMemo, useReducer } from "react"
import type {
  PropertyInput,
  SetTaxField,
  TaxInput,
  TaxInputField,
  TaxResult,
} from "@/lib/tax/types"
import { createDefaultInput } from "@/lib/tax/defaults"
import { calculateTax } from "@/lib/tax/calculator"
import {
  EMPTY_PROVENANCE,
  dismissNotice,
  withImport,
  withUserEdit,
  type DocumentKind,
  type TaxProvenance,
} from "@/lib/tax/provenance"

type ImportedData = Omit<Partial<TaxInput>, "property" | "summerHouse"> & {
  property?: Partial<PropertyInput>
}

type TaxAction =
  | { type: "SET_FIELD"; field: TaxInputField; value: TaxInput[TaxInputField] }
  | { type: "SET_PROPERTY_FIELD"; property: "property" | "summerHouse"; field: string; value: unknown }
  | { type: "TOGGLE_PROPERTY"; property: "property" | "summerHouse"; enabled: boolean }
  | { type: "IMPORT"; data: ImportedData; kind: DocumentKind }
  | { type: "DISMISS_IMPORT_NOTICE" }
  | { type: "HYDRATE"; input: TaxInput }
  | { type: "RESET" }

/**
 * Input and the record of where it came from move together, so they cannot
 * drift: every action that changes a value decides its origin in the same step.
 */
interface TaxState {
  input: TaxInput
  provenance: TaxProvenance
}

function createInitialState(): TaxState {
  return { input: createDefaultInput(), provenance: EMPTY_PROVENANCE }
}

function taxReducer(state: TaxState, action: TaxAction): TaxState {
  switch (action.type) {
    case "SET_FIELD":
      return {
        input: { ...state.input, [action.field]: action.value },
        // Typing over a value makes it the user's answer — which is also how an
        // assumption stops being one, so the notice shrinks as they fill it in.
        provenance: withUserEdit(state.provenance, action.field),
      }
    case "SET_PROPERTY_FIELD": {
      const current = state.input[action.property]
      if (!current) return state
      return {
        ...state,
        input: {
          ...state.input,
          [action.property]: { ...current, [action.field]: action.value },
        },
      }
    }
    case "TOGGLE_PROPERTY": {
      if (action.enabled) {
        const defaultProp = {
          propertyValue: 0,
          assessmentBasis: 0,
          landValue: 0,
          landAssessmentBasis: 0,
          purchasedBefore19980701: false,
          isCondo: false,
          ownershipShare: 1,
          personalTaxDiscount: 0,
          ...(action.property === "summerHouse" ? { municipality: "København" } : {}),
        }
        return { ...state, input: { ...state.input, [action.property]: defaultProp } }
      }
      return { ...state, input: { ...state.input, [action.property]: undefined } }
    }
    case "IMPORT": {
      const { data } = action
      const input = { ...state.input }

      // Merge top-level fields (skip property — handled separately)
      for (const [key, value] of Object.entries(data)) {
        if (key === "property" || key === "summerHouse") continue
        if (value !== undefined) {
          ;(input as Record<string, unknown>)[key] = value
        }
      }

      // Merge property if present in import
      if (data.property) {
        const defaultProp = {
          propertyValue: 0,
          assessmentBasis: 0,
          landValue: 0,
          landAssessmentBasis: 0,
          purchasedBefore19980701: false,
          isCondo: false,
          ownershipShare: 1,
          personalTaxDiscount: 0,
        }
        input.property = { ...defaultProp, ...state.input.property, ...data.property }
      }

      return { input, provenance: withImport(state.provenance, data, action.kind) }
    }
    case "DISMISS_IMPORT_NOTICE":
      return { ...state, provenance: dismissNotice(state.provenance) }
    case "HYDRATE":
      // Restored from storage: this session has no document behind these values
      // and no record of which the user chose, so claim neither.
      return { input: action.input, provenance: EMPTY_PROVENANCE }
    case "RESET":
      return createInitialState()
    default:
      return state
  }
}

export function useTaxCalculator() {
  const [{ input, provenance }, dispatch] = useReducer(
    taxReducer,
    undefined,
    createInitialState
  )

  const result: TaxResult = useMemo(() => {
    try {
      return calculateTax(input)
    } catch {
      return calculateTax(createDefaultInput())
    }
  }, [input])

  const setField = useCallback<SetTaxField>((field, value) => {
    dispatch({ type: "SET_FIELD", field, value })
  }, [])

  const setPropertyField = useCallback(
    (property: "property" | "summerHouse", field: string, value: unknown) => {
      dispatch({ type: "SET_PROPERTY_FIELD", property, field, value })
    },
    []
  )

  const toggleProperty = useCallback(
    (property: "property" | "summerHouse", enabled: boolean) => {
      dispatch({ type: "TOGGLE_PROPERTY", property, enabled })
    },
    []
  )

  const importData = useCallback(
    (data: ImportedData, kind: DocumentKind) => {
      dispatch({ type: "IMPORT", data, kind })
    },
    []
  )

  const dismissImportNotice = useCallback(
    () => dispatch({ type: "DISMISS_IMPORT_NOTICE" }),
    []
  )

  const hydrate = useCallback(
    (next: TaxInput) => dispatch({ type: "HYDRATE", input: next }),
    []
  )

  const reset = useCallback(() => dispatch({ type: "RESET" }), [])

  return {
    input,
    result,
    provenance,
    setField,
    setPropertyField,
    toggleProperty,
    importData,
    dismissImportNotice,
    hydrate,
    reset,
  }
}
