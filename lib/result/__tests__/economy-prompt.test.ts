import { describe, it, expect } from "vitest"
import { buildEconomyPrompt, type EconomyPromptInput } from "../economy-prompt"

const base: EconomyPromptInput = {
  mode: "single",
  people: [{ name: "Person 1", monthlyNet: 30000, source: "skat" }],
  hasTax: true,
  grossMonthly: 45000,
  taxMonthly: 15000,
  effectiveRate: 0.3333,
  budgetIncomeMonthly: 30000,
  budgetExpensesMonthly: 20000,
  remainingMonthly: 10000,
  savingsRate: 0.3333,
  categories: [
    { name: "Bolig", monthly: 12000 },
    { name: "Mad", monthly: 8000 },
  ],
}

describe("buildEconomyPrompt", () => {
  it("includes household, tax, budget, result and request sections", () => {
    const prompt = buildEconomyPrompt(base)
    expect(prompt).toContain("## Husstand")
    expect(prompt).toContain("## Indkomst og skat")
    expect(prompt).toContain("## Budget — månedlige udgifter")
    expect(prompt).toContain("## Resultat")
    expect(prompt).toContain("## Det vil jeg gerne have hjælp til")
  })

  it("renders both monthly and yearly figures and Danish formatting", () => {
    const prompt = buildEconomyPrompt(base)
    // 12.000 kr./md. (144.000 kr./år)
    expect(prompt).toContain("Bolig: 12.000 kr./md. (144.000 kr./år)")
    expect(prompt).toContain("Udgifter i alt: 20.000 kr./md. (240.000 kr./år)")
    expect(prompt).toContain("Effektiv skatteprocent: 33,3 %")
    expect(prompt).toContain("Opsparingsrate: 33,3 %")
  })

  it("explains when tax has not been calculated", () => {
    const prompt = buildEconomyPrompt({
      ...base,
      hasTax: false,
      people: [{ name: "Anna", monthlyNet: 30000, source: "manual" }],
    })
    expect(prompt).toContain("skat er ikke beregnet")
    expect(prompt).not.toContain("Effektiv skatteprocent")
    expect(prompt).toContain("manuelt indtastet nettoløn")
  })

  it("frames a negative remaining as a deficit", () => {
    const prompt = buildEconomyPrompt({
      ...base,
      budgetExpensesMonthly: 35000,
      remainingMonthly: -5000,
      savingsRate: -0.1667,
    })
    expect(prompt).toContain("Beløb underskud: 5.000 kr./md.")
  })

  it("handles an empty budget", () => {
    const prompt = buildEconomyPrompt({
      ...base,
      categories: [],
      budgetExpensesMonthly: 0,
      remainingMonthly: 30000,
      savingsRate: 1,
    })
    expect(prompt).toContain("Ingen udgifter er registreret endnu.")
  })
})
