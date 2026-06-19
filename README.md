# Skatteberegner & Budget

Interaktiv dansk skatte- og budgetapp for indkomstår 2024–2026, bygget med Next.js og IBM Carbon Design System.

Appen består af fire moduler — **Skat**, **Budget**, **Resultat** og **Planlægning** — der deler data: din nettoløn fra skatteberegningen kan bruges direkte i budgettet, resultatsiden samler det hele, og planlægningssiden simulerer din formue mange år frem. Data gemmes lokalt i browseren og kan synkroniseres på tværs af enheder med en (valgfri) konto.

Beregneren er et estimat og erstatter ikke SKATs officielle beregning.

---

## Funktioner

### Skat

- **Fuld skatteberegning** – AM-bidrag, bundskat, mellemskat, topskat, kommuneskat, kirkeskat, aktieskat og boligskat
- **To personer** – Beregn for en husstand med to indkomster og skift mellem dem
- **Forskudsopgørelse import** – Upload din PDF fra SKAT og udfyld felterne automatisk
- **Lønseddel-sammenligning** – Upload din lønseddel og se forventet vs. faktisk betalt skat hen over året, inkl. estimeret restskat/overskydende skat
- **OCR-fallback** – Billed-baserede PDF'er (uden tekstlag) læses automatisk med tesseract.js
- **Alle indkomsttyper** – A-indkomst, B-indkomst, overførselsindkomster, kapitalindkomst, aktieindkomst
- **Fradrag** – Beskæftigelsesfradrag, jobfradrag, befordringsfradrag, pensionsfradrag, rentefradrag og mere
- **Boligskat** – Ejendomsværdiskat og grundskyld for helårsbolig og sommerhus
- **Ægtefælle-koordinering** – Uudnyttet mellemskat-bundfradrag overføres til ægtefælle

### Budget

- **Kategoriserede udgifter** – Grupperet i kategorier (bolig, forsikring, transport, mad …) med træk-og-slip mellem kategorier og dine egne tilpassede kategorier
- **Husstandstyper** – Én person, to personer med delte udgifter, eller to personer med separat økonomi
- **Indkomstkilde** – Brug nettolønnen fra skatteberegneren eller indtast den manuelt
- **Startbudget-guide** – Generér et komplet månedsbudget ud fra danske gennemsnit. Boligudgiften anslås som renter + afdrag ud fra dine renteudgifter i skatteberegningen, og en livsstils-skala justerer valgfrie poster (mad, restaurant, ferie m.m.)

### Resultat

- **Nøgletal** – Indkomst, udgifter, til rådighed, opsparingsrate og effektiv skat
- **Grafer** – Skat vs. nettoindkomst, fordeling pr. kategori og forbrug pr. kategori
- **Indsigt** – Automatiske observationer om budget, største kategori og skattetryk
- **Måned/år** – Skift mellem månedlige og årlige tal

### Planlægning

- **Formue-simulering** – Projicér din samlede formue (investeringer + friværdi i bolig) mange år frem, år for år
- **Pre-udfyldt** – Månedlig opsparing, boligværdi og restgæld hentes automatisk fra budget- og skattesiderne (kan rettes frit)
- **Antagelser** – Afkast på bolig/investeringer, gebyr, volatilitet, inflation og opsparingsvækst (med danske standardværdier, vist i procent)
- **Usikkerhedsbånd** – Et 10–90 % konfidensbånd (Monte Carlo) omkring den forventede kurve, plus markør for økonomisk uafhængighed (FI) og pensionsalder
- **Pension** – Ratepension, livrente og aldersopsparing (saldi, indbetalinger, afkast, udbetalingsår); appen beregner indkomst som pensionist inkl. folkepension med modregning (aldersopsparing er fritaget). Ved pensionsalderen stopper opsparingen, og pensionsindkomsten dækker forbruget
- **Større livsbegivenheder** – Tilføj engangsudgifter (fx bryllup), arv/bonus, ændret opsparing, eller en bolighandel (sælg → køb nyt med valgt belåningsgrad og afkast)
- **Scenarier** – Gem navngivne "hvad-nu-hvis" (fx en lønstigning du sparer op) og sammenlign dem med basisplanen side om side. Kan også oprettes af en AI-assistent via MCP-serveren (se nedenfor)
- **Visninger** – Samlet / detaljeret og nominelt / nutidskroner

### Generelt

- **Konto & synkronisering** – Valgfri e-mail/adgangskode-login (Supabase) gemmer dine data i skyen; ellers gemmes alt lokalt i browseren
- **Mørk tilstand** – Tryk `d` for at skifte
- **249 tests** – Beregnings-, budget-, planlægnings- og PDF-moduler er testet

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

Appen virker uden konfiguration — den gemmer data lokalt i browseren. Konto-login er valgfrit (se [Supabase](#supabase-valgfri)).

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

## Supabase (valgfri)

Login og synkronisering på tværs af enheder bruger Supabase. Uden konfiguration kører appen anonymt med `localStorage`, og login-siden viser en "ikke konfigureret"-besked.

1. Opret et Supabase-projekt og kør `supabase/schema.sql` i SQL-editoren (opretter tabellen med Row Level Security). Har du allerede kørt et tidligere skema, tilføjer den medfølgende `alter table … add column if not exists planning jsonb;` planlægningskolonnen.
2. Kopiér `.env.local.example` til `.env.local` og udfyld:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
   ```

Værdierne findes under **Project Settings → API**. Skat-, budget- og planlægningsdata gemmes som JSONB pr. bruger og flyttes automatisk fra lokal browser-lagring til kontoen ved første login.

---

## MCP-server (AI-assistent → din plan)

Appen eksponerer en **MCP-server** (Model Context Protocol) over HTTP på `/api/mcp`, så du kan spørge din AI-assistent (fx Claude Desktop eller en anden MCP-klient) om ting som *"Hvad betyder det for min økonomi på lang sigt, hvis min løn stiger 5.000 kr./md. fra nu, og jeg sparer det hele op?"* Assistenten kan så simulere det mod din gemte plan og — hvis du beder om det — gemme det som et navngivet scenarie, der dukker op i appen.

- **Kræver Supabase** (samme `NEXT_PUBLIC_SUPABASE_*` som ovenfor) — serveren logger ind som dig og rører kun din egen række (Row Level Security).
- **Auth:** HTTP Basic med din konto-e-mail og -adgangskode (`Authorization: Basic base64(email:adgangskode)`). Brug kun over HTTPS.
- **Læser som standard, skriver kun på opfordring:** `simulate_what_if` ændrer intet; kun `save_scenario` / `delete_scenario` gemmer.

**Værktøjer:** `get_plan` · `simulate_what_if` · `save_scenario` · `list_scenarios` · `delete_scenario`.

**Klientopsætning** (eksempel for en MCP-klient med HTTP-transport):

```json
{
  "mcpServers": {
    "planlaegning": {
      "url": "https://DIN-HOST/api/mcp",
      "headers": { "Authorization": "Basic <base64 af email:adgangskode>" }
    }
  }
}
```

**Test lokalt** med MCP Inspector mod udviklingsserveren:

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP · URL: http://localhost:3000/api/mcp
# Tilføj header: Authorization: Basic <base64 af email:adgangskode>
```

> Sikkerhed: adgangskoden sendes i en HTTPS-header — fint til personligt brug. En oplagt senere forbedring er at skifte til Supabase-access-tokens eller OAuth, så en rå adgangskode aldrig sendes.

---

## Projektstruktur

```
skatteudregner/
├── app/
│   ├── layout.tsx          # Root layout (Carbon-tema, Theme/Auth/Tax providers)
│   ├── page.tsx            # Forside med modul-valg
│   ├── skat/page.tsx       # Skatteberegner
│   ├── budget/page.tsx     # Budget
│   ├── resultat/page.tsx   # Samlet resultat
│   ├── planlaegning/page.tsx # Formue-simulering
│   ├── login/page.tsx      # Login / opret konto
│   └── carbon.scss         # Carbon-tema (white / g100)
├── components/
│   ├── app-header.tsx              # Navigation på tværs af moduler
│   ├── auth-provider.tsx           # Supabase auth-kontekst
│   ├── tax-provider.tsx            # Delt skatte-state (1–2 personer)
│   ├── theme-provider.tsx          # Lys/mørk tilstand
│   ├── ui/                         # card, separator
│   ├── tax-calculator/
│   │   ├── tax-form.tsx            # Hoved-formular
│   │   ├── tax-results.tsx         # Resultater-panel
│   │   ├── pdf-upload.tsx          # Upload af forskudsopgørelse/lønseddel
│   │   ├── paycheck-comparison.tsx # Lønseddel vs. forventet skat
│   │   ├── paycheck-chart.tsx      # Graf for året
│   │   ├── municipality-select.tsx # Kommunevælger
│   │   ├── number-input.tsx        # Talindtastning (dansk format)
│   │   └── sections/               # Formular-sektioner
│   ├── budget/
│   │   ├── budget-planner.tsx      # Kategorier, træk-og-slip, husstandstyper
│   │   └── budget-wizard.tsx       # Startbudget-guide
│   ├── result/
│   │   ├── result-overview.tsx     # Nøgletal, indsigt, måned/år
│   │   └── result-charts.tsx       # Donut- og bjælkediagrammer
│   └── planlaegning/
│       ├── planning-overview.tsx   # Inputs, antagelser, begivenheder
│       ├── planning-chart.tsx      # Formuekurve + usikkerhedsbånd
│       └── event-editor.tsx        # Tilføj/redigér livsbegivenheder
├── hooks/
│   ├── use-tax-calculator.ts       # Skatte-state og beregnings-hook
│   ├── use-budget.ts               # Budget-state (kategorier, personer)
│   ├── use-planning.ts             # Planlægnings-state + kildedata
│   └── use-remote-sync.ts          # Debounced Supabase-synk
├── lib/
│   ├── format.ts                   # Formatering (DKK, procent, kompakt)
│   ├── budget/
│   │   ├── categories.ts           # Standardkategorier + gæt
│   │   └── generate-budget.ts      # Startbudget + realkredit-estimat
│   ├── planning/
│   │   ├── types.ts                # Planlægnings-typer + standarder
│   │   └── simulate.ts             # Formue-simulering + Monte Carlo-bånd
│   ├── paycheck/                   # Lønseddel-sammenligning (Metode B)
│   ├── pdf/                        # PDF-parsere + OCR-utils
│   ├── supabase/                   # Klient + bruger-data
│   └── tax/
│       ├── rates.ts                # Skattesatser 2024–2026
│       ├── municipalities.ts       # Kommuner med satser
│       ├── calculator.ts           # Hoved-orkestrator
│       └── calculations/           # Delberegninger (AM, indkomst, bolig …)
├── supabase/schema.sql             # Database-skema + RLS
├── middleware.ts                   # Supabase session-håndtering
└── vitest.config.ts
```

---

## Docker

### Brug det publicerede image

Hent og kør det seneste image fra GitHub Container Registry:

```bash
docker run -p 3000:3000 ghcr.io/simonottosen/skatteudregner:latest
```

For login/synkronisering: angiv Supabase-miljøvariablerne ved kørsel:

```bash
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY \
  ghcr.io/simonottosen/skatteudregner:latest
```

Åbn [http://localhost:3000](http://localhost:3000) i din browser.

### Byg lokalt

```bash
# Byg image
docker build -t skatteudregner .

# Kør
docker run -p 3000:3000 skatteudregner
```

### Docker Compose

```yaml
services:
  skatteudregner:
    image: ghcr.io/simonottosen/skatteudregner:latest
    ports:
      - "3000:3000"
    restart: unless-stopped
```

Images er tagget med `latest` (seneste main-commit) og `sha-<commit>` for præcis versionsstyring.

---

## CI/CD

GitHub Actions kører automatisk på hvert push og pull request til `main`:

1. **Test** – typetjek, lint og unit tests
2. **Build & publish** – bygger et Docker image og publisher til `ghcr.io/simonottosen/skatteudregner` (kun ved push til `main`)

---

## PDF-import

Upload din **forskudsopgørelse** fra [skat.dk](https://skat.dk) for automatisk at udfylde skattefelterne, eller upload din **lønseddel** for at sammenligne forventet og faktisk betalt skat hen over året.

**Felter der udlæses fra forskudsopgørelsen:**
- A-indkomst, honorarer og øvrig AM-indkomst
- Overførselsindkomster og SU
- Pensionsindbetalinger (alle typer)
- Kapitalindkomst og renteudgifter
- Aktieindkomst og udbytter
- Ejendomsoplysninger
- Kommunevalg (med fuzzy matching)
- Fødselsdato (fra personnummer)
- Kirkeskat, civilstand, børn

PDF-parseren håndterer SKATs PDF-format inkl. garblede danske tegn. Billed-baserede PDF'er uden tekstlag læses automatisk med OCR (tesseract.js).

---

## Tests

```bash
npm run test:run
```

```
Test Files  15 passed
Tests       211 passed
```

Testfiler dækker skatteberegningens moduler, budget-generatoren, lønseddel-sammenligning samt PDF-parsing og formatering. Excel-scenarierne i `excel-scenarios.test.ts` verificerer beregneren mod kendte skatteberegninger.

---

## Teknologi

| Kategori | Teknologi |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) med App Router |
| UI | [IBM Carbon Design System](https://carbondesignsystem.com) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) + Sass (Carbon-tema) |
| Ikoner | [@carbon/icons-react](https://carbondesignsystem.com/elements/icons/library/) |
| Grafer | [Recharts](https://recharts.org) |
| Auth & DB | [Supabase](https://supabase.com) |
| PDF-parsing | [pdfjs-dist](https://mozilla.github.io/pdf.js/) |
| OCR | [tesseract.js](https://tesseract.projectnaptha.com) |
| Mørk tilstand | [next-themes](https://github.com/pacocoursey/next-themes) |
| Tests | [Vitest](https://vitest.dev) |
| Sprog | TypeScript |
