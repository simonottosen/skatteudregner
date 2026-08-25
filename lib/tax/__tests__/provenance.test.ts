import { describe, it, expect } from "vitest"
import {
  ASSUMED_FIELDS,
  EMPTY_PROVENANCE,
  assumedFieldLabels,
  assumedFields,
  dismissNotice,
  documentFields,
  fieldOrigin,
  provenanceSummary,
  assumptionNotice,
  withImport,
  withUserEdit,
} from "../provenance"

/** What a payslip import supplies: money only, none of the personal fields. */
const PAYSLIP_DATA = {
  year: 2026,
  workIncome: 600_000,
  employeePension: 30_000,
  employerPension: 60_000,
  atpEmployee: 1_188,
}

/** A forskudsopgørelse also carries the three personal fields. */
const FORSKUD_DATA = {
  ...PAYSLIP_DATA,
  municipality: "Aarhus",
  churchMember: true,
  birthDate: "1991-07-02",
}

describe("fieldOrigin", () => {
  it("treats an untouched field as a default, not as an answer", () => {
    expect(fieldOrigin(EMPTY_PROVENANCE, "municipality")).toBe("default")
  })

  it("records what a document filled and what it did not", () => {
    const p = withImport(EMPTY_PROVENANCE, PAYSLIP_DATA, "loenseddel")
    expect(fieldOrigin(p, "workIncome")).toBe("document")
    expect(fieldOrigin(p, "municipality")).toBe("default")
  })

  it("counts a value the user typed over as theirs, not the document's", () => {
    const imported = withImport(EMPTY_PROVENANCE, PAYSLIP_DATA, "loenseddel")
    expect(fieldOrigin(withUserEdit(imported, "workIncome"), "workIncome")).toBe(
      "user"
    )
  })

  it("ignores keys the reducer would skip, so nothing is claimed that never landed", () => {
    // The reducer skips undefined values and merges property separately, so
    // reporting either as "read from your document" would be a lie.
    const p = withImport(
      EMPTY_PROVENANCE,
      { workIncome: 500_000, birthDate: undefined, property: { propertyValue: 3_000_000 } },
      "forskudsopgoerelse"
    )
    expect(documentFields(p)).toEqual(["workIncome"])
    expect(fieldOrigin(p, "birthDate")).toBe("default")
  })
})

describe("withUserEdit", () => {
  it("returns the same object when the field is already the user's", () => {
    // This runs on every keystroke and callers memoise on the reference.
    const once = withUserEdit(EMPTY_PROVENANCE, "municipality")
    expect(withUserEdit(once, "municipality")).toBe(once)
  })
})

describe("assumedFields", () => {
  it("flags all three after a payslip, which carries none of them", () => {
    const p = withImport(EMPTY_PROVENANCE, PAYSLIP_DATA, "loenseddel")
    expect(assumedFields(p)).toEqual([...ASSUMED_FIELDS])
    expect(assumedFieldLabels(p)).toEqual([
      "Kommune",
      "Medlem af folkekirken",
      "Fødselsdato",
    ])
  })

  it("flags nothing after a forskudsopgørelse, which carries all three", () => {
    const p = withImport(EMPTY_PROVENANCE, FORSKUD_DATA, "forskudsopgoerelse")
    expect(assumedFields(p)).toEqual([])
    expect(assumptionNotice(p)).toBeNull()
  })

  it("flags only what a partly-recognised document missed", () => {
    // The reason this is derived instead of "payslip ⇒ these three": a
    // forskudsopgørelse whose municipality did not parse lands here.
    const noMunicipality = { ...PAYSLIP_DATA, churchMember: true, birthDate: "1991-07-02" }
    const p = withImport(EMPTY_PROVENANCE, noMunicipality, "forskudsopgoerelse")
    expect(assumedFields(p)).toEqual(["municipality"])
  })

  it("shrinks as the user fills the fields in", () => {
    let p = withImport(EMPTY_PROVENANCE, PAYSLIP_DATA, "loenseddel")
    p = withUserEdit(p, "municipality")
    p = withUserEdit(p, "birthDate")
    expect(assumedFields(p)).toEqual(["churchMember"])
    expect(assumptionNotice(p)).not.toBeNull()

    // Answering the last one retires the notice rather than leaving it to be
    // dismissed — it has nothing left to point at.
    p = withUserEdit(p, "churchMember")
    expect(assumptionNotice(p)).toBeNull()
  })

  it("keeps an answer the user gave before uploading", () => {
    // Importing a payslip must not re-flag a municipality they already picked.
    const chosen = withUserEdit(EMPTY_PROVENANCE, "municipality")
    const p = withImport(chosen, PAYSLIP_DATA, "loenseddel")
    expect(assumedFields(p)).toEqual(["churchMember", "birthDate"])
  })
})

describe("assumptionNotice", () => {
  it("stays quiet before any import, when every field is still a default", () => {
    // Everything is assumed at this point, but there is no import receipt to
    // qualify — the notice would be scolding the user for not having started.
    expect(assumedFields(EMPTY_PROVENANCE)).toEqual([...ASSUMED_FIELDS])
    expect(assumptionNotice(EMPTY_PROVENANCE)).toBeNull()
  })

  it("names every field a payslip left as a guess", () => {
    const notice = assumptionNotice(
      withImport(EMPTY_PROVENANCE, PAYSLIP_DATA, "loenseddel")
    )
    expect(notice?.title).toBe("Tjek disse 3 felter")
    expect(notice?.subtitle).toContain(
      "Kommune, Medlem af folkekirken, Fødselsdato stod ikke i dokumentet"
    )
    expect(notice?.subtitle).toContain("Værdierne herunder er standardværdier")
  })

  it("reads as Danish when only one field is left", () => {
    let p = withImport(EMPTY_PROVENANCE, PAYSLIP_DATA, "loenseddel")
    p = withUserEdit(p, "churchMember")
    p = withUserEdit(p, "birthDate")
    const notice = assumptionNotice(p)
    expect(notice?.title).toBe("Tjek dette felt")
    expect(notice?.subtitle).toBe(
      "Kommune stod ikke i dokumentet. Værdien herunder er en standardværdi" +
        " — ikke noget vi har læst fra din PDF — og den påvirker skatten mærkbart."
    )
  })

  it("stays dismissed once dismissed", () => {
    const p = dismissNotice(withImport(EMPTY_PROVENANCE, PAYSLIP_DATA, "loenseddel"))
    expect(assumptionNotice(p)).toBeNull()
  })

  it("comes back for a new import, which has its own assumptions to check", () => {
    const dismissed = dismissNotice(
      withImport(EMPTY_PROVENANCE, PAYSLIP_DATA, "loenseddel")
    )
    const reimported = withImport(dismissed, PAYSLIP_DATA, "loenseddel")
    expect(assumptionNotice(reimported)).not.toBeNull()
  })
})

describe("provenanceSummary", () => {
  it("says nothing before an import", () => {
    expect(provenanceSummary(EMPTY_PROVENANCE)).toBeNull()
  })

  it("names the document, what it read, and what is still assumed", () => {
    const p = withImport(EMPTY_PROVENANCE, PAYSLIP_DATA, "loenseddel")
    expect(provenanceSummary(p)).toBe(
      "Baseret på lønseddel · 5 felter læst · 3 antagelser"
    )
  })

  it("drops the assumption count when the document answered everything", () => {
    const p = withImport(EMPTY_PROVENANCE, FORSKUD_DATA, "forskudsopgoerelse")
    expect(provenanceSummary(p)).toBe("Baseret på forskudsopgørelse · 8 felter læst")
  })

  it("uses the singular for one field and one assumption", () => {
    let p = withImport(EMPTY_PROVENANCE, { workIncome: 1 }, "loenseddel")
    p = withUserEdit(p, "municipality")
    p = withUserEdit(p, "churchMember")
    expect(provenanceSummary(p)).toBe("Baseret på lønseddel · 1 felt læst · 1 antagelse")
  })

  it("stops counting a field the user has overwritten as the document's", () => {
    const imported = withImport(EMPTY_PROVENANCE, PAYSLIP_DATA, "loenseddel")
    expect(documentFields(withUserEdit(imported, "workIncome"))).toHaveLength(4)
  })
})
