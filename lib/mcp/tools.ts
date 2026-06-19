/**
 * MCP tools that let an LLM run "what-if" questions against the user's saved
 * long-term plan and (on explicit request) save named scenarios. Read-only by
 * default: `simulate_what_if` never writes; only `save_scenario` /
 * `delete_scenario` mutate, and only the scenarios list within the plan.
 */

import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"
import { fetchUserData, saveUserData } from "@/lib/supabase/user-data"
import { userClientFromAuth } from "@/lib/supabase/mcp-auth"
import { normalizePlanning, normalizeScenarioChanges, newId } from "@/lib/planning/normalize"
import { applyScenario } from "@/lib/planning/scenario"
import { summarize, type DualAmount, type PlanningSummary } from "@/lib/planning/summary"
import type { PlanningScenario, PlanningState } from "@/lib/planning/types"

interface ToolExtra {
  authInfo?: AuthInfo
}

/** Load the user's normalized plan (+ an RLS-scoped client for writes). */
async function loadPlan(extra: ToolExtra) {
  const { supabase, userId } = userClientFromAuth(extra.authInfo)
  const row = await fetchUserData(supabase, userId)
  const state = normalizePlanning(row?.planning)
  // Best-effort gross salary hint so the LLM can turn "5 % of salary" into kr.
  let grossMonthlySalary: number | null = null
  const taxInput = row?.tax_input as { workIncome?: unknown } | null
  if (taxInput && typeof taxInput.workIncome === "number" && taxInput.workIncome > 0) {
    grossMonthlySalary = Math.round(taxInput.workIncome / 12)
  }
  return { supabase, userId, state, grossMonthlySalary }
}

const round = (n: number) => Math.round(n)
const dual = (d: DualAmount) => ({ nominal: round(d.nominal), real: round(d.real) })

/** Headline figures of one plan, nominal + today's kroner. */
function summaryReport(s: PlanningSummary) {
  return {
    netWorthAtRetirement: dual(s.netWorthAtRetirement),
    netWorthAtEnd: dual(s.netWorthAtEnd),
    annualPensionAfterTax: dual(s.annualPensionAfterTax),
    fiAge: s.fiAge,
    debtFreeAge: s.debtFreeAge,
    ruinAge: s.ruinAge,
    successProbabilityPct: Math.round(s.successProbability * 100),
  }
}

/** base→scenario deltas for the headline figures (today's kroner unless noted). */
function deltaReport(base: PlanningSummary, scen: PlanningSummary) {
  const d = (b: DualAmount, s: DualAmount) => ({
    nominal: round(s.nominal - b.nominal),
    real: round(s.real - b.real),
  })
  return {
    netWorthAtRetirement: d(base.netWorthAtRetirement, scen.netWorthAtRetirement),
    netWorthAtEnd: d(base.netWorthAtEnd, scen.netWorthAtEnd),
    annualPensionAfterTax: d(base.annualPensionAfterTax, scen.annualPensionAfterTax),
    fiAgeYears:
      base.fiAge != null && scen.fiAge != null ? scen.fiAge - base.fiAge : null,
    successProbabilityPp:
      Math.round(scen.successProbability * 100) -
      Math.round(base.successProbability * 100),
  }
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] }
}

// Zod shape for a scenario change-set (mirrors ScenarioChanges; re-validated by
// normalizeScenarioChanges before use).
const eventSchema = z.object({
  type: z.enum(["expense", "windfall", "recurring", "property"]),
  label: z.string().optional(),
  age: z.number(),
  amount: z.number().optional(),
  monthlyDelta: z.number().optional(),
  newValue: z.number().optional(),
  mortgageLtv: z.number().optional(),
  housingReturnOverride: z.number().optional(),
})
const changesSchema = z
  .object({
    overrides: z
      .object({
        monthlyContribution: z.number().optional(),
        annualSpending: z.number().optional(),
        retirementAge: z.number().optional(),
        startInvestments: z.number().optional(),
        cashBuffer: z.number().optional(),
      })
      .optional(),
    assumptionOverrides: z
      .object({
        housingReturn: z.number().optional(),
        investmentReturn: z.number().optional(),
        investmentFee: z.number().optional(),
        inflation: z.number().optional(),
        contributionGrowth: z.number().optional(),
        safeWithdrawalRate: z.number().optional(),
      })
      .optional(),
    addEvents: z.array(eventSchema).optional(),
  })
  .describe(
    "Changes layered on the base plan. Salary +X kr./mo invested ⇒ " +
      'addEvents:[{type:"recurring",age:<currentAge>,monthlyDelta:X}].'
  )

export function registerPlanningTools(server: McpServer): void {
  server.registerTool(
    "get_plan",
    {
      title: "Get the saved long-term plan",
      description:
        "Read the user's saved long-term financial plan: key inputs, existing " +
        "scenarios and the baseline projection (net worth at retirement and end " +
        "age, yearly pension after tax, financial-independence age, and the " +
        "Monte-Carlo success probability). Read-only.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const { state, grossMonthlySalary } = await loadPlan(extra as ToolExtra)
      return json({
        inputs: {
          currentAge: state.currentAge,
          retirementAge: state.retirementAge,
          endAge: state.endAge,
          monthlyContribution: state.monthlyContribution,
          annualSpending: state.annualSpending,
          startInvestments: state.startInvestments,
          cashBuffer: state.cashBuffer,
          investmentTaxMode: state.investmentTaxMode,
          household: state.pension.single ? "single" : "couple",
          grossMonthlySalary,
        },
        baseline: summaryReport(summarize(state)),
        scenarios: state.scenarios.map((s) => ({ id: s.id, name: s.name })),
        note: "Amounts are in DKK. 'real' = today's kroner; 'nominal' = future kroner.",
      })
    }
  )

  server.registerTool(
    "simulate_what_if",
    {
      title: "Simulate a what-if (read-only)",
      description:
        "Project the impact of a change WITHOUT saving anything. Returns the " +
        "baseline vs the modified plan and the deltas. Use this to answer " +
        '"what would happen if…" questions.',
      inputSchema: { changes: changesSchema },
    },
    async (args, extra) => {
      const { state } = await loadPlan(extra as ToolExtra)
      const changes = normalizeScenarioChanges(args.changes)
      const base = summarize(state)
      const scen = summarize(applyScenario(state, changes))
      return json({
        appliedChanges: changes,
        base: summaryReport(base),
        scenario: summaryReport(scen),
        delta: deltaReport(base, scen),
        note: "Read-only — nothing was saved. Call save_scenario to keep it.",
      })
    }
  )

  server.registerTool(
    "save_scenario",
    {
      title: "Save a named scenario",
      description:
        "Persist a named what-if to the user's plan so it appears in the app's " +
        "Scenarier card. Only call this when the user has confirmed they want it " +
        "saved. Returns the saved scenario's projection.",
      inputSchema: { name: z.string().min(1), changes: changesSchema },
    },
    async (args, extra) => {
      const { supabase, userId, state } = await loadPlan(extra as ToolExtra)
      const scenario: PlanningScenario = {
        id: newId("sc"),
        name: args.name.trim() || "Scenarie",
        createdAt: new Date().toISOString(),
        changes: normalizeScenarioChanges(args.changes),
      }
      const next: PlanningState = normalizePlanning({
        ...state,
        scenarios: [...state.scenarios, scenario],
      })
      await saveUserData(supabase, userId, { planning: next })
      return json({
        saved: { id: scenario.id, name: scenario.name },
        scenario: summaryReport(summarize(applyScenario(state, scenario.changes))),
        note: "Saved. It now shows in the app's Scenarier section.",
      })
    }
  )

  server.registerTool(
    "list_scenarios",
    {
      title: "List saved scenarios",
      description: "List the user's saved scenarios with their change-sets. Read-only.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const { state } = await loadPlan(extra as ToolExtra)
      return json({
        scenarios: state.scenarios.map((s) => ({
          id: s.id,
          name: s.name,
          createdAt: s.createdAt,
          changes: s.changes,
        })),
      })
    }
  )

  server.registerTool(
    "delete_scenario",
    {
      title: "Delete a saved scenario",
      description:
        "Remove a saved scenario by id. Only call this when the user has asked " +
        "to delete it.",
      inputSchema: { id: z.string().min(1) },
    },
    async (args, extra) => {
      const { supabase, userId, state } = await loadPlan(extra as ToolExtra)
      const exists = state.scenarios.some((s) => s.id === args.id)
      const next: PlanningState = normalizePlanning({
        ...state,
        scenarios: state.scenarios.filter((s) => s.id !== args.id),
      })
      await saveUserData(supabase, userId, { planning: next })
      return json({ deleted: exists, id: args.id })
    }
  )
}
