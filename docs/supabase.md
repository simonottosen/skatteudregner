# Supabase setup

Supabase is **optional**. Without it the app runs anonymously and keeps everything in
the browser's `localStorage`; the login page shows a "Login er ikke konfigureret"
notice. Configuring it adds email/password accounts and cross-device sync.

## 1. Create the table

Create a Supabase project, open **SQL Editor → New query**, and run
[`supabase/schema.sql`](../supabase/schema.sql).

It creates `public.skatteberegner_user_data` — one row per user, with the tax input,
budget items and planning state stored as JSONB — and enables Row Level Security with
select/insert/update/delete policies that all check `auth.uid() = user_id`. The script
is safe to re-run: it uses `create table if not exists`, an
`add column if not exists` migration for the `planning` column, and
`drop policy if exists` before each `create policy`.

## 2. Point the app at the project

Copy `.env.local.example` to `.env.local` and fill in the two values from
**Project Settings → API**:

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL, e.g. `https://YOUR-PROJECT-REF.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The **anon / public** key — never the service-role key |

`lib/supabase/env.ts` also accepts `SUPABASE_URL` and `SUPABASE_ANON_KEY` as
fallbacks, which is convenient in container environments where the `NEXT_PUBLIC_`
prefix is confusing.

`.env.local` is git-ignored. The anon key is designed to be public — it ends up in
every browser that loads the page — so Row Level Security, not secrecy, is what
protects the data. Do not commit real values anyway.

## Runtime vs. build-time configuration

`NEXT_PUBLIC_*` variables are normally inlined by Next at build time, which would
freeze whatever a Docker image was built with. To keep a single image
runtime-configurable, `lib/supabase/env.ts` reads the values through a dynamic key so
the build cannot substitute them, and `components/public-env-script.tsx` injects them
into each page as `window.__ENV__` for the browser client to read back.

The practical consequence: the published Docker image picks up the Supabase settings
you pass at `docker run` — no rebuild needed.

## Local vs. synchronised data

| | No Supabase | Signed in |
| --- | --- | --- |
| Where data lives | `localStorage`, per browser | JSONB row in Supabase, keyed by user |
| Across devices | No | Yes |
| On first sign-in | — | The account's saved value wins; if the account has none yet, the local one is uploaded to seed it |
| Who can read it | Only that browser | Only that user, enforced by RLS |

`hooks/use-remote-sync.ts` handles this per JSONB column (`tax_input`, `budget_items`,
`planning`). Saves are debounced while you type and flushed immediately when the tab is
hidden or unmounted, so an edit made just before navigating away is not lost.

## Related

- [MCP HTTP server](mcp-http-server.md) — needs the same Supabase project
- [MCP bundle (MCPB)](mcp-bundle.md) — discovers the Supabase config from the app
