import { describe, it, expect } from "vitest"
import {
  LOAN_TYPE_DEFAULTS,
  loanSummary,
  missingSecurityNotice,
  newPlannedLoan,
  normalizeLoans,
  removeLoan,
  repaymentSummary,
  replaceLoan,
  securitySummary,
} from "../loans"
import { DEFAULT_PLANNING_STATE, type PlannedLoan, type PlannedProperty } from "../types"

const at = (fields: Partial<PlannedLoan> = {}): PlannedLoan => ({
  id: "l1",
  propertyId: null,
  label: "Realkreditlån",
  type: "realkredit",
  principal: 2_000_000,
  rate: 0.041,
  termMonths: 360,
  interestOnlyYears: 0,
  bidragssats: 0,
  ...fields,
})

const property = (fields: Partial<PlannedProperty> = {}): PlannedProperty => ({
  id: "prop-a",
  label: "Rækkehuset",
  kind: "helaarsbolig",
  value: 4_000_000,
  landValue: 1_500_000,
  acquisitionAge: 0,
  disposalAge: null,
  ...fields,
})

describe("newPlannedLoan", () => {
  it("borrows nothing until the user says otherwise", () => {
    // An amount the user did not type is one they would have to notice to
    // correct, and a loan of nothing costs nothing in the meantime.
    expect(newPlannedLoan("bank", null).principal).toBe(0)
  })

  it("starts on the rate and term the scalar it replaces used", () => {
    // Both shapes live in the state until the wiring lands, so a hand-added loan
    // has to price the same as the field it stands in for.
    const realkredit = newPlannedLoan("realkredit", null)
    expect(realkredit.rate).toBe(DEFAULT_PLANNING_STATE.mortgageRate)
    expect(realkredit.termMonths).toBe(DEFAULT_PLANNING_STATE.mortgageTermYears * 12)
    const bank = newPlannedLoan("bank", null)
    expect(bank.rate).toBe(DEFAULT_PLANNING_STATE.otherDebtRate)
    expect(bank.termMonths).toBe(DEFAULT_PLANNING_STATE.otherDebtTermYears * 12)
  })

  it("charges no bidrag nobody quoted", () => {
    // The form never asks for a bidragssats, and an invented fee would be
    // charged against the saving every year of the projection.
    expect(newPlannedLoan("realkredit", null).bidragssats).toBe(0)
    expect(newPlannedLoan("bank", null).bidragssats).toBe(0)
  })

  it("repays from the first month", () => {
    expect(newPlannedLoan("realkredit", null).interestOnlyYears).toBe(0)
  })

  it("takes the security it is given", () => {
    expect(newPlannedLoan("realkredit", "prop-a").propertyId).toBe("prop-a")
    expect(newPlannedLoan("bank", null).propertyId).toBeNull()
  })

  it("names itself after its type", () => {
    expect(newPlannedLoan("realkredit", null).label).toBe("Realkreditlån")
    expect(newPlannedLoan("bank", null).label).toBe("Banklån")
  })

  it("gives every entry an identity of its own", () => {
    const a = newPlannedLoan("bank", null)
    const b = newPlannedLoan("bank", null)
    expect(a.id).not.toBe(b.id)
  })
})

describe("replaceLoan", () => {
  it("swaps the entry with that id and leaves the rest alone", () => {
    const list = [at({ id: "a" }), at({ id: "b" })]
    const next = replaceLoan(list, at({ id: "b", principal: 900_000 }))
    expect(next.map((l) => l.principal)).toEqual([2_000_000, 900_000])
    expect(list[1].principal).toBe(2_000_000) // the input is untouched
  })

  it("leaves the list alone when the entry is already gone", () => {
    // A stale edit racing a removal must not resurrect the debt.
    const list = [at({ id: "a" })]
    expect(replaceLoan(list, at({ id: "gone" }))).toEqual(list)
  })
})

describe("removeLoan", () => {
  it("drops only the entry with that id", () => {
    const list = [at({ id: "a" }), at({ id: "b" }), at({ id: "c" })]
    expect(removeLoan(list, "b").map((l) => l.id)).toEqual(["a", "c"])
  })
})

describe("repaymentSummary", () => {
  it("says a whole-year term in years", () => {
    expect(repaymentSummary(at({ termMonths: 360 }), 42)).toBe("30 år")
  })

  it("says a part-year term in months", () => {
    // A loan part-way through its life rarely has a whole number of years left,
    // and rounding it to one would move the maturity the projection uses.
    expect(repaymentSummary(at({ termMonths: 51 }), 42)).toBe("51 md.")
  })

  it("names the age the afdrag start at, not the years until they do", () => {
    // The cliff is the reason to model afdragsfrihed at all, and it lands on the
    // same age axis the projection is drawn on.
    expect(repaymentSummary(at({ interestOnlyYears: 5 }), 42)).toBe(
      "30 år · afdragsfri til du fylder 47"
    )
  })

  it("says nothing about afdragsfrihed when there is none", () => {
    expect(repaymentSummary(at({ interestOnlyYears: 0 }), 42)).not.toMatch(
      /afdragsfri/
    )
  })
})

describe("securitySummary", () => {
  it("names the property the loan is secured on", () => {
    expect(securitySummary(at({ propertyId: "prop-a" }), [property()])).toBe(
      "Rækkehuset"
    )
  })

  it("says so when nothing secures it", () => {
    expect(securitySummary(at({ propertyId: null }), [property()])).toBe(
      "Uden pant"
    )
  })

  it("never passes a dangling link off as unsecured debt", () => {
    // A loan on a property the plan no longer has and a loan on nothing are
    // different debts; only the user can say which this one is.
    const orphan = securitySummary(at({ propertyId: "prop-gone" }), [property()])
    expect(orphan).toBe("Ukendt bolig")
    expect(orphan).not.toBe("Uden pant")
  })

  it("still has something to show for a property being renamed to nothing", () => {
    expect(
      securitySummary(at({ propertyId: "prop-a" }), [property({ label: "" })])
    ).toBe("(uden navn)")
  })
})

describe("loanSummary", () => {
  it("puts the type, the balance, the rate, the term and the security on one line", () => {
    const line = loanSummary(
      at({ propertyId: "prop-a", principal: 1_800_000, rate: 0.041 }),
      [property()],
      42
    )
    expect(line).toContain("Realkreditlån")
    expect(line).toMatch(/1[.\s ]?800[.\s ]?000/)
    expect(line).toContain("4,10%")
    expect(line).toContain("30 år")
    expect(line).toContain("Rækkehuset")
  })

  it("quotes bidrag beside the rate rather than inside it", () => {
    // Bidrag is charged on the balance like interest but buys no rentefradrag,
    // so a household comparing offers needs both figures it was quoted.
    const line = loanSummary(at({ rate: 0.041, bidragssats: 0.006 }), [], 42)
    expect(line).toContain("4,10%")
    expect(line).toContain("0,60% bidrag")
  })

  it("leaves out a bidrag that is not charged", () => {
    expect(loanSummary(at({ bidragssats: 0 }), [], 42)).not.toMatch(/bidrag/)
  })
})

describe("missingSecurityNotice", () => {
  it("says nothing about a list whose security all checks out", () => {
    expect(missingSecurityNotice([], [])).toBeNull()
    expect(missingSecurityNotice([at({ propertyId: null })], [])).toBeNull()
    expect(
      missingSecurityNotice([at({ propertyId: "prop-a" })], [property()])
    ).toBeNull()
  })

  it("asks about a loan left behind by a property that was removed", () => {
    const notice = missingSecurityNotice(
      [at({ id: "a", propertyId: null }), at({ id: "b", propertyId: "prop-b" })],
      [property({ id: "prop-a" })]
    )
    expect(notice).toContain("bolig")
    expect(notice).toContain("uden pant")
  })
})

describe("normalizeLoans", () => {
  const legacy = {
    version: 2,
    mortgageBalance: 2_000_000,
    mortgageRate: 0.041,
    mortgageTermYears: 30,
    mortgageBidragssats: 0.006,
    mortgageInterestOnlyYears: 5,
    otherDebtBalance: 150_000,
    otherDebtRate: 0.07,
    otherDebtTermYears: 10,
  }
  const home = property({ id: "prop-home" })

  describe("migrating the two legacy debts", () => {
    it("carries every field of the mortgage into the list", () => {
      // Everything saved before this list existed is a household with one
      // realkreditlån, and it has to come back owing exactly the same loan.
      const [mortgage] = normalizeLoans(legacy, [home])
      expect(mortgage).toMatchObject({
        type: "realkredit",
        label: "Realkreditlån",
        principal: 2_000_000,
        rate: 0.041,
        termMonths: 360,
        interestOnlyYears: 5,
        bidragssats: 0.006,
      })
      expect(mortgage.id).toBeTruthy()
    })

    it("secures the mortgage on the home it was always secured on", () => {
      // The first property is the one `mortgageBalance` describes; a loan
      // secured on the summer house instead would move the household's equity.
      const loans = normalizeLoans(legacy, [
        home,
        property({ id: "prop-summer", kind: "fritidsbolig" }),
      ])
      expect(loans[0].propertyId).toBe("prop-home")
    })

    it("leaves a renter's mortgage secured on nothing rather than inventing a home", () => {
      // A plan can carry a balance with no property behind it — a loan inferred
      // from the interest on /skat, with no boligværdi ever entered.
      expect(normalizeLoans(legacy, [])[0].propertyId).toBeNull()
    })

    it("carries the other debt over as an unsecured bank loan", () => {
      const [, other] = normalizeLoans(legacy, [home])
      expect(other).toMatchObject({
        type: "bank",
        propertyId: null,
        principal: 150_000,
        rate: 0.07,
        termMonths: 120,
        interestOnlyYears: 0,
        bidragssats: 0,
      })
    })

    it("does not name the other debt after a bank it may not come from", () => {
      // The field lumped student, car and consumer debt together, so "Banklån"
      // would put a word in the user's mouth.
      expect(normalizeLoans(legacy, [home])[1].label).toBe("Anden gæld")
    })

    it("drops a debt the household does not have", () => {
      // A zero balance is no loan; keeping it would leave a ghost row in the
      // form and a loan of nothing in the projection.
      expect(
        normalizeLoans({ ...legacy, otherDebtBalance: 0 }, [home]).map(
          (l) => l.type
        )
      ).toEqual(["realkredit"])
      expect(
        normalizeLoans({ ...legacy, mortgageBalance: 0 }, [home]).map(
          (l) => l.type
        )
      ).toEqual(["bank"])
      expect(
        normalizeLoans(
          { ...legacy, mortgageBalance: 0, otherDebtBalance: 0 },
          [home]
        )
      ).toEqual([])
    })

    it("owes nothing on a plan that says nothing about debt", () => {
      expect(normalizeLoans({}, [home])).toEqual([])
      expect(normalizeLoans(null, [])).toEqual([])
      expect(normalizeLoans("plan", [])).toEqual([])
    })

    it("reads a negative balance as no loan at all", () => {
      expect(
        normalizeLoans({ mortgageBalance: -1, otherDebtBalance: -1 }, [home])
      ).toEqual([])
    })

    it("gives the two migrated loans identities of their own", () => {
      const [mortgage, other] = normalizeLoans(legacy, [home])
      expect(mortgage.id).not.toBe(other.id)
    })

    it("falls back to the same rate and term `normalizePlanning` would", () => {
      const [mortgage, other] = normalizeLoans(
        { mortgageBalance: 1, otherDebtBalance: 1 },
        [home]
      )
      expect(mortgage.rate).toBe(DEFAULT_PLANNING_STATE.mortgageRate)
      expect(mortgage.termMonths).toBe(
        DEFAULT_PLANNING_STATE.mortgageTermYears * 12
      )
      expect(other.rate).toBe(DEFAULT_PLANNING_STATE.otherDebtRate)
      expect(other.termMonths).toBe(
        DEFAULT_PLANNING_STATE.otherDebtTermYears * 12
      )
    })

    it("bounds a legacy term the way the field it comes from was bounded", () => {
      const [long] = normalizeLoans(
        { mortgageBalance: 1, mortgageTermYears: 99 },
        [home]
      )
      expect(long.termMonths).toBe(40 * 12)
      const [short] = normalizeLoans(
        { mortgageBalance: 1, mortgageTermYears: 0 },
        [home]
      )
      expect(short.termMonths).toBe(12)
    })

    it("keeps afdragsfrihed inside the term it was granted on", () => {
      // Longer than the loan itself describes a loan that is never repaid.
      const [loan] = normalizeLoans(
        {
          mortgageBalance: 1,
          mortgageTermYears: 10,
          mortgageInterestOnlyYears: 30,
        },
        [home]
      )
      expect(loan.interestOnlyYears).toBe(10)
    })
  })

  describe("reading a list that is already there", () => {
    it("keeps the list a migrated plan already has", () => {
      const saved = {
        loans: [
          {
            id: "loan-a",
            propertyId: "prop-home",
            label: "Realkredit i huset",
            type: "realkredit",
            principal: 2_400_000,
            rate: 0.038,
            termMonths: 342,
            interestOnlyYears: 3,
            bidragssats: 0.0055,
          },
          {
            id: "loan-b",
            propertyId: null,
            label: "Billån",
            type: "bank",
            principal: 180_000,
            rate: 0.089,
            termMonths: 60,
            interestOnlyYears: 0,
            bidragssats: 0,
          },
        ],
      }
      expect(normalizeLoans(saved, [home])).toEqual(saved.loans)
    })

    it("ignores the legacy scalars once a list is present", () => {
      // Keyed on the shape rather than on `version`, because a blob reaches this
      // from localStorage, Supabase or an MCP client with any version field it
      // likes. A list present is a list already migrated — migrating again would
      // double the household's debt on every load.
      const both = normalizeLoans(
        { ...legacy, version: 1, loans: [{ type: "bank", principal: 50_000 }] },
        [home]
      )
      expect(both).toHaveLength(1)
      expect(both[0]).toMatchObject({ type: "bank", principal: 50_000 })
    })

    it("migrates on the shape whatever the version claims to be", () => {
      const ahead = normalizeLoans({ ...legacy, version: 9 }, [home])
      expect(ahead.map((l) => l.type)).toEqual(["realkredit", "bank"])
    })

    it("hands back what it was given", () => {
      // The wiring will normalize a blob it has already normalized once —
      // the plan is saved and reloaded — so the second pass must be a no-op.
      const once = normalizeLoans(legacy, [home])
      expect(normalizeLoans({ loans: once }, [home])).toEqual(once)
    })

    it("keeps a row the user has just added and not yet filled in", () => {
      // Unlike a legacy zero balance, this is a loan being typed rather than a
      // loan the household does not have; dropping it would delete the row out
      // from under the form on the next reload.
      const [blank] = normalizeLoans(
        { loans: [newPlannedLoan("bank", null)] },
        [home]
      )
      expect(blank.principal).toBe(0)
    })

    it("drops entries that describe no loan at all", () => {
      expect(
        normalizeLoans({ loans: [null, "lån", 3, {}] }, [home])
      ).toHaveLength(1) // only the object survives, defaulted to a 0 kr. loan
    })

    it("reads a loans field that is not a list as no list at all", () => {
      expect(normalizeLoans({ loans: "lån" }, [home])).toEqual([])
      expect(
        normalizeLoans({ ...legacy, loans: "lån" }, [home]).map((l) => l.type)
      ).toEqual(["realkredit", "bank"])
    })

    it("keeps a link to a property the plan no longer has", () => {
      // Dropping it silently would turn a mis-click into an unsecured loan the
      // user never described; `missingSecurityNotice` asks them instead.
      const [loan] = normalizeLoans(
        { loans: [{ propertyId: "prop-gone", principal: 1 }] },
        [home]
      )
      expect(loan.propertyId).toBe("prop-gone")
    })

    it("mints an id only for an entry that arrives without one", () => {
      const [minted, kept] = normalizeLoans(
        { loans: [{ principal: 1 }, { id: "loan-b", principal: 1 }] },
        [home]
      )
      expect(minted.id).toBeTruthy()
      expect(kept.id).toBe("loan-b")
    })

    it("names an entry after its type when it has no name of its own", () => {
      const [blank, whitespace] = normalizeLoans(
        {
          loans: [
            { type: "bank", principal: 1 },
            { type: "realkredit", label: "   ", principal: 1 },
          ],
        },
        [home]
      )
      expect(blank.label).toBe("Banklån")
      expect(whitespace.label).toBe("Realkreditlån")
    })

    it("reads an unrecognised type as the realkreditlån it most likely is", () => {
      const [loan] = normalizeLoans(
        { loans: [{ type: "prioritetslån", principal: 1 }] },
        [home]
      )
      expect(loan.type).toBe("realkredit")
    })

    it("never carries a negative amount into the projection", () => {
      const [loan] = normalizeLoans(
        { loans: [{ principal: -1, rate: -1, bidragssats: -1 }] },
        [home]
      )
      expect(loan.principal).toBe(0)
      expect(loan.rate).toBe(0)
      expect(loan.bidragssats).toBe(0)
    })

    it("bounds both types' rates the same, so changing the type rewrites nothing", () => {
      // The type is a dropdown now. A bound that moved with it would silently
      // rewrite a rate the user never touched when they corrected the type.
      for (const type of ["realkredit", "bank"]) {
        const [loan] = normalizeLoans(
          { loans: [{ type, rate: 0.3, principal: 1 }] },
          [home]
        )
        expect(loan.rate).toBe(0.3)
      }
    })

    it("charges no bidrag on a banklån, whatever the blob says", () => {
      // Bidrag is what a realkreditinstitut charges for lending against
      // property; a bank loan that carried one would be charged a fee that does
      // not exist, every year of the projection.
      const [loan] = normalizeLoans(
        { loans: [{ type: "bank", principal: 1, bidragssats: 0.006 }] },
        [home]
      )
      expect(loan.bidragssats).toBe(0)
    })

    it("holds a term to whole months the annuity step can count down", () => {
      const [loan] = normalizeLoans(
        { loans: [{ principal: 1, termMonths: 60.4 }] },
        [home]
      )
      expect(loan.termMonths).toBe(60)
    })

    it("falls back to the type's rate and term for values it cannot read", () => {
      const [loan] = normalizeLoans(
        { loans: [{ type: "bank", principal: 1, rate: "0,07", termMonths: NaN }] },
        [home]
      )
      expect(loan.rate).toBe(LOAN_TYPE_DEFAULTS.bank.rate)
      expect(loan.termMonths).toBe(LOAN_TYPE_DEFAULTS.bank.termMonths)
    })
  })
})
