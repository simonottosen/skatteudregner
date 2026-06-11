"use client"

import * as React from "react"
import { useBudgetController } from "@/hooks/use-budget"

type BudgetApi = ReturnType<typeof useBudgetController>

const BudgetContext = React.createContext<BudgetApi | null>(null)

/**
 * Holds the household budget once for the whole app, so every page (/budget,
 * /resultat …) reads and writes the same in-memory state. Mounted in the root
 * layout inside TaxProvider, since the budget derives income from the tax
 * calculator. Must be inside TaxProvider.
 */
export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const value = useBudgetController()
  return (
    <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>
  )
}

export function useBudget(): BudgetApi {
  const ctx = React.useContext(BudgetContext)
  if (!ctx) {
    throw new Error("useBudget must be used within a BudgetProvider")
  }
  return ctx
}
