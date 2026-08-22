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
- **AI-assistent** – Spørg din assistent om planen via [MCP-serveren](#mcp-server-ai-assistent--din-plan) over HTTP, eller installér den samme værktøjskasse som en lokal [MCP-bundle](#mcp-bundle-mcpb) med ét klik
- **302 tests** – Beregnings-, budget-, planlægnings- og PDF-moduler er testet

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
| `npm run build:mcpb` | Byg, test og pak MCP-bundlen til `dist/*.mcpb` |
| `npm run build:mcpb:fast` | Kun bundtning — uden at pakke arkivet |
| `npm run smoke:mcpb` | Kør en MCP-samtale mod den byggede bundle over stdio |

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

Appen eksponerer en **MCP-server** (Model Context Protocol) over HTTP, så du kan spørge din AI-assistent (fx Claude Desktop eller en anden MCP-klient) om ting som *"Hvad betyder det for min økonomi på lang sigt, hvis min løn stiger 5.000 kr./md. fra nu, og jeg sparer det hele op?"* Assistenten kan så simulere det mod din gemte plan og — hvis du beder om det — gemme det som et navngivet scenarie, der dukker op i appen.

Standard-endpoint (produktion): **`https://skat.simonottosen.dk/api/mcp`**. Kører du lokalt, er det `http://localhost:3000/api/mcp`.

> Foretrækker du ét-kliks-installation frem for at rode med headers, findes de samme værktøjer som en [MCP-bundle](#mcp-bundle-mcpb) der kører lokalt.

- **Kræver Supabase** (samme `NEXT_PUBLIC_SUPABASE_*` som ovenfor) — serveren logger ind som dig og rører kun din egen række (Row Level Security).
- **Auth:** HTTP Basic med din konto-e-mail og -adgangskode (`Authorization: Basic base64(email:adgangskode)`). Brug kun over HTTPS.
- **Læser som standard, skriver kun på opfordring:** alle `get_*`-, `simulate_what_if`-, `compute_tax`-, `list_scenarios`- og `solve_required_saving`-værktøjer ændrer intet; kun `update_plan`, `save_scenario`, `update_scenario`, `delete_scenario` og `add_event`/`update_event`/`remove_event` gemmer.

**Værktøjer:**

| Værktøj | Hvad det gør |
|---|---|
| `get_plan` | Læser hele den gemte plan (alle felter, antagelser, pension, skat, begivenheder, scenarier) + basisprojektionen |
| `simulate_what_if` | Beregner effekten af en ændring uden at gemme — basis vs. scenarie + forskelle |
| `get_trajectory` | Hele år-for-år-forløbet (samme data som CSV-eksporten), evt. for et hvad-nu-hvis |
| `solve_required_saving` | Hvor meget skal spares op om måneden for at blive økonomisk uafhængig ved pension |
| `update_plan` | Redigér selve basisplanen (tal, antagelser, pension, skat) — skriver |
| `save_scenario` | Gem et navngivet hvad-nu-hvis, der vises i appen — skriver |
| `update_scenario` | Omdøb/redigér et gemt scenarie — skriver |
| `list_scenarios` / `delete_scenario` | Vis / fjern gemte scenarier |
| `add_event` / `update_event` / `remove_event` | Tilføj/redigér/fjern en begivenhed i planens "Større ændringer" — skriver |
| `get_tax` | Skatteresultat for din gemte indkomst: nettoløn, samlet skat, effektiv + marginal sats og fuld opdeling, pr. person + husstand |
| `compute_tax` | Skat for en hypotetisk indkomst (hvad-nu-hvis), uden at gemme |
| `get_budget` | Månedligt budget: indkomst (pr. person + i alt), udgifter (i alt + pr. kategori), realkredit, overskud og opsparingsrate |
| `get_result` | Resultatsidens nøgletal: brutto/skat/netto pr. måned + budgettets indkomst, udgifter, overskud og opsparingsrate |

Et scenarie (og `simulate_what_if`) kan ændre opsparing, forbrug, pensionsalder, start­investeringer, kontant buffer, investeringsbeskatning, ejendomsskat, bolig-/grundværdi, realkredit, anden gæld, antagelser, delte pensionsfelter og skatteprofilen (kommune/kirkeskat/år), samt tilføje begivenheder (engangsudgift/-indtægt, opsparingsændring, bolighandel).

**Klientopsætning** (eksempel for en MCP-klient med HTTP-transport):

```json
{
  "mcpServers": {
    "planlaegning": {
      "url": "https://skat.simonottosen.dk/api/mcp",
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

## MCP-bundle (MCPB)

Samme værktøjer, pakket som en **MCP Bundle** (`.mcpb`) du installerer med ét klik i fx Claude Desktop. Serveren kører så *lokalt på din maskine* over stdio i stedet for som HTTP-endpoint.

Værktøjskoden er nøjagtig den samme (`lib/mcp/tools.ts` — én implementering, to transporter). Forskellene følger alle af, at den kører lokalt:

| | HTTP (`/api/mcp`) | MCPB-bundle (stdio) |
|---|---|---|
| Login | Basic-header på **hver** forespørgsel | Én gang ved opstart, fornys automatisk før udløb |
| Opsætning | Base64-kodet header i klientens config | Dialog i værten; adgangskoden gemmes i OS-nøgleringen |
| Tidsgrænse | Serverless-loft på 60 s | Din egen (5–120 s) — lange Monte-Carlo-kørsler når at blive færdige |
| Ekstra værktøj | — | `open_app` åbner den relevante side i din browser |
| Skrivebeskyttelse | — | Slå `Skrivebeskyttet` til, så de 7 skrive-værktøjer slet ikke udbydes |

### Byg og installér

```bash
npm run build:mcpb
# → dist/skatteberegner-planlaegning-1.0.0.mcpb
```

Træk `.mcpb`-filen ind i din MCP-vært (Claude Desktop: **Settings → Extensions**) og udfyld e-mail + adgangskode — de samme som du logger ind i appen med.

`npm run build:mcpb` gør fire ting: bundter `mcpb/src/server.ts` og hele den delte motor til én fil med esbuild, kører en fuld MCP-samtale mod resultatet over stdio, validerer manifestet mod MCPB-specifikationen og pakker arkivet. Arkivet indeholder præcis fire filer (~400 kB) og har ingen `node_modules` — hverken Next.js eller React ender i bundtet, og bygget fejler hvis de gør.

### Indstillinger

Alle er valgfri på nær de to første. Værten sender dem videre som miljøvariabler (se `mcp_config.env` i `mcpb/manifest.json`).

| Indstilling | Miljøvariabel | Standard | Hvad den gør |
|---|---|---|---|
| E-mail | `SKAT_EMAIL` | — | Din konto i appen. **Påkrævet** |
| Adgangskode | `SKAT_PASSWORD` | — | Gemmes i OS-nøgleringen, aldrig i bundtet. **Påkrævet** |
| App-URL | `SKAT_APP_URL` | `https://skat.simonottosen.dk` | Kun relevant hvis du hoster din egen kopi |
| Skrivebeskyttet | `SKAT_READ_ONLY` | `false` | Skjuler alle værktøjer der ændrer planen |
| Åbn ikke browseren | `SKAT_DISABLE_OPEN` | `false` | `open_app` returnerer linket i stedet for at åbne det |
| Timeout pr. værktøj | `SKAT_TOOL_TIMEOUT_MS` | `30000` | Klippes til 5.000–120.000 ms |
| Logniveau | `SKAT_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` eller `silent` |

Supabase-URL og anon-nøgle spørges du **ikke** om: de er offentlige (det er Row Level Security der beskytter dataene) og hentes automatisk fra `window.__ENV__` på app-URL'en. Kører du din egen Supabase, kan du sætte `SUPABASE_URL` og `SUPABASE_ANON_KEY` eksplicit.

### Fejlfinding

Al diagnostik går til **stderr** — stdout er selve protokollen, og ét enkelt `console.log` det forkerte sted ville ødelægge forbindelsen. Værten samler stderr op i sin serverlog (Claude Desktop: **Settings → Extensions → Skatteberegner → Logs**). Sæt logniveauet til `debug` for at se hvert enkelt værktøjskald med varighed. Adgangskoder og tokens redigeres ud af logs uanset niveau.

Almindelige fejl og hvad de betyder:

- **"Missing required configuration"** — e-mail eller adgangskode er ikke udfyldt i værtens dialog.
- **"Supabase rejected the sign-in"** — forkerte loginoplysninger. Serveren starter alligevel, så du kan se værktøjslisten; fejlen dukker op ved første kald.
- **`{"error":{"kind":"timeout"}}`** — værktøjet nåede ikke at blive færdigt. Hæv `SKAT_TOOL_TIMEOUT_MS`.

Kør serveren i hånden, uden at pakke:

```bash
npm run build:mcpb:fast     # kun bundtning
npm run smoke:mcpb          # 11 tjek: handshake, værktøjsliste, fejlformat, ingen hemmeligheder i loggen
npm run smoke:mcpb -- --read-only

# eller mod MCP Inspector:
npx @modelcontextprotocol/inspector node mcpb/server/index.js
```

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
│   ├── api/mcp/route.ts    # MCP-server (Streamable HTTP + Basic auth)
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
│   ├── mcp/
│   │   └── tools.ts                # MCP-værktøjer (plan, skat, budget, resultat) — delt af begge transporter
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
├── mcpb/                           # MCP-bundle (kører lokalt over stdio)
│   ├── manifest.json               # MCPB-manifest: værktøjer, prompts, user_config
│   ├── icon.png                    # Genereret af scripts/make-mcpb-icon.mjs
│   └── src/
│       ├── server.ts               # stdio-entry: timeouts, fejlhåndtering, skrivebeskyttelse
│       ├── config.ts               # Validering af miljø + auto-opdagelse af Supabase-config
│       ├── auth.ts                 # Ét login, fornyet før udløb
│       ├── local-tools.ts          # open_app — kun muligt fordi den kører lokalt
│       └── log.ts                  # stderr-logning med redigering af hemmeligheder
├── scripts/
│   ├── build-mcpb.mjs              # esbuild-bundtning → validering → pak
│   ├── smoke-mcpb.mjs              # MCP-samtale mod den byggede bundle
│   └── make-mcpb-icon.mjs          # Genererer ikonet (Dannebrog) uden billed-afhængigheder
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

> Supabase-variablerne læses ved **kørsel** (ikke kun ved build), så det samme image virker med de værdier, du sætter i container-miljøet — uden at bygge igen. Sætter du dem i Docker Compose, så brug `environment:`.

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
    environment:
      # Valgfrit — kun for login/synk + MCP-serveren
      NEXT_PUBLIC_SUPABASE_URL: https://YOUR-PROJECT-REF.supabase.co
      NEXT_PUBLIC_SUPABASE_ANON_KEY: YOUR-ANON-PUBLIC-KEY
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
Test Files  28 passed
Tests       302 passed
```

Testfiler dækker skatteberegningens moduler, budget-generatoren, lønseddel-sammenligning, planlægningsmotoren samt PDF-parsing og formatering. Excel-scenarierne i `excel-scenarios.test.ts` verificerer beregneren mod kendte skatteberegninger, `lib/mcp/__tests__/handler.test.ts` tjekker MCP-serverens protokol-wiring, `lib/mcp/__tests__/auth.test.ts` fastholder at et værktøjskald får sin identitet fra `ctx.http.authInfo` (HTTP) eller `getAuthInfo` (stdio), og `mcpb/__tests__/` dækker bundlens konfigurationsvalidering og log-hygiejne.

Selve MCP-bundlen testes desuden mod det byggede artefakt frem for mod kildekoden — `npm run smoke:mcpb` starter `mcpb/server/index.js` som en rigtig vært ville, og fører en MCP-samtale over stdio. `npm run build:mcpb` kører det automatisk i både normal og skrivebeskyttet tilstand.

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
| MCP | [mcp-handler](https://github.com/vercel/mcp-handler) + [@modelcontextprotocol/server](https://github.com/modelcontextprotocol) |
| MCP-bundle | [MCPB](https://github.com/anthropics/mcpb) + [esbuild](https://esbuild.github.io) |
| PDF-parsing | [pdfjs-dist](https://mozilla.github.io/pdf.js/) |
| OCR | [tesseract.js](https://tesseract.projectnaptha.com) |
| Mørk tilstand | [next-themes](https://github.com/pacocoursey/next-themes) |
| Tests | [Vitest](https://vitest.dev) |
| Sprog | TypeScript |
