"use client"

import { useMemo, useReducer } from "react"
import type { TaxInput, TaxResult, PropertyInput } from "@/lib/tax/types"
import { createDefaultInput } from "@/lib/tax/defaults"
import { calculateTax } from "@/lib/tax/calculator"

type TaxAction =
  | { type: "SET_FIELD"; field: keyof TaxInput; value: TaxInput[keyof TaxInput] }
  | { type: "SET_PROPERTY_FIELD"; property: "property" | "summerHouse"; field: string; value: unknown }
  | { type: "TOGGLE_PROPERTY"; property: "property" | "summerHouse"; enabled: boolean }
  | { type: "IMPORT"; data: Omit<Partial<TaxInput>, "property" | "summerHouse"> & { property?: Partial<PropertyInput> } }
  | { type: "RESET" }

function taxReducer(state: TaxInput, action: TaxAction): TaxInput {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value }
    case "SET_PROPERTY_FIELD": {
      const current = state[action.property]
      if (!current) return state
      return {
        ...state,
        [action.property]: { ...current, [action.field]: action.value },
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
        return { ...state, [action.property]: defaultProp }
      }
      return { ...state, [action.property]: undefined }
    }
    case "IMPORT": {
      const { data } = action
      const newState = { ...state }

      // Merge top-level fields (skip property — handled separately)
      for (const [key, value] of Object.entries(data)) {
        if (key === "property" || key === "summerHouse") continue
        if (value !== undefined) {
          ;(newState as Record<string, unknown>)[key] = value
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
        newState.property = { ...defaultProp, ...state.property, ...data.property }
      }

      return newState
    }
    case "RESET":
      return createDefaultInput()
    default:
      return state
  }
}

export function useTaxCalculator() {
  const [input, dispatch] = useReducer(taxReducer, undefined, createDefaultInput)

  const result: TaxResult = useMemo(() => {
    try {
      return calculateTax(input)
    } catch {
      return calculateTax(createDefaultInput())
    }
  }, [input])

  const setField = <K extends keyof TaxInput>(field: K, value: TaxInput[K]) => {
    dispatch({ type: "SET_FIELD", field, value })
  }

  const setPropertyField = (
    property: "property" | "summerHouse",
    field: string,
    value: unknown,
  ) => {
    dispatch({ type: "SET_PROPERTY_FIELD", property, field, value })
  }

  const toggleProperty = (
    property: "property" | "summerHouse",
    enabled: boolean,
  ) => {
    dispatch({ type: "TOGGLE_PROPERTY", property, enabled })
  }

  const importData = (data: Omit<Partial<TaxInput>, "property" | "summerHouse"> & { property?: Partial<PropertyInput> }) => {
    dispatch({ type: "IMPORT", data })
  }

  const reset = () => dispatch({ type: "RESET" })

  return { input, result, setField, setPropertyField, toggleProperty, importData, reset }
}
