/**
 * Remote MCP server (Streamable HTTP) at /api/mcp — in production:
 * https://skat.simonottosen.dk/api/mcp. Lets an MCP client (Claude Desktop, the
 * MCP Inspector, etc.) run what-if simulations against the user's saved plan and
 * save named scenarios. Authentication is HTTP Basic with the user's Supabase
 * email + password; every DB access is RLS-scoped to that user.
 */

import { createMcpHandler } from "mcp-handler"
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"
import { registerPlanningTools } from "@/lib/mcp/tools"
import { verifyBasicAuth } from "@/lib/supabase/mcp-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const baseHandler = createMcpHandler(
  (server) => {
    registerPlanningTools(server)
  },
  { serverInfo: { name: "skatteberegner-planlaegning", version: "1.0.0" } },
  { basePath: "/api", maxDuration: 60, disableSse: true }
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
  ;(req as Request & { auth?: AuthInfo }).auth = auth
  return baseHandler(req)
}

export { handler as GET, handler as POST, handler as DELETE }
