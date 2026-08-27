# MCP HTTP server

The app exposes a [Model Context Protocol](https://modelcontextprotocol.io) server over
Streamable HTTP at **`/api/mcp`**, so an assistant can read your saved plan, run what-if
simulations against it, and — only when you ask — write named scenarios back into the
app.

| | |
| --- | --- |
| Endpoint | `https://skat.simonottosen.dk/api/mcp`, or `http://localhost:3000/api/mcp` in development |
| Transport | Streamable HTTP |
| Auth | HTTP Basic: `Authorization: Basic base64(email:password)` |
| Route handler | `app/api/mcp/route.ts` — `maxDuration` is 60 s |
| Tool implementation | `lib/mcp/tools.ts`, shared verbatim with the [MCP bundle](mcp-bundle.md) |

Prefer a one-click install and no hand-rolled headers? The same tools ship as a locally
run [MCP bundle](mcp-bundle.md).

## Requirements

- [Supabase must be configured](supabase.md). The server signs in as you and every query
  is scoped by Row Level Security to your own row.
- An account in the app. The MCP credentials are the same email and password you sign in
  with.

`lib/supabase/mcp-auth.ts` decodes the Basic header and calls
`supabase.auth.signInWithPassword`; an unauthenticated request gets a `401` with a
`WWW-Authenticate: Basic` challenge.

## Client configuration

```json
{
  "mcpServers": {
    "planlaegning": {
      "url": "https://skat.simonottosen.dk/api/mcp",
      "headers": { "Authorization": "Basic <base64 of email:password>" }
    }
  }
}
```

> **Security note.** The password travels in an HTTPS header on every request. That is
> acceptable for personal use, but only over HTTPS. Supabase access tokens or OAuth
> would be the natural next step.

## Tools

Read-only unless marked **writes**. The write tools are the only ones that touch your
saved data.

### Planning

| Tool | What it does |
| --- | --- |
| `get_plan` | The whole saved plan plus the baseline projection |
| `simulate_what_if` | Projects a change without saving — baseline, modified plan and the deltas |
| `get_trajectory` | The year-by-year projection, optionally under a what-if |
| `solve_required_saving` | The monthly contribution needed to hit a target at a given age |
| `update_plan` | **writes** — edits the base plan |
| `save_scenario` | **writes** — stores a named what-if that then shows up in the app |
| `update_scenario` | **writes** — renames or re-edits a saved scenario |
| `list_scenarios` | Lists the saved scenarios and their change-sets |
| `delete_scenario` | **writes** — removes a saved scenario |

### Tax, budget and result

| Tool | What it does |
| --- | --- |
| `get_tax` | The saved Danish tax profile and its calculated result |
| `compute_tax` | Tax for an ad-hoc set of inputs, saving nothing |
| `get_budget` | The saved monthly budget: income, expenses per category, surplus |
| `get_result` | The combined result view — take-home pay against the budget |

### Life events

| Tool | What it does |
| --- | --- |
| `add_event` | **writes** — adds a one-off or recurring event to the plan |
| `update_event` | **writes** — edits an existing event |
| `remove_event` | **writes** — deletes an event |

## Testing it locally

Start the dev server, then point the MCP Inspector at it:

```bash
npm run dev
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP
# URL:       http://localhost:3000/api/mcp
# Header:    Authorization: Basic <base64 of email:password>
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `401` with `{"error":"unauthorized"}` | Missing, malformed or wrong Basic header. The body spells out the expected format. |
| Every tool errors even though the handshake worked | Supabase is not configured for the deployment you are pointing at — see [Supabase setup](supabase.md). |
| A long Monte-Carlo call is cut off | The route's 60 s `maxDuration`. Use the [MCP bundle](mcp-bundle.md), where the timeout is yours to set. |
| A browser shows `ERR_INVALID_AUTH_CREDENTIALS` at `/api/mcp` | Expected — the endpoint answers `401` with a Basic challenge, which is not something a browser can complete usefully. Use an MCP client. |
