"use client"

import { TaxForm } from "@/components/tax-calculator/tax-form"
import { TaxResults } from "@/components/tax-calculator/tax-results"
import { useTaxCalculator } from "@/hooks/use-tax-calculator"

export default function Page() {
  const { input, result, setField, setPropertyField, toggleProperty, importData } =
    useTaxCalculator()

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Skatteberegner</h1>
        <p className="text-muted-foreground text-sm">
          Beregn din danske skat for {input.year}
        </p>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1 lg:max-w-2xl">
          <TaxForm
            input={input}
            setField={setField}
            setPropertyField={setPropertyField}
            toggleProperty={toggleProperty}
            onImport={importData}
          />
        </div>

        <div className="w-full lg:w-96 lg:shrink-0">
          <TaxResults result={result} />
        </div>
      </div>

      <footer className="text-muted-foreground mt-8 text-center text-xs">
        Denne beregner er et estimat og erstatter ikke SKATs officielle
        beregning. Tryk <kbd>d</kbd> for at skifte mørk tilstand.
      </footer>
    </div>
  )
}
