# Skatteberegner

Interaktiv dansk skatteberegner for indkomstår 2024–2026, bygget med Next.js, Tailwind CSS og shadcn/ui.

Beregneren er et estimat og erstatter ikke SKATs officielle beregning.

---

## Funktioner

- **Fuld skatteberegning** – AM-bidrag, bundskat, mellemskat, topskat, kommuneskat, kirkeskat, aktieskat og boligskat
- **Forskudsopgørelse import** – Upload din PDF fra SKAT og udfyld felterne automatisk
- **Alle indkomsttyper** – A-indkomst, B-indkomst, overførselsindkomster, kapitalindkomst, aktieindkomst
- **Fradrag** – Beskæftigelsesfradrag, jobfradrag, befordringsfradrag, pensionsfradrag, rentefradrag og mere
- **Boligskat** – Ejendomsværdiskat og grundskyld for helårsbolig og sommerhus
- **Ægtefælle-koordinering** – Uudnyttet mellemskat-bundfradrag overføres til ægtefælle
- **Mørk tilstand** – Tryk `d` for at skifte
- **152 tests** – Alle beregningsmoduler er testet

---

## Kom i gang

### Forudsætninger

- Node.js 20+
- npm

### Installation

```bash
cd skatteudregner
npm install
npm run dev
```

Åbn [http://localhost:3000](http://localhost:3000) i din browser.

### Tilgængelige scripts

| Script | Beskrivelse |
|---|---|
| `npm run dev` | Start udviklingsserver med Turbopack |
| `npm run build` | Byg til produktion |
| `npm run start` | Start produktionsserver |
| `npm test` | Kør tests i watch mode |
| `npm run test:run` | Kør tests én gang |
| `npm run typecheck` | TypeScript typetjek |
| `npm run lint` | ESLint |
| `npm run format` | Prettier formattering |

---

## Projektstruktur

```
skatteudregner/
├── app/
│   ├── layout.tsx          # Root layout med ThemeProvider
│   └── page.tsx            # Hoved-side
├── components/
│   ├── ui/                 # shadcn/ui komponenter (accordion, input, select, ...)
│   └── tax-calculator/
│       ├── tax-form.tsx            # Hoved-formular med accordion-sektioner
│       ├── tax-results.tsx         # Resultater-panel (højre kolonne)
│       ├── pdf-upload.tsx          # Upload af forskudsopgørelse
│       ├── municipality-select.tsx # Kommunevælger med søgning
│       ├── number-input.tsx        # Talindtastning med dansk formatering
│       └── sections/
│           ├── personal-info-section.tsx   # Personlige oplysninger
│           ├── income-section.tsx          # Indkomst
│           ├── deductions-section.tsx      # Pension og fradrag
│           ├── capital-income-section.tsx  # Kapitalindkomst
│           ├── stock-income-section.tsx    # Aktieindkomst
│           └── property-section.tsx        # Bolig
├── hooks/
│   └── use-tax-calculator.ts       # State management og beregnings-hook
├── lib/
│   ├── format.ts                   # Formatering (DKK, procent)
│   ├── pdf/
│   │   ├── parse-forskudsopgoerelse.ts     # PDF-parser
│   │   └── __tests__/
│   └── tax/
│       ├── types.ts                # TypeScript-typer
│       ├── rates.ts                # Skattesatser 2024–2026
│       ├── municipalities.ts       # 294 kommuner med satser
│       ├── defaults.ts             # Standardværdier for input
│       ├── calculator.ts           # Hoved-orkestrator
│       ├── index.ts                # Offentlig API
│       ├── calculations/
│       │   ├── am-bidrag.ts        # AM-bidrag (8%)
│       │   ├── personal-income.ts  # Personlig indkomst
│       │   ├── capital-income.ts   # Kapitalindkomst
│       │   ├── itemized-deductions.ts  # Ligningsmæssige fradrag
│       │   ├── taxable-income.ts   # Skattepligtig indkomst
│       │   ├── income-tax.ts       # Indkomstskat (stat + kommune)
│       │   ├── stock-tax.ts        # Aktieskat
│       │   └── property-tax.ts     # Boligskat
│       └── __tests__/              # 13 testfiler, 152 tests
└── vitest.config.ts
```

---

## Skatteberegning

### Understøttede indkomstår

| År | Bundskat | Mellemskat | Topskat | Top-topskat |
|---|---|---|---|---|
| 2024 | 12,01 % | – | – | – |
| 2025 | 12,01 % | – | – | – |
| 2026 | 12,01 % | 7,5 % (over 641.200 kr.) | 7,5 % (over 777.900 kr.) | 5 % (over 2.592.700 kr.) |

> **Skatteloft 2026:** 44,57 %. Mellemskat er uden for skatteloftet og tillægges separat.

### Beregningsflow

```
Arbejdsindkomst (brutto)
  → AM-bidrag (8 %)
  → Personlig indkomst
  → + Kapitalindkomst
  → − Ligningsmæssige fradrag
  = Skattepligtig indkomst
  → Bundskat + Mellemskat + Topskat
  → + Kommuneskat + Kirkeskat
  → − Personfradragskreditter
  = Samlet indkomstskat
  → + Aktieskat
  → + Boligskat
  = Samlet skat
```

### Fradrag der beregnes automatisk

| Fradrag | Beregning (2026) |
|---|---|
| Beskæftigelsesfradrag | 12,75 % af AM-indkomst + ratepension, maks. 63.300 kr. |
| Jobfradrag | 4,5 % af AM-indkomst, maks. 3.100 kr. |
| Ekstra pensionsfradrag | 12 % af egne pensionsindbetalinger, maks. 7.860 kr. |
| Befordringsfradrag | Km-sats afhængig af afstand og bopælszone |
| Personfradrag (stat) | 12,01 % × 54.100 kr. |
| Personfradrag (kommune) | Kommunesats × 54.100 kr. |

---

## Forskudsopgørelse import

Upload din forskudsopgørelse som PDF fra [skat.dk](https://skat.dk) for automatisk at udfylde felterne.

**Felter der udlæses:**
- Lønindkomst, honorarer og øvrig AM-indkomst
- Overførselsindkomster og SU
- Pensionsindbetalinger (alle typer)
- Kapitalindkomst og renteudgifter
- Aktieindkomst og udbytter
- Ejendomsoplysninger
- Kommunevalg (med fuzzy matching)
- Fødselsdato (fra personnummer)
- Kirkeskat, civilstand, børn

PDF-parseren håndterer SKATs PDF-format inkl. garblede danske tegn.

---

## Kommunedata

294 kommuner med data for 2024, 2025 og 2026:

- Kommuneskatteprocent (23–26 %)
- Kirkeskatteprocent (0,4–1,3 %)
- Grundskyldspromille (3–17 ‰)
- Landzonemarkering (påvirker befordringsfradrag)

---

## Tests

```bash
npm run test:run
```

```
Test Files  13 passed
Tests       152 passed
```

Testfiler dækker alle beregningsmoduler samt PDF-parsing og formatering. Excel-scenarierne i `excel-scenarios.test.ts` verificerer beregneren mod kendte skatteberegninger.

---

## Teknologi

| Kategori | Teknologi |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) med App Router |
| UI | [shadcn/ui](https://ui.shadcn.com) + [Radix UI](https://radix-ui.com) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) |
| Ikoner | [Lucide React](https://lucide.dev) |
| Mørk tilstand | [next-themes](https://github.com/pacocoursey/next-themes) |
| PDF-parsing | [pdfjs-dist](https://mozilla.github.io/pdf.js/) |
| Tests | [Vitest](https://vitest.dev) |
| Sprog | TypeScript |
