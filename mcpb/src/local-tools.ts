/**
 * Tools that only make sense because this bundle runs on the user's own machine.
 *
 * The hosted `/api/mcp` server can't reach the user's desktop; a local process
 * can. `open_app` is the payoff: once the model has changed the plan it can put
 * the matching page on screen instead of telling the user to go find it.
 */

import { spawn } from "node:child_process"
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import { log } from "./log.js"

/**
 * Section → path. An allowlist rather than a free-text path so nothing the model
 * produces can be turned into an arbitrary URL for the OS to open.
 */
const SECTIONS = {
  forside: "/",
  skat: "/skat",
  budget: "/budget",
  resultat: "/resultat",
  planlaegning: "/planlaegning",
} as const

type Section = keyof typeof SECTIONS

/** The platform's "open this URL in the default handler" command. */
function opener(): { command: string; args: string[] } | undefined {
  switch (process.platform) {
    case "darwin":
      return { command: "open", args: [] }
    case "win32":
      // `start` is a cmd builtin; the empty string is the (required) window title.
      return { command: "cmd", args: ["/c", "start", ""] }
    case "linux":
      return { command: "xdg-open", args: [] }
    default:
      return undefined
  }
}

export function registerLocalTools(server: McpServer, appUrl: string, allowOpen: boolean): void {
  server.registerTool(
    "open_app",
    {
      title: "Open the app in the browser",
      description:
        "Open a page of the Skatteberegner web app in the user's default browser " +
        "on this machine. Useful after changing the plan so the user can see the " +
        "result. Only works because this server runs locally.",
      inputSchema: {
        section: z
          .enum(Object.keys(SECTIONS) as [Section, ...Section[]])
          .default("planlaegning")
          .describe("Which page to open."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const section = (args.section ?? "planlaegning") as Section
      // Built from the validated app origin plus an allowlisted path — never
      // from model-supplied text.
      const url = new URL(SECTIONS[section], appUrl).toString()

      // Escape hatch for automated runs, and for anyone who would rather the
      // assistant never take over their screen: resolve the URL, launch nothing.
      if (!allowOpen) {
        log.debug("open_app: launching is disabled", { url })
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  opened: false,
                  url,
                  section,
                  note: "Opening is disabled — give the user this link instead.",
                },
                null,
                2
              ),
            },
          ],
        }
      }

      const launcher = opener()
      if (!launcher) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { opened: false, url, note: `Cannot open a browser on platform ${process.platform}.` },
                null,
                2
              ),
            },
          ],
          isError: true,
        }
      }

      try {
        const child = spawn(launcher.command, [...launcher.args, url], {
          stdio: "ignore",
          detached: true,
        })
        // Let the browser outlive this process, and never let a spawn failure
        // become an unhandled 'error' event that kills the server.
        child.on("error", (error) => log.warn("open_app: launcher failed", { reason: error.message }))
        child.unref()
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { opened: false, url, error: error instanceof Error ? error.message : String(error) },
                null,
                2
              ),
            },
          ],
          isError: true,
        }
      }

      log.info("Opened the app", { url })
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ opened: true, url, section }, null, 2) },
        ],
      }
    }
  )
}
