"use client"

import * as React from "react"
import { useTaxCalculator } from "@/hooks/use-tax-calculator"
import { useRemoteSync } from "@/hooks/use-remote-sync"
import type { TaxInput, TaxResult } from "@/lib/tax/types"

const STORAGE_KEY = "skatteberegner:tax-input"

interface PersistedTax {
  version: 2
  persons: TaxInput[]
  activeIndex: number
}

type SingleTax = ReturnType<typeof useTaxCalculator>

type TaxContextValue = SingleTax & {
  /** Person 1 net income for a single month (annual net income / 12). */
  monthlyNetIncome: number
  /** Person 2 net income / month (0 when there is no second person). */
  person2MonthlyNetIncome: number
  /** Full tax result(s) for the household (1 or 2 entries). */
  results: TaxResult[]
  /** Whether a second person has been added. */
  hasPerson2: boolean
  /** Which person the form is currently editing (0 or 1). */
  activeIndex: number
  setActiveIndex: (index: number) => void
  addPerson: () => void
  removePerson: () => void
}

const TaxContext = React.createContext<TaxContextValue | null>(null)

/** Accepts the v2 object shape and the legacy single-TaxInput shape. */
function normalizePersistedTax(raw: unknown): PersistedTax | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  if (Array.isArray(o.persons)) {
    const persons = (o.persons as unknown[])
      .filter((p): p is TaxInput => !!p && typeof p === "object")
      .slice(0, 2)
    if (persons.length === 0) return null
    return { version: 2, persons, activeIndex: o.activeIndex === 1 ? 1 : 0 }
  }
  // Legacy: a single TaxInput object (has a `year` field).
  if (typeof o.year !== "undefined") {
    return { version: 2, persons: [o as unknown as TaxInput], activeIndex: 0 }
  }
  return null
}

export function TaxProvider({ children }: { children: React.ReactNode }) {
  const p1 = useTaxCalculator()
  const p2 = useTaxCalculator()
  const [hasPerson2, setHasPerson2] = React.useState(false)
  const [activeIndex, setActiveIndexState] = React.useState(0)
  const loaded = React.useRef(false)

  const { hydrate: hydrateP1 } = p1
  const { hydrate: hydrateP2, setField: setFieldP2, reset: resetP2 } = p2

  const applyPersisted = React.useCallback(
    (data: PersistedTax) => {
      hydrateP1(data.persons[0])
      if (data.persons[1]) {
        hydrateP2(data.persons[1])
        setHasPerson2(true)
        setActiveIndexState(data.activeIndex === 1 ? 1 : 0)
      } else {
        setHasPerson2(false)
        setActiveIndexState(0)
      }
    },
    [hydrateP1, hydrateP2]
  )

  // Combined value that gets persisted (localStorage + Supabase).
  const persisted = React.useMemo<PersistedTax>(
    () => ({
      version: 2,
      persons: hasPerson2 ? [p1.input, p2.input] : [p1.input],
      activeIndex,
    }),
    [hasPerson2, p1.input, p2.input, activeIndex]
  )

  // Sync to Supabase when signed in (debounced + flush on leave).
  useRemoteSync<PersistedTax>("tax_input", persisted, (remote) => {
    const n = normalizePersistedTax(remote)
    if (n) applyPersisted(n)
  })

  // Restore from localStorage once on mount (anonymous fallback).
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const n = normalizePersistedTax(JSON.parse(raw))
        if (n) applyPersisted(n)
      }
    } catch {
      // Ignore malformed/unavailable storage.
    }
    loaded.current = true
  }, [applyPersisted])

  // Persist to localStorage after the initial load.
  React.useEffect(() => {
    if (!loaded.current) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch {
      // Ignore storage write failures.
    }
  }, [persisted])

  const setActiveIndex = React.useCallback((index: number) => {
    setActiveIndexState(index === 1 ? 1 : 0)
  }, [])

  const addPerson = React.useCallback(() => {
    // Seed person 2 with person 1's year + municipality for convenience.
    setFieldP2("year", p1.input.year)
    setFieldP2("municipality", p1.input.municipality)
    setHasPerson2(true)
    setActiveIndexState(1)
  }, [setFieldP2, p1.input.year, p1.input.municipality])

  const removePerson = React.useCallback(() => {
    resetP2()
    setHasPerson2(false)
    setActiveIndexState(0)
  }, [resetP2])

  const active = activeIndex === 1 && hasPerson2 ? p2 : p1

  const value = React.useMemo<TaxContextValue>(
    () => ({
      ...active,
      monthlyNetIncome: p1.result.netIncome / 12,
      person2MonthlyNetIncome: hasPerson2 ? p2.result.netIncome / 12 : 0,
      results: hasPerson2 ? [p1.result, p2.result] : [p1.result],
      hasPerson2,
      activeIndex,
      setActiveIndex,
      addPerson,
      removePerson,
    }),
    [
      active,
      p1.result,
      p2.result,
      hasPerson2,
      activeIndex,
      setActiveIndex,
      addPerson,
      removePerson,
    ]
  )

  return <TaxContext.Provider value={value}>{children}</TaxContext.Provider>
}

export function useTax(): TaxContextValue {
  const ctx = React.useContext(TaxContext)
  if (!ctx) {
    throw new Error("useTax must be used within a TaxProvider")
  }
  return ctx
}
