/**
 * Builds a ready-to-paste prompt (in Danish) summarising the user's tax and
 * budget situation, so they can ask an external LLM for help optimising their
 * private economy. Pure and deterministic so it can be unit-tested.
 */

export type HouseholdMode = "single" | "shared" | "separate"

export interface EconomyPromptPerson {
  name: string
  /** Monthly net income in DKK. */
  monthlyNet: number
  /** Where the income figure comes from. */
  source: "skat" | "manual"
}

export interface EconomyPromptCategory {
  name: string
  /** Monthly amount in DKK. */
  monthly: number
  /** Individual budget lines within the category. */
  items?: { label: string; monthly: number }[]
}

/** A single annual tax component, e.g. AM-bidrag or topskat. */
export interface EconomyPromptTaxLine {
  label: string
  yearly: number
}

export interface EconomyPromptInput {
  mode: HouseholdMode
  people: EconomyPromptPerson[]
  /** Whether a full tax calculation exists. */
  hasTax: boolean
  /** Household gross income per month (only meaningful when hasTax). */
  grossMonthly: number
  /** Tax + AM-bidrag per month (only meaningful when hasTax). */
  taxMonthly: number
  /** Effective tax rate as a fraction 0..1 (only meaningful when hasTax). */
  effectiveRate: number
  /** Income feeding the budget, per month. */
  budgetIncomeMonthly: number
  /** Total budgeted expenses per month. */
  budgetExpensesMonthly: number
  /** Income minus expenses per month (can be negative). */
  remainingMonthly: number
  /** Savings rate as a fraction 0..1. */
  savingsRate: number
  /** Expense categories with a positive monthly amount, largest first. */
  categories: EconomyPromptCategory[]
  /** Optional breakdown of the annual tax into its components. */
  taxBreakdown?: EconomyPromptTaxLine[]
}

/** Whole-kroner Danish number, e.g. 12.000. */
function kr(n: number): string {
  return Math.round(n).toLocaleString("da-DK")
}

/** "12.000 kr./md. (144.000 kr./år)". */
function perMonthAndYear(n: number): string {
  return `${kr(n)} kr./md. (${kr(n * 12)} kr./år)`
}

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1).replace(".", ",")} %`
}

const MODE_LABEL: Record<HouseholdMode, string> = {
  single: "Enlig husstand",
  shared: "Par med fælles/delte udgifter",
  separate: "Par med separat økonomi",
}

const SOURCE_LABEL: Record<EconomyPromptPerson["source"], string> = {
  skat: "beregnet via skatteberegner",
  manual: "manuelt indtastet nettoløn",
}

export function buildEconomyPrompt(input: EconomyPromptInput): string {
  const lines: string[] = []

  lines.push(
    "Du er en erfaren dansk privatøkonomisk rådgiver. Hjælp mig med at forstå og " +
      "optimere min private økonomi ud fra tallene nedenfor. Tallene er estimater " +
      "fra en skatte- og budgetberegner."
  )
  lines.push("")

  // Household
  lines.push("## Husstand")
  lines.push(`- Type: ${MODE_LABEL[input.mode]}`)
  for (const p of input.people) {
    lines.push(
      `- ${p.name}: ${kr(p.monthlyNet)} kr./md. i nettoindkomst (${SOURCE_LABEL[p.source]})`
    )
  }
  lines.push("")

  // Income & tax
  lines.push("## Indkomst og skat")
  if (input.hasTax) {
    lines.push(`- Bruttoindkomst: ${perMonthAndYear(input.grossMonthly)}`)
    lines.push(`- Skat og AM-bidrag: ${perMonthAndYear(input.taxMonthly)}`)
    lines.push(`- Effektiv skatteprocent: ${pct(input.effectiveRate)}`)
    lines.push(
      `- Nettoindkomst efter skat: ${perMonthAndYear(input.budgetIncomeMonthly)}`
    )
    if (input.taxBreakdown && input.taxBreakdown.length > 0) {
      lines.push("- Skatten består af (årligt):")
      for (const t of input.taxBreakdown) {
        lines.push(`  - ${t.label}: ${kr(t.yearly)} kr./år`)
      }
    }
  } else {
    lines.push(
      `- Nettoindkomst: ${perMonthAndYear(input.budgetIncomeMonthly)} ` +
        "(skat er ikke beregnet — nettoløn er indtastet manuelt)"
    )
  }
  lines.push("")

  // Budget
  lines.push("## Budget — månedlige udgifter")
  if (input.categories.length === 0) {
    lines.push("- Ingen udgifter er registreret endnu.")
  } else {
    for (const c of input.categories) {
      lines.push(`- ${c.name}: ${perMonthAndYear(c.monthly)}`)
      for (const it of c.items ?? []) {
        lines.push(
          `  - ${it.label || "(uden navn)"}: ${perMonthAndYear(it.monthly)}`
        )
      }
    }
  }
  lines.push(`- Udgifter i alt: ${perMonthAndYear(input.budgetExpensesMonthly)}`)
  lines.push("")

  // Result
  lines.push("## Resultat")
  const tone =
    input.remainingMonthly < 0 ? "underskud" : "til rådighed/opsparing"
  lines.push(
    `- Beløb ${tone}: ${perMonthAndYear(Math.abs(input.remainingMonthly))}`
  )
  lines.push(`- Opsparingsrate: ${pct(input.savingsRate)}`)
  lines.push("")

  // Request
  lines.push("## Det vil jeg gerne have hjælp til")
  lines.push(
    "1. Vurder om min økonomi er sund og balanceret, og om min opsparingsrate er fornuftig."
  )
  lines.push(
    "2. Peg på de største muligheder for at spare op eller skære i udgifter, prioriteret efter effekt."
  )
  lines.push(
    "3. Foreslå konkrete, realistiske ændringer pr. kategori — gerne med et forslag til et nyt budget."
  )
  if (input.hasTax) {
    lines.push(
      "4. Vurder om der er skattemæssige greb (fradrag, pension m.m.), jeg bør undersøge."
    )
  }
  lines.push(
    "Stil gerne opklarende spørgsmål, hvis du mangler oplysninger for at kunne rådgive mig bedst muligt."
  )

  return lines.join("\n")
}
