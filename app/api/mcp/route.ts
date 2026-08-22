/**
 * Remote MCP server (Streamable HTTP) at /api/mcp — in production:
 * https://skat.simonottosen.dk/api/mcp. Lets an MCP client (Claude Desktop, the
 * MCP Inspector, etc.) run what-if simulations against the user's saved plan and
 * save named scenarios. Authentication is HTTP Basic with the user's Supabase
 * email + password; every DB access is RLS-scoped to that user.
 *
 * mcp-handler 2 serves whatever route it is mounted at (routing belongs to the
 * host framework), so this lives at a static `mcp` segment rather than the
 * `[transport]` catch-all that v1's `basePath` option required. The public URL
 * is unchanged.
 */

import { createMcpHandler } from "mcp-handler"
import { registerPlanningTools } from "@/lib/mcp/tools"
import { verifyBasicAuth } from "@/lib/supabase/mcp-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const baseHandler = createMcpHandler(
  (server) => {
    registerPlanningTools(server)
  },
  { serverInfo: { name: "skatteberegner-planlaegning", version: "1.0.0" } }
)

/** Gate every request on Basic auth, then attach the session for the tools. */
async function handler(req: Request): Promise<Response> {
  const auth = await verifyBasicAuth(req)
  if (!auth) {
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        message:
          "Send your Supabase email + password via HTTP Basic auth " +
          "(Authorization: Basic base64(email:password)).",
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "WWW-Authenticate": 'Basic realm="planlaegning"',
        },
      }
    )
  }
  // mcp-handler augments the global `Request` with `auth` and reads it back off
  // that same object, so a plain assignment is the supported channel — it is what
  // the package's own `withMcpAuth` does. The SDK then surfaces it to each tool
  // as `ctx.http.authInfo` (top-level `extra.authInfo` in v1; moved in v2).
  req.auth = auth
  return baseHandler(req)
}

export { handler as GET, handler as POST, handler as DELETE }
