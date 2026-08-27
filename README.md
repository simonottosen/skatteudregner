# Skatteberegner

A Danish personal-finance web app that works out your income tax, turns the take-home
pay into a monthly budget, and projects the result decades forward.

It is aimed at private individuals in Denmark who want a fuller picture than a
single-number tax calculator gives: households of one or two people, with or without a
home, who want to see how salary, deductions, spending and pension fit together. The
interface is in Danish; the code and documentation are in English.

> [!IMPORTANT]
> **The figures are estimates, not tax advice.** This is an independent project with no
> affiliation to the Danish tax authorities. It does not replace your
> _forskudsopgørelse_ or _årsopgørelse_, and nothing here should be relied on for filing
> or for financial decisions. Check anything that matters against
> [skat.dk](https://skat.dk) or a qualified adviser.

---

## The four areas

The app is one flow across four pages, sharing state as you go. The tax step is
optional — start at **Budget** and type your take-home pay in by hand if you would
rather skip it.

| Page | Route | What it is for |
| --- | --- | --- |
| **Skat** | `/skat` | Full Danish income-tax calculation for tax years 2024–2026 — AM-bidrag, bund-, mellem- and topskat, kommune- and kirkeskat, capital and share income, and property tax. Handles one or two people in a household, and can pre-fill the form from an uploaded _forskudsopgørelse_ PDF or compare an uploaded payslip against the expected tax for the year. |
| **Budget** | `/budget` | A monthly budget of categorised expenses, set against the take-home pay from **Skat** or a figure you enter yourself. Supports a single person, a couple with shared expenses, and a couple keeping separate finances, and can generate a starting budget from Danish averages. |
| **Resultat** | `/resultat` | The two combined: key figures (income, expenses, what is left, savings rate, effective tax rate), charts per category, and plain-language observations. Switch between monthly and annual figures. |
| **Planlægning** | `/planlaegning` | A long-horizon projection of net worth — investments, home equity and pension — with return and inflation assumptions, a Monte-Carlo uncertainty band, life events (a large one-off cost, an inheritance, a change in saving, moving house), and saved "what-if" scenarios you can compare against the base plan. |

Other things worth knowing:

- **Optional account.** Without one, everything stays in your browser's local storage.
  With one, it syncs across devices. See [accounts and sync](#accounts-and-sync-optional).
- **Dark mode.** Press <kbd>d</kbd> anywhere outside a text field, or use the toggle in
  the header.
- **AI assistant access.** An assistant can query and update your plan through the
  [MCP integrations](#mcp-integrations).

---

## Quick start

### Prerequisites

- **Node.js 22** — the version CI and the Docker image use
- **npm** — the repository ships a `package-lock.json`

### Run it

```bash
git clone https://github.com/simonottosen/skatteudregner.git
cd skatteudregner
npm ci
npm run dev
```

Open <http://localhost:3000>. The four pages are at `/skat`, `/budget`, `/resultat` and
`/planlaegning`.

No configuration is needed. The app runs fully anonymously and stores everything in the
browser until you decide to add an account.

To use a different port, pass it through to Next: `npm run dev -- --port 3001`.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run format` | Prettier over every `.ts`/`.tsx` file |
| `npm test` | Vitest in watch mode |
| `npm run test:run` | Vitest once |
| `npm run build:mcpb` | Build, test, validate and pack the MCP bundle into `dist/` |
| `npm run build:mcpb:fast` | The same, but stops short of packing the archive |
| `npm run smoke:mcpb` | Talk MCP to the built bundle over stdio |

---

## Accounts and sync (optional)

Sign-in is powered by [Supabase](https://supabase.com) and is entirely optional.

- **Without it** (the default), the app never talks to a server: your tax input, budget
  and plan live in `localStorage`, on that one browser. The login page says as much.
- **With it**, the same data is stored as JSONB in a row that only you can read, guarded
  by Row Level Security, and follows you across devices. The first time you sign in on a
  fresh account, what you already entered locally is uploaded to seed it.

To enable it, run [`supabase/schema.sql`](supabase/schema.sql) in your Supabase project,
then copy `.env.local.example` to `.env.local` and set:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
```

Both values come from **Project Settings → API** in Supabase. The anon key is public by
design; the service-role key is never used here and must not be added.

**Full walkthrough: [docs/supabase.md](docs/supabase.md).**

---

## Docker

The published image is built from `main` by CI and tagged `latest` plus
`sha-<commit>`:

```bash
docker run -p 3000:3000 ghcr.io/simonottosen/skatteudregner:latest
```

Open <http://localhost:3000>.

For accounts and sync, pass the Supabase settings at run time:

```bash
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY \
  ghcr.io/simonottosen/skatteudregner:latest
```

These are read at **run time**, not baked in at build time, so one image works with
whatever you put in the container's environment — no rebuild. In Compose, use
`environment:`.

To build the image yourself:

```bash
docker build -t skatteudregner .
docker run -p 3000:3000 skatteudregner
```

The `Dockerfile` is a three-stage build (`deps` → `builder` → `runner`) on
`node:22-alpine` that ships Next's `standalone` output as a non-root user, listening on
port 3000.

---

## MCP integrations

An assistant can be given access to your saved plan through the
[Model Context Protocol](https://modelcontextprotocol.io) — enough to answer questions
like _"what happens to my long-term finances if my salary rises by 5,000 kr. a month and
I save all of it?"_ and, if you ask it to, save the answer as a named scenario that then
appears in the app.

There are two ways in. Both expose the same tools from the same implementation
(`lib/mcp/tools.ts`), read by default and write only when asked, and both are scoped by
Row Level Security to your own data — so both need [Supabase](#accounts-and-sync-optional).

### MCP server (HTTP)

Hosted alongside the app at `/api/mcp`, authenticated with HTTP Basic using your account
email and password. Point any MCP client with HTTP transport at it.

**Setup, tool reference and troubleshooting: [docs/mcp-http-server.md](docs/mcp-http-server.md).**

### MCP bundle (MCPB)

The same tools packaged as a `.mcpb` file you install in one click in a host such as
Claude Desktop. It runs locally over stdio, so you sign in once instead of on every
request, long simulations are not cut short by the HTTP route's 60-second limit, and it
can open the relevant page of the app in your browser. Build it with
`npm run build:mcpb`.

**Setup, settings and troubleshooting: [docs/mcp-bundle.md](docs/mcp-bundle.md).**

---

## Contributing

Issues and pull requests are welcome. Before opening one, make the same checks CI does
pass locally:

```bash
npm ci
npm run typecheck
npm run lint
npm run test:run
```

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs exactly that on every push
and pull request to `main`, then builds and publishes the Docker image on pushes to
`main`.

A few conventions:

- **Code and comments in English; UI strings in Danish.** The page names (Skat, Budget,
  Resultat, Planlægning) stay Danish everywhere, including here.
- **Run `npm run format`** — Prettier with the Tailwind class-sorting plugin owns
  formatting.
- **Tax logic needs a test.** The suite under `lib/tax/__tests__/` checks the calculator
  against known results; extend it rather than adjusting it to match new output.
- **Do not commit secrets.** `.env.local` is git-ignored; keep it that way.

### Documentation

| Document | Contents |
| --- | --- |
| [docs/supabase.md](docs/supabase.md) | Supabase project setup, the schema and RLS, local vs. synchronised data |
| [docs/mcp-http-server.md](docs/mcp-http-server.md) | The `/api/mcp` endpoint: auth, the full tool list, troubleshooting |
| [docs/mcp-bundle.md](docs/mcp-bundle.md) | Building, installing and configuring the local `.mcpb` bundle |
| [supabase/schema.sql](supabase/schema.sql) | The database schema, ready to paste into the SQL editor |

---

## Built with

| Area | Choice |
| --- | --- |
| Framework | [Next.js 16](https://nextjs.org) (App Router) on [React 19](https://react.dev) |
| Language | [TypeScript](https://www.typescriptlang.org) |
| UI | [IBM Carbon Design System](https://carbondesignsystem.com) with [Tailwind CSS v4](https://tailwindcss.com) |
| Charts | [Recharts](https://recharts.org) |
| Auth & storage | [Supabase](https://supabase.com) |
| PDF & OCR | [pdf.js](https://mozilla.github.io/pdf.js/) with a [Tesseract.js](https://tesseract.projectnaptha.com) fallback for scanned documents |
| MCP | [mcp-handler](https://github.com/vercel/mcp-handler) over HTTP, [MCPB](https://github.com/anthropics/mcpb) bundled with [esbuild](https://esbuild.github.io) for stdio |
| Tests | [Vitest](https://vitest.dev) |

---

## License

[MIT](LICENSE).
