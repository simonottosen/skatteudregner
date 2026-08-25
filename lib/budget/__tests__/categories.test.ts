import { describe, it, expect } from "vitest"
import {
  DEFAULT_CATEGORIES,
  UNCATEGORIZED_ID,
  guessCategory,
  looksLikeSavings,
  looksLikeSinkingFund,
  suggestCategoryKind,
} from "../categories"

describe("looksLikeSavings", () => {
  it("matches money the household puts aside", () => {
    for (const label of [
      "Opsparing",
      "Opsparing og buffer",
      "Buffer",
      "Nødopsparing",
      "Børneopsparing",
      "Aktiesparekonto",
      "Investering",
    ]) {
      expect(looksLikeSavings(label)).toBe(true)
    }
  })

  it("does not match the Danish false friends of “spar”", () => {
    // A bank — an income or transfer line, not savings.
    expect(looksLikeSavings("Spar Nord")).toBe(false)
    // Also a bank.
    expect(looksLikeSavings("Sparekasse Sjælland")).toBe(false)
    expect(looksLikeSavings("Sparekassen")).toBe(false)
    // Dinner.
    expect(looksLikeSavings("Spareribs")).toBe(false)
  })

  it("does not match unrelated descriptions", () => {
    expect(looksLikeSavings("Dagligvarer")).toBe(false)
    expect(looksLikeSavings("Husleje")).toBe(false)
  })

  it("lets a strong keyword win over the deny list", () => {
    // The exclusion tier only guards the weak "spar" stem; an explicit
    // "opsparing" next to a bank name is still savings.
    expect(looksLikeSavings("Nordea opsparing")).toBe(true)
    expect(looksLikeSavings("Opsparing i Spar Nord")).toBe(true)
  })
})

describe("looksLikeSinkingFund", () => {
  it("matches wording that says the money is set aside", () => {
    for (const label of [
      "Hensættelser",
      "Hensat til bilreparation",
      "Uforudsete udgifter",
    ]) {
      expect(looksLikeSinkingFund(label)).toBe(true)
    }
  })

  it("matches a named bill once the label also says it is saved up", () => {
    for (const label of [
      "Opsparing til tandlæge",
      "Bilreparation (opsparing)",
      "Buffer til vedligehold",
    ]) {
      expect(looksLikeSinkingFund(label)).toBe(true)
    }
  })

  /**
   * The naming of a bill is not evidence that the money is reserved rather than
   * spent. Getting this wrong is not symmetric: a consumption line mis-tagged
   * `sinking` leaves `consumptionExpenses` and so inflates `surplus`, which is
   * the same overstatement of free money that the opsparing double count was.
   * An untagged category behaves exactly as it did before v6, so being wrong in
   * this direction costs nothing.
   */
  it("does not match a bill that is merely named", () => {
    for (const label of [
      "Tandlæge",
      "Bilreparation",
      "Vedligehold",
      "Selvrisiko",
    ]) {
      expect(looksLikeSinkingFund(label)).toBe(false)
    }
  })

  it("does not match ordinary consumption", () => {
    expect(looksLikeSinkingFund("Dagligvarer")).toBe(false)
    expect(looksLikeSinkingFund("Opsparing")).toBe(false)
  })

  it("does not let the “spar” false friends promote a bill", () => {
    // "spar" is excluded here for the same reason as in looksLikeSavings, so a
    // repair paid to a bank-named workshop stays consumption.
    expect(looksLikeSinkingFund("Reparation betalt via Spar Nord")).toBe(false)
  })
})

describe("suggestCategoryKind", () => {
  it("tags savings and sinking funds, and leaves the rest untagged", () => {
    expect(suggestCategoryKind("Opsparing")).toBe("savings")
    expect(suggestCategoryKind("Hensat til bilreparation")).toBe("sinking")
    expect(suggestCategoryKind("Mad og dagligvarer")).toBeUndefined()
    expect(suggestCategoryKind("Spar Nord")).toBeUndefined()
  })

  /**
   * Normalization fills a missing kind from the name alone, so an ambiguous
   * guess silently reclassifies a category the user already had. Untagged is
   * the safe answer: it reproduces pre-v6 behaviour exactly, and the user can
   * still tag it deliberately.
   */
  it("leaves an ambiguous bill name untagged rather than guessing", () => {
    expect(suggestCategoryKind("Tandlæge")).toBeUndefined()
    expect(suggestCategoryKind("Bilreparation")).toBeUndefined()
    expect(suggestCategoryKind("Vedligehold")).toBeUndefined()
  })

  it("prefers the sinking fund when both read as saving", () => {
    // Earmarked for a specific bill, so it is not long-term saving.
    expect(suggestCategoryKind("Opsparing til bilreparation")).toBe("sinking")
  })

  it("agrees with the tags the default categories ship with", () => {
    // Opsparing is the only default that is not consumption, and the heuristic
    // reaches the same verdict from the names alone — so a budget saved before
    // v6 lands on exactly these tags when it is normalized.
    expect(DEFAULT_CATEGORIES.filter((c) => c.kind).map((c) => c.id)).toEqual([
      "opsparing",
    ])
    for (const c of DEFAULT_CATEGORIES) {
      expect(suggestCategoryKind(c.name)).toBe(c.kind)
    }
  })
})

describe("guessCategory", () => {
  it("routes common Danish expense labels to their category", () => {
    expect(guessCategory("Bilforsikring")).toBe("transport")
    expect(guessCategory("Indboforsikring")).toBe("forsikring")
    expect(guessCategory("Husleje / boliglån")).toBe("bolig")
    expect(guessCategory("Netflix")).toBe("abonnementer")
    expect(guessCategory("Dagligvarer")).toBe("mad")
    expect(guessCategory("Børnehave")).toBe("boern")
    expect(guessCategory("Tøj og sko")).toBe("personligt")
    expect(guessCategory("Ferie")).toBe("fritid")
    expect(guessCategory("Opsparing og buffer")).toBe("opsparing")
  })

  it("falls back to the catch-all when nothing matches", () => {
    expect(guessCategory("Whatever")).toBe(UNCATEGORIZED_ID)
    expect(guessCategory("")).toBe(UNCATEGORIZED_ID)
  })

  it("no longer buckets the “spar” false friends as savings", () => {
    // These were all classified as Opsparing by the bare substring match.
    expect(guessCategory("Spar Nord")).not.toBe("opsparing")
    expect(guessCategory("Sparekassen")).not.toBe("opsparing")
    expect(guessCategory("Spareribs")).not.toBe("opsparing")
  })

  it("keeps a holiday fund under Fritid rather than Opsparing", () => {
    // "Ferie (opsparing)" is generated by lib/budget/generate-budget.
    expect(guessCategory("Ferie (opsparing)")).toBe("fritid")
  })
})
