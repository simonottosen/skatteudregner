"use client"

import { ContentSwitcher, Switch, Button } from "@carbon/react"
import { Add, TrashCan } from "@carbon/icons-react"
import { TaxForm } from "@/components/tax-calculator/tax-form"
import { TaxResults } from "@/components/tax-calculator/tax-results"
import { PaycheckComparison } from "@/components/tax-calculator/paycheck-comparison"
import { useTax } from "@/components/tax-provider"
import { formatDKK } from "@/lib/format"

export default function SkatPage() {
  const {
    input,
    result,
    setField,
    setPropertyField,
    toggleProperty,
    importData,
    hasPerson2,
    activeIndex,
    setActiveIndex,
    addPerson,
    removePerson,
    monthlyNetIncome,
    person2MonthlyNetIncome,
  } = useTax()

  return (
    <main
      style={{
        maxWidth: "1120px",
        margin: "0 auto",
        padding: "2rem 1.5rem 4rem",
      }}
    >
      <header className="mb-6 border-l-4 border-[var(--cds-border-interactive)] pl-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Beregn din danske skat
        </h1>
        <p className="text-muted-foreground text-sm">
          Indkomstår {input.year} · AM-bidrag, bund-, top- og kommuneskat,
          aktie- og boligskat
        </p>
      </header>

      {/* Person switcher */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {hasPerson2 ? (
            <>
              <div className="w-72 max-w-full">
                <ContentSwitcher
                  selectedIndex={activeIndex}
                  onChange={({ index }) => setActiveIndex(index ?? 0)}
                >
                  <Switch name="person-1" text="Person 1" />
                  <Switch name="person-2" text="Person 2" />
                </ContentSwitcher>
              </div>
              <Button
                kind="danger--ghost"
                size="sm"
                renderIcon={TrashCan}
                onClick={removePerson}
              >
                Fjern person 2
              </Button>
            </>
          ) : (
            <Button
              kind="tertiary"
              size="sm"
              renderIcon={Add}
              onClick={addPerson}
            >
              Tilføj person 2
            </Button>
          )}
        </div>

        {hasPerson2 && (
          <p className="text-muted-foreground text-sm">
            Husstandens nettoløn:{" "}
            <span className="text-success font-semibold">
              {formatDKK(monthlyNetIncome + person2MonthlyNetIncome)}/md.
            </span>
          </p>
        )}
      </div>

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

      <PaycheckComparison input={input} result={result} />

      <footer className="text-muted-foreground mt-8 text-center text-xs">
        Denne beregner er et estimat og erstatter ikke SKATs officielle
        beregning. Tryk <kbd>d</kbd> for at skifte mørk tilstand.
      </footer>
    </main>
  )
}
