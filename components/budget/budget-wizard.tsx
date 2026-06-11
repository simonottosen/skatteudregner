"use client"

import { useEffect, useState } from "react"
import {
  Modal,
  NumberInput,
  Select,
  SelectItem,
  Slider,
  Toggle,
  InlineNotification,
} from "@carbon/react"
import {
  generateBudget,
  estimateMortgage,
  type GeneratedBudgetItem,
  type VacationLevel,
} from "@/lib/budget/generate-budget"
import { useTax } from "@/components/tax-provider"
import { formatDKK } from "@/lib/format"

interface BudgetWizardProps {
  open: boolean
  onClose: () => void
  onGenerate: (items: GeneratedBudgetItem[]) => void
}

function toCount(value: number | string, fallback: number, min: number): number {
  const n = typeof value === "number" ? value : parseInt(value, 10)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, n)
}

function lifestyleHint(pct: number): string {
  if (pct <= -35) return "Meget sparsommelig"
  if (pct <= -10) return "Lidt under gennemsnittet"
  if (pct < 10) return "Som en typisk husstand"
  if (pct < 35) return "Lidt over gennemsnittet"
  return "Luksuriøs livsstil"
}

export function BudgetWizard({ open, onClose, onGenerate }: BudgetWizardProps) {
  const { input, results } = useTax()

  // Figures the tax calculator already knows for this household.
  const annualMortgageInterest = Math.max(0, input.mortgageInterest || 0)
  const mortgage = estimateMortgage(annualMortgageInterest)
  const suggestedHousing = mortgage.total
  const monthlyPropertyTax =
    results.reduce((s, r) => s + (r.totalPropertyTax || 0), 0) / 12
  const taxKnowsOwner = !!input.property || monthlyPropertyTax > 0

  const [adults, setAdults] = useState(2)
  const [children, setChildren] = useState(0)
  const [cars, setCars] = useState(1)
  const [ownsHome, setOwnsHome] = useState(false)
  const [housingCost, setHousingCost] = useState(10000)
  const [vacationLevel, setVacationLevel] = useState<VacationLevel>("medium")
  // -50 .. +50 (%): how this household spends vs. a typical Danish one.
  const [lifestyle, setLifestyle] = useState(0)

  // When the wizard opens, seed housing + ownership from the tax page if known.
  useEffect(() => {
    if (!open) return
    if (suggestedHousing > 0) setHousingCost(suggestedHousing)
    if (taxKnowsOwner) setOwnsHome(true)
    // Only re-seed on open; the user can adjust afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSubmit = () => {
    onGenerate(
      generateBudget({
        adults,
        children,
        cars,
        housingCost,
        ownsHome,
        vacationLevel,
        lifestyle: lifestyle / 50,
      })
    )
    onClose()
  }

  return (
    <Modal
      open={open}
      modalHeading="Generér startbudget"
      modalLabel="Danske standardbeløb"
      primaryButtonText="Generér budget"
      secondaryButtonText="Annullér"
      onRequestClose={onClose}
      onRequestSubmit={handleSubmit}
    >
      <p className="text-muted-foreground mb-4 text-sm">
        Svar på et par spørgsmål, så foreslår vi et komplet månedsbudget baseret
        på danske gennemsnit (Danmarks Statistik og Finanstilsynet). Beløbene kan
        redigeres bagefter. Bemærk: dette erstatter dine nuværende udgiftslinjer.
      </p>

      {suggestedHousing > 0 && (
        <InlineNotification
          className="mb-4 max-w-full"
          kind="info"
          lowContrast
          hideCloseButton
          title="Tal fra din skatteberegning er brugt"
          subtitle={`Vi har anslået din boligudgift til ${formatDKK(
            suggestedHousing
          )}/md. ud fra dine renteudgifter — ca. ${formatDKK(
            mortgage.interest
          )} renter + ${formatDKK(mortgage.afdrag)} afdrag.`}
        />
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumberInput
            id="wizard-adults"
            label="Voksne i husstanden"
            min={1}
            max={2}
            value={adults}
            onChange={(_e, { value }) => setAdults(toCount(value, 2, 1))}
          />
          <NumberInput
            id="wizard-children"
            label="Hjemmeboende børn"
            min={0}
            max={10}
            value={children}
            onChange={(_e, { value }) => setChildren(toCount(value, 0, 0))}
          />
          <NumberInput
            id="wizard-cars"
            label="Antal biler"
            min={0}
            max={4}
            value={cars}
            onChange={(_e, { value }) => setCars(toCount(value, 0, 0))}
          />
        </div>

        <NumberInput
          id="wizard-housing"
          label="Boligudgift per måned (husleje/boliglån, kr.)"
          min={0}
          step={500}
          value={housingCost}
          onChange={(_e, { value }) => setHousingCost(toCount(value, 0, 0))}
        />

        <Toggle
          id="wizard-owns-home"
          size="sm"
          hideLabel
          labelText="Jeg ejer min bolig (tilføjer ejendomsskat og vedligehold)"
          toggled={ownsHome}
          onToggle={(checked) => setOwnsHome(checked)}
        />

        <Select
          id="wizard-vacation"
          labelText="Ferievaner"
          value={vacationLevel}
          onChange={(e) => setVacationLevel(e.target.value as VacationLevel)}
        >
          <SelectItem value="low" text="Sparsommelig – få eller billige ferier" />
          <SelectItem value="medium" text="Almindelig – ca. én ferie om året" />
          <SelectItem value="high" text="Luksus – flere eller dyre ferier" />
        </Select>

        <div>
          <Slider
            id="wizard-lifestyle"
            labelText="Livsstil sammenlignet med en typisk dansk husstand"
            min={-50}
            max={50}
            step={5}
            value={lifestyle}
            minLabel="−50%"
            maxLabel="+50%"
            formatLabel={(value: number) =>
              value > 0 ? `+${value}%` : `${value}%`
            }
            onChange={({ value }: { value: number }) => setLifestyle(value)}
          />
          <p className="text-muted-foreground mt-1 text-xs">
            {lifestyleHint(lifestyle)} — justerer kun valgfrie poster som mad,
            restaurant, ferie og fritid. Faste udgifter og forsikringer ændres
            ikke.
          </p>
        </div>
      </div>
    </Modal>
  )
}
