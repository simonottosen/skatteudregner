/**
 * MCP tools that let an LLM run "what-if" questions against the user's saved
 * long-term plan and (on explicit request) save named scenarios. Read-only by
 * default: `simulate_what_if` never writes; only `save_scenario` /
 * `delete_scenario` mutate, and only the scenarios list within the plan.
 */

import { z } from "zod"
import type { AuthInfo, McpServer } from "@modelcontextprotocol/server"
import { fetchUserData, saveUserData, type UserDataRow } from "@/lib/supabase/user-data"
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
import type {
  NewPlanningEvent,
  PlanningEvent,
  PlanningScenario,
  PlanningState,
} from "@/lib/planning/types"
import { createDefaultInput } from "@/lib/tax/defaults"
import {
  readPersistedTaxInputs,
  safeCalculateTax,
} from "@/lib/tax/persisted"
import type { TaxInput, TaxResult } from "@/lib/tax/types"
import {
  computeBudgetSummary,
  computeResultSummary,
  expensesByCategory,
  normalizeBudget,
} from "@/lib/budget/state"

/**
 * The slice of the SDK's tool context this module reads.
 *
 * `authInfo` lives under `http` because that is where an HTTP transport puts
 * it — `@modelcontextprotocol/server` v2 moved it there from the old top-level
 * `extra.authInfo`. Deliberately structural rather than an import of the SDK's
 * context type: it documents exactly what we depend on, and tool callbacks are
 * assigned to it without a cast so the compiler catches the next such move.
 */
interface ToolExtra {
  /** Present on HTTP requests; absent on stdio, which has no per-request identity. */
  http?: { authInfo?: AuthInfo }
}

export interface PlanningToolsOptions {
  /**
   * Auth to fall back on when the transport carries none per request. The HTTP
   * route authenticates every request and the SDK surfaces that as
   * `ctx.http.authInfo`, but a stdio bundle signs in once at startup and has no
   * per-request identity — it passes that single session in here.
   *
   * May be async so a long-lived session can refresh an expiring token before
   * the call goes out.
   */
  getAuthInfo?: () => AuthInfo | undefined | Promise<AuthInfo | undefined>
}

/** Load the user's data: RLS-scoped client, the raw row, and the normalized plan. */
async function loadPlan(
  extra: ToolExtra,
  getFallbackAuth?: PlanningToolsOptions["getAuthInfo"]
): Promise<{
  supabase: ReturnType<typeof userClientFromAuth>["supabase"]
  userId: string
  row: UserDataRow | null
  state: PlanningState
  grossMonthlySalary: number | null
}> {
  const { supabase, userId } = userClientFromAuth(extra.http?.authInfo ?? (await getFallbackAuth?.()))
  const row = await fetchUserData(supabase, userId)
  const state = normalizePlanning(row?.planning)
  // Best-effort gross salary hint so the LLM can turn "5 % of salary" into kr.
  let grossMonthlySalary: number | null = null
  const inputs = readPersistedTaxInputs(row?.tax_input)
  if (inputs[0] && inputs[0].workIncome > 0) {
    grossMonthlySalary = Math.round(inputs[0].workIncome / 12)
  }
  return { supabase, userId, row, state, grossMonthlySalary }
}

const round = (n: number) => Math.round(n)
/** A rate (0–1) as a percentage with one decimal. */
const pct1 = (rate: number) => Math.round(rate * 1000) / 10
const dual = (d: DualAmount) => ({ nominal: round(d.nominal), real: round(d.real) })

/** Per-person monthly take-home from the persisted tax inputs (0 if missing). */
function monthlyNet(inputs: TaxInput[], index: number): number {
  const inp = inputs[index]
  if (!inp) return 0
  const r = safeCalculateTax(inp)
  return r ? r.netIncome / 12 : 0
}

/** Headline figures for one person's tax result. */
function taxHeadline(input: TaxInput, r: TaxResult) {
  return {
    municipality: input.municipality,
    year: input.year,
    grossIncome: round(r.amBasis + r.insuranceBasis + r.nonAmIncome),
    netIncome: round(r.netIncome),
    totalTax: round(r.totalTax),
    effectiveTaxRatePct: pct1(r.effectiveTaxRate),
    marginalTaxRatePct: pct1(r.marginalTaxRate),
    breakdown: {
      amBidrag: round(r.amBidrag),
      bundSkat: round(r.bundSkat),
      mellemSkat: round(r.mellemSkat),
      topSkat: round(r.topSkat),
      topTopSkat: round(r.topTopSkat),
      kommuneSkat: round(r.kommuneSkat),
      kirkeSkat: round(r.kirkeSkat),
      stockTax: round(r.totalStockTax),
      propertyTax: round(r.totalPropertyTax),
    },
  }
}

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
  propertyTaxInBudget: z.boolean().optional(),
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

/** Curated subset of TaxInput for the ad-hoc `compute_tax` what-if. */
const taxInputSchema = z.object({
  year: z.union([z.literal(2024), z.literal(2025), z.literal(2026)]).optional(),
  municipality: z.string().optional(),
  churchMember: z.boolean().optional(),
  married: z.boolean().optional(),
  workIncome: z.number().optional(),
  honorarIncome: z.number().optional(),
  otherAmIncome: z.number().optional(),
  transferIncome: z.number().optional(),
  suIncome: z.number().optional(),
  otherNonAmIncome: z.number().optional(),
  employeePension: z.number().optional(),
  privatePensionRatepension: z.number().optional(),
  privatePensionLivrente: z.number().optional(),
  stockSaleGains: z.number().optional(),
  danishDividends: z.number().optional(),
  mortgageInterest: z.number().optional(),
})

export function registerPlanningTools(
  server: McpServer,
  options: PlanningToolsOptions = {}
): void {
  /** Per-request auth when the transport has it, else the process-wide session. */
  const load = (extra: ToolExtra) => loadPlan(extra, options.getAuthInfo)

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
      const { state, grossMonthlySalary } = await load(extra)
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
      const { state } = await load(extra)
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
      const { supabase, userId, state } = await load(extra)
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
      const { state } = await load(extra)
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
      const { supabase, userId, state } = await load(extra)
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
      const { state } = await load(extra)
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
      const { state } = await load(extra)
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
      const { supabase, userId, state } = await load(extra)
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
      const { supabase, userId, state } = await load(extra)
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

  // --- Tax (Skat) --------------------------------------------------------

  server.registerTool(
    "get_tax",
    {
      title: "Get the saved tax result (take-home, rates)",
      description:
        "Compute the user's tax from their saved tax input: take-home (net) " +
        "income, total tax, effective + marginal rates and the full breakdown, " +
        "per household person plus a household total. Read-only. Amounts are " +
        "yearly in DKK unless named *Monthly.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const { row } = await load(extra)
      const inputs = readPersistedTaxInputs(row?.tax_input)
      if (inputs.length === 0) {
        return json({ note: "No saved tax input — fill in the Skat page first." })
      }
      const people = inputs.map((inp, i) => {
        const r = safeCalculateTax(inp)
        return r
          ? { person: i + 1, ...taxHeadline(inp, r) }
          : { person: i + 1, error: `Unknown municipality: ${inp.municipality}` }
      })
      const results = inputs
        .map((inp) => safeCalculateTax(inp))
        .filter((r): r is TaxResult => r !== null)
      const h = computeResultSummary(results)
      return json({
        people,
        household: {
          grossYear: round(h.grossYear),
          taxYear: round(h.taxYear),
          netYear: round(h.netYear),
          netMonthly: round(h.netMonthly),
          effectiveTaxRatePct: pct1(h.effectiveRate),
        },
      })
    }
  )

  server.registerTool(
    "compute_tax",
    {
      title: "Compute tax for an ad-hoc income (what-if)",
      description:
        "Compute take-home / marginal & effective rate for a hypothetical " +
        "income WITHOUT saving anything. Starts from the user's first saved " +
        "person (kommune, deductions, …) and applies the provided overrides. " +
        "Read-only. Amounts are yearly DKK.",
      inputSchema: { input: taxInputSchema },
    },
    async (args, extra) => {
      const { row } = await load(extra)
      const base = readPersistedTaxInputs(row?.tax_input)[0] ?? createDefaultInput()
      const merged = { ...base, ...args.input } as TaxInput
      const r = safeCalculateTax(merged)
      if (!r) {
        return json({
          error: `Could not compute (check municipality "${merged.municipality}" and year ${merged.year}).`,
        })
      }
      return json({ appliedInput: args.input, result: taxHeadline(merged, r) })
    }
  )

  // --- Budget ------------------------------------------------------------

  server.registerTool(
    "get_budget",
    {
      title: "Get the monthly budget",
      description:
        "Read the user's monthly budget: income (per person + total), expenses " +
        "(total + per category), realkredit payment, monthly surplus and savings " +
        "rate. Income from the tax page uses the computed take-home. Read-only. " +
        "Monthly DKK.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const { row } = await load(extra)
      const budget = normalizeBudget(row?.budget_items)
      const inputs = readPersistedTaxInputs(row?.tax_input)
      const s = computeBudgetSummary(budget, monthlyNet(inputs, 0), monthlyNet(inputs, 1))
      return json({
        household: s.mode,
        income: {
          total: round(s.budgetIncome),
          person1: round(s.p1Income),
          person2: round(s.p2Income),
        },
        expenses: {
          total: round(s.budgetExpenses),
          byCategory: expensesByCategory(budget).map((c) => ({
            name: c.name,
            total: round(c.total),
          })),
        },
        mortgageMonthly: round(s.mortgageMonthly),
        remaining: round(s.remaining),
        savingsRatePct: pct1(s.savingsRate),
      })
    }
  )

  // --- Resultat (combined) ----------------------------------------------

  server.registerTool(
    "get_result",
    {
      title: "Get the combined result (tax + budget key figures)",
      description:
        "The Resultat page's headline figures: monthly gross, tax and take-home " +
        "(from the tax page) alongside the budget's income, expenses, surplus and " +
        "savings rate. Read-only. Monthly DKK unless noted.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const { row } = await load(extra)
      const budget = normalizeBudget(row?.budget_items)
      const inputs = readPersistedTaxInputs(row?.tax_input)
      const results = inputs
        .map((inp) => safeCalculateTax(inp))
        .filter((r): r is TaxResult => r !== null)
      const tax = computeResultSummary(results)
      const b = computeBudgetSummary(budget, monthlyNet(inputs, 0), monthlyNet(inputs, 1))
      return json({
        tax: {
          grossMonthly: round(tax.grossMonthly),
          taxMonthly: round(tax.taxMonthly),
          netMonthly: round(tax.netMonthly),
          effectiveTaxRatePct: pct1(tax.effectiveRate),
        },
        budget: {
          income: round(b.budgetIncome),
          expenses: round(b.budgetExpenses),
          mortgageMonthly: round(b.mortgageMonthly),
          remaining: round(b.remaining),
          savingsRatePct: pct1(b.savingsRate),
        },
      })
    }
  )

  // --- Base-plan events (Større ændringer) -------------------------------

  server.registerTool(
    "add_event",
    {
      title: "Add a life event to the plan",
      description:
        "Add a one-off/recurring life event to the base plan's 'Større " +
        "ændringer' (expense, windfall, recurring saving change, or property " +
        "sale/buy). Writes — only call on the user's request.",
      inputSchema: { event: eventSchema },
    },
    async (args, extra) => {
      const { supabase, userId, state } = await load(extra)
      const event = { id: newId("pe"), ...args.event } as PlanningEvent
      const next = normalizePlanning({ ...state, events: [...state.events, event] })
      await saveUserData(supabase, userId, { planning: next })
      return json({
        added: true,
        event: next.events.find((e) => e.id === event.id) ?? event,
      })
    }
  )

  server.registerTool(
    "update_event",
    {
      title: "Edit a life event",
      description:
        "Replace a base-plan event's fields by id (provide the full event). " +
        "Writes — only call on the user's request.",
      inputSchema: { id: z.string().min(1), event: eventSchema },
    },
    async (args, extra) => {
      const { supabase, userId, state } = await load(extra)
      if (!state.events.some((e) => e.id === args.id)) {
        return json({ updated: false, id: args.id, note: "Event not found." })
      }
      const replaced = { id: args.id, ...(args.event as NewPlanningEvent) } as PlanningEvent
      const next = normalizePlanning({
        ...state,
        events: state.events.map((e) => (e.id === args.id ? replaced : e)),
      })
      await saveUserData(supabase, userId, { planning: next })
      return json({
        updated: true,
        event: next.events.find((e) => e.id === args.id),
      })
    }
  )

  server.registerTool(
    "remove_event",
    {
      title: "Remove a life event",
      description:
        "Remove a base-plan event by id. Writes — only call on the user's request.",
      inputSchema: { id: z.string().min(1) },
    },
    async (args, extra) => {
      const { supabase, userId, state } = await load(extra)
      const exists = state.events.some((e) => e.id === args.id)
      const next = normalizePlanning({
        ...state,
        events: state.events.filter((e) => e.id !== args.id),
      })
      await saveUserData(supabase, userId, { planning: next })
      return json({ removed: exists, id: args.id })
    }
  )
}
