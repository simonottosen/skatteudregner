# MCP bundle (MCPB)

The same tools as the [HTTP server](mcp-http-server.md), packaged as an
[MCP Bundle](https://github.com/anthropics/mcpb) (`.mcpb`) that you install with one
click in a host such as Claude Desktop. The server then runs **locally on your machine**
over stdio instead of as an HTTP endpoint.

The tool code is identical — `lib/mcp/tools.ts`, one implementation behind two
transports. Everything that differs follows from running locally:

| | HTTP (`/api/mcp`) | MCPB bundle (stdio) |
| --- | --- | --- |
| Sign-in | Basic header on **every** request | Once at startup, refreshed before expiry |
| Setup | Base64 header in the client's config | A dialog in the host; the password goes to the OS keychain |
| Timeout | 60 s route limit | Yours to choose (5–120 s), so long Monte-Carlo runs finish |
| Extra tool | — | `open_app` opens the relevant page in your browser |
| Read-only mode | — | Turn it on and the write tools are never advertised |

## Build and install

```bash
npm run build:mcpb
# → dist/<name>-<version>.mcpb, taken from mcpb/manifest.json
```

Drag the `.mcpb` file into your MCP host (Claude Desktop: **Settings → Extensions**) and
fill in the email and password you use to sign in to the app.

`npm run build:mcpb` (see `scripts/build-mcpb.mjs`):

1. Bundles `mcpb/src/server.ts` and the shared engine under `lib/` into a single ESM
   file with esbuild — and **fails** if Next.js, React or Carbon leak into the graph.
2. Checks that the built server refuses to start unconfigured and keeps stdout clean.
3. Runs a real MCP conversation against the artefact over stdio, in normal and
   read-only mode (`scripts/smoke-mcpb.mjs`).
4. Validates `mcpb/manifest.json` against the MCPB specification.
5. Packs the archive and reads its central directory back to confirm no `.ts`/`.map`
   files leaked in and the manifest, icon and entry point are all present.

The archive ships no `node_modules`.

## Settings

The host passes these through as environment variables — see `mcp_config.env` in
`mcpb/manifest.json`. Only the first two are required.

| Setting | Environment variable | Default | What it does |
| --- | --- | --- | --- |
| E-mail | `SKAT_EMAIL` | — | Your account in the app. **Required** |
| Adgangskode | `SKAT_PASSWORD` | — | Stored in the OS keychain, never written into the bundle. **Required** |
| App-URL | `SKAT_APP_URL` | `https://skat.simonottosen.dk` | Only relevant if you host your own copy |
| Skrivebeskyttet | `SKAT_READ_ONLY` | `false` | Withholds every tool that changes the plan |
| Åbn ikke browseren | `SKAT_DISABLE_OPEN` | `false` | `open_app` returns the link instead of launching it |
| Timeout pr. værktøj | `SKAT_TOOL_TIMEOUT_MS` | `30000` | Clamped to 5 000–120 000 ms |
| Logniveau | `SKAT_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent` |

You are **not** asked for the Supabase URL and anon key. They are public by design — Row
Level Security is what protects the data — so the bundle discovers them from
`window.__ENV__` on the app URL. If you run your own Supabase, or the app is
unreachable, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` explicitly.

## Running it by hand

```bash
npm run build:mcpb:fast   # steps 1–4 above, stopping short of packing
npm run smoke:mcpb        # MCP conversation against the built bundle over stdio
npm run smoke:mcpb -- --read-only

# or against the MCP Inspector:
npx @modelcontextprotocol/inspector node mcpb/server/index.js
```

`mcpb/server/` and `dist/` are git-ignored build output.

## Troubleshooting

All diagnostics go to **stderr** — stdout is the protocol itself, and a single stray
`console.log` would corrupt the stream. The host collects stderr into its server log
(Claude Desktop: **Settings → Extensions → Skatteberegner → Logs**). Set the log level to
`debug` to see every tool call with its duration. Passwords and tokens are redacted at
every level.

| Message | What it means |
| --- | --- |
| `Missing required configuration` | Email or password is blank in the host's dialog. |
| `Supabase rejected the sign-in` | Wrong credentials. The server still starts so you can see the tool list; the error surfaces on the first call. |
| `{"error":{"kind":"timeout"}}` | The tool did not finish in time. Raise `SKAT_TOOL_TIMEOUT_MS`. |
| `Config auto-discovery: could not reach the app` | The app URL is unreachable. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` explicitly. |
| A write tool is missing from the list | Read-only mode is on. |
