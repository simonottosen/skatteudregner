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
import {
  simulatePlanning,
  solveRequiredMonthlyContribution,
} from "@/lib/planning/simulate"
import {
  summarize,
  toTodayKroner,
  type DualAmount,
  type PlanningSummary,
} from "@/lib/planning/summary"
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

// Zod shapes (mirror the planning types; everything is re-validated/clamped by
// normalizeScenarioChanges / normalizePlanning before use).
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

/** Top-level scalar plan fields that can be overridden/edited. */
const scalarFieldsSchema = z.object({
  monthlyContribution: z.number().optional(),
  annualSpending: z.number().optional(),
  retirementAge: z.number().optional(),
  startInvestments: z.number().optional(),
  cashBuffer: z.number().optional(),
  investmentTaxMode: z.enum(["realisation", "lager", "ask"]).optional(),
  homeValue: z.number().optional(),
  landValue: z.number().optional(),
  includePropertyTax: z.boolean().optional(),
  mortgageBalance: z.number().optional(),
  mortgageRate: z.number().optional(),
  mortgageTermYears: z.number().optional(),
  otherDebtBalance: z.number().optional(),
  otherDebtRate: z.number().optional(),
  otherDebtTermYears: z.number().optional(),
})

const assumptionsSchema = z.object({
  housingReturn: z.number().optional(),
  investmentReturn: z.number().optional(),
  investmentFee: z.number().optional(),
  volatility: z.number().optional(),
  housingVolatility: z.number().optional(),
  inflation: z.number().optional(),
  contributionGrowth: z.number().optional(),
  safeWithdrawalRate: z.number().optional(),
})

/** Shared pension fields a scenario may override. */
const pensionSharedSchema = z.object({
  pensionReturn: z.number().optional(),
  ratepensionYears: z.number().optional(),
  single: z.boolean().optional(),
  includeFolkepension: z.boolean().optional(),
})

const taxSchema = z.object({
  year: z.number().optional(),
  municipality: z.string().optional(),
  churchMember: z.boolean().optional(),
})

const changesSchema = z
  .object({
    overrides: scalarFieldsSchema.optional(),
    assumptionOverrides: assumptionsSchema.optional(),
    pensionOverrides: pensionSharedSchema.optional(),
    taxOverrides: taxSchema.optional(),
    addEvents: z.array(eventSchema).optional(),
  })
  .describe(
    "Changes layered on the base plan. Salary +X kr./mo invested ⇒ " +
      'addEvents:[{type:"recurring",age:<currentAge>,monthlyDelta:X}]. ' +
      "Also supports overriding mortgage, other debt, home/land value, " +
      "investmentTaxMode, includePropertyTax, shared pension fields and the " +
      "tax profile (kommune/kirkeskat/year)."
  )

/** Per-person pension pots a base-plan edit may set. */
const pensionPersonSchema = z.object({
  ratepensionBalance: z.number().optional(),
  livrenteBalance: z.number().optional(),
  aldersopsparingBalance: z.number().optional(),
  ratepensionAnnual: z.number().optional(),
  livrenteAnnual: z.number().optional(),
  aldersopsparingAnnual: z.number().optional(),
  folkepensionAge: z.number().optional(),
})

export function registerPlanningTools(server: McpServer): void {
  server.registerTool(
    "get_plan",
    {
      title: "Get the saved long-term plan",
      description:
        "Read the user's full saved long-term financial plan (all inputs, " +
        "assumptions, pension, tax profile, events and scenarios) plus the " +
        "baseline projection (net worth at retirement and end age, yearly " +
        "pension after tax, financial-independence age, and the Monte-Carlo " +
        "success probability). Read-only.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const { state, grossMonthlySalary } = await loadPlan(extra as ToolExtra)
      return json({
        plan: state,
        grossMonthlySalary,
        baseline: summaryReport(summarize(state)),
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

  server.registerTool(
    "solve_required_saving",
    {
      title: "Solve required monthly saving for FI",
      description:
        "Compute the smallest monthly saving needed to become financially " +
        "independent by the retirement age (binary search on the median Monte-" +
        "Carlo path). Read-only.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const { state } = await loadPlan(extra as ToolExtra)
      const required = solveRequiredMonthlyContribution(state)
      const note =
        required === null
          ? `Økonomisk uafhængighed nås ikke inden pensionsalderen (${state.retirementAge}).`
          : required <= state.monthlyContribution
            ? "Allerede på vej — nuværende opsparing er nok."
            : `Spar ca. ${required} kr./md. for at nå FI som ${state.retirementAge}-årig.`
      return json({
        requiredMonthlyContribution: required,
        currentMonthlyContribution: state.monthlyContribution,
        retirementAge: state.retirementAge,
        note,
      })
    }
  )

  server.registerTool(
    "get_trajectory",
    {
      title: "Get the year-by-year projection",
      description:
        "Return the full year-by-year projection (the same data as the app's CSV " +
        "export): net worth, investments, cash, home equity, other debt, the " +
        "p10/p90 band, pension after tax, spending, investments sold, equity " +
        "borrowed and tax paid. Pass `changes` to get a what-if trajectory. " +
        "Read-only.",
      inputSchema: {
        basis: z.enum(["real", "nominal"]).optional(),
        changes: changesSchema.optional(),
      },
    },
    async (args, extra) => {
      const { state } = await loadPlan(extra as ToolExtra)
      const effective = args.changes
        ? applyScenario(state, normalizeScenarioChanges(args.changes))
        : state
      const basis = args.basis ?? "real"
      let result = simulatePlanning(effective)
      if (basis === "real") {
        result = toTodayKroner(
          result,
          effective.assumptions.inflation,
          effective.currentAge
        )
      }
      const thisYear = new Date().getFullYear()
      const rows = result.points.map((p) => ({
        age: p.age,
        year: thisYear + (p.age - effective.currentAge),
        netWorth: round(p.netWorth),
        investments: round(p.investments),
        cash: round(p.cash),
        homeEquity: round(p.homeEquity),
        otherDebt: round(p.otherDebt),
        netWorthP10: round(p.band[0]),
        netWorthP90: round(p.band[1]),
        pensionAfterTax: round(p.retirementIncome),
        spending: round(p.spending),
        investmentsSold: round(p.investmentsSold),
        borrowed: round(p.borrowed),
        taxPaid: round(p.taxPaid),
      }))
      return json({
        basis,
        fiAge: result.fiAge,
        debtFreeAge: result.debtFreeAge,
        ruinAge: result.ruinAge,
        successProbabilityPct: Math.round(result.successProbability * 100),
        rows,
      })
    }
  )

  server.registerTool(
    "update_plan",
    {
      title: "Edit the base plan",
      description:
        "Update the user's saved base plan in place (NOT a scenario). Only call " +
        "this when the user has asked to change their actual plan. Any omitted " +
        "field is left unchanged; values are clamped to valid ranges. Returns " +
        "the updated plan and its projection.",
      inputSchema: {
        fields: scalarFieldsSchema.optional(),
        assumptions: assumptionsSchema.optional(),
        pension: pensionSharedSchema
          .extend({
            person1: pensionPersonSchema.optional(),
            person2: pensionPersonSchema.optional(),
          })
          .optional(),
        tax: taxSchema.optional(),
      },
    },
    async (args, extra) => {
      const { supabase, userId, state } = await loadPlan(extra as ToolExtra)
      const p = args.pension
      const next: PlanningState = normalizePlanning({
        ...state,
        ...(args.fields ?? {}),
        assumptions: { ...state.assumptions, ...(args.assumptions ?? {}) },
        pension: {
          ...state.pension,
          ...(p ?? {}),
          person1: { ...state.pension.person1, ...(p?.person1 ?? {}) },
          person2: { ...state.pension.person2, ...(p?.person2 ?? {}) },
        },
        tax: { ...state.tax, ...(args.tax ?? {}) },
      })
      await saveUserData(supabase, userId, { planning: next })
      return json({
        updated: true,
        plan: next,
        baseline: summaryReport(summarize(next)),
        note: "Base plan saved. The change is now visible in the app.",
      })
    }
  )

  server.registerTool(
    "update_scenario",
    {
      title: "Rename or edit a saved scenario",
      description:
        "Update a saved scenario's name and/or its change-set by id. Only call " +
        "this when the user has asked to edit a scenario.",
      inputSchema: {
        id: z.string().min(1),
        name: z.string().optional(),
        changes: changesSchema.optional(),
      },
    },
    async (args, extra) => {
      const { supabase, userId, state } = await loadPlan(extra as ToolExtra)
      const existing = state.scenarios.find((s) => s.id === args.id)
      if (!existing) {
        return json({ updated: false, id: args.id, note: "Scenario not found." })
      }
      const updated: PlanningScenario = {
        ...existing,
        name: args.name?.trim() || existing.name,
        changes: args.changes
          ? normalizeScenarioChanges(args.changes)
          : existing.changes,
      }
      const next: PlanningState = normalizePlanning({
        ...state,
        scenarios: state.scenarios.map((s) => (s.id === args.id ? updated : s)),
      })
      await saveUserData(supabase, userId, { planning: next })
      return json({
        updated: true,
        scenario: { id: updated.id, name: updated.name },
        summary: summaryReport(summarize(applyScenario(state, updated.changes))),
      })
    }
  )
}
