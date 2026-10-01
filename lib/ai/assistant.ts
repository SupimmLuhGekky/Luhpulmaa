import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { addDays, formatDate, monthKey, todayIn, type LocalDate } from "@/lib/dates";
import { formatBps, formatCurrency, toCents } from "@/lib/finance/money";
import { calculateGoalProgress } from "@/lib/finance/calculations";
import { isEnabled } from "@/lib/flags";
import { AppError } from "@/lib/api/errors";
import { userPreferences } from "@/lib/settings/preferences";
import { cashTotals } from "@/lib/accounts/service";
import { analytics } from "@/lib/analytics/service";
import { billOccurrences } from "@/lib/bills/service";
import { budgetView, findBudget } from "@/lib/budget/service";
import { cashFlowForecast, safeToSpend } from "@/lib/forecast/service";
import { listGoals } from "@/lib/goals/service";
import { currentNetWorth } from "@/lib/networth/service";
import { listSubscriptions } from "@/lib/subscriptions/service";
import { listTransactions } from "@/lib/transactions/service";
import { transactionFiltersSchema } from "@/lib/transactions/schemas";
import { AI_MODEL, aiClient } from "./client";
import { conversationFor } from "./history";

/**
 * Optional financial assistant (ENABLE_AI_ASSISTANT + ANTHROPIC_API_KEY + user opt-in).
 *
 * Guarantees:
 *  - Every tool is read-only and scoped to the signed-in user's id, which comes from
 *    the session and is never taken from model output.
 *  - There is no tool that moves money, edits data or contacts anyone.
 *  - Facts shown to the user are produced by our own code from tool results, not by
 *    the model; the model's text is labelled as an explanation.
 *  - It gives information, not regulated financial advice.
 */

export interface AssistantFact {
  label: string;
  value: string;
  basis: string;
}

export interface AssistantAnswer {
  answer: string;
  facts: AssistantFact[];
  toolsUsed: string[];
  source: "ai" | "unavailable";
}

export const assistantRequestSchema = z.object({
  question: z.string().trim().min(1, "Ask a question").max(1000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(12)
    .default([]),
});

type Period = "this_month" | "last_month" | "last_90_days" | "this_year";

interface ToolContext {
  userId: string;
  today: LocalDate;
  currency: string;
  locale: string;
}

interface ToolOutput {
  facts: AssistantFact[];
  data: unknown;
}

const PERIODS: Period[] = ["this_month", "last_month", "last_90_days", "this_year"];

function periodRange(period: Period, today: LocalDate): { from: LocalDate; to: LocalDate; label: string } {
  const month = monthKey(today);
  switch (period) {
    case "last_month": {
      const start = `${monthKey(addDays(`${month}-01`, -1))}-01`;
      return { from: start, to: addDays(`${month}-01`, -1), label: "last month" };
    }
    case "last_90_days":
      return { from: addDays(today, -89), to: today, label: "the last 90 days" };
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "this year" };
    default:
      return { from: `${month}-01`, to: today, label: "this month" };
  }
}

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "get_financial_overview",
    description: "Net worth, total cash, spendable cash and safe-to-spend until the next payday for the current user.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_spending_by_category",
    description: "Income, spending and spending per category for a period, compared with the previous period.",
    input_schema: {
      type: "object",
      properties: { period: { type: "string", enum: PERIODS, description: "Time period to analyse." } },
      required: ["period"],
      additionalProperties: false,
    },
  },
  {
    name: "search_transactions",
    description: "Search the user's transactions by merchant/description text within a period. Returns at most 20 rows plus totals.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to match in merchant, description or notes." },
        period: { type: "string", enum: PERIODS },
        direction: { type: "string", enum: ["money_in", "money_out", "any"] },
      },
      required: ["period"],
      additionalProperties: false,
    },
  },
  {
    name: "get_budget_status",
    description: "This month's budget: budgeted, spent and remaining per category.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_goals",
    description: "Savings goals with progress, deadline and the contribution needed per week/month.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_upcoming_bills",
    description: "Unpaid bills due in the next N days.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 60 } },
      required: ["days"],
      additionalProperties: false,
    },
  },
  {
    name: "get_subscriptions",
    description: "Active subscriptions with monthly and yearly totals.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_cash_flow_forecast",
    description: "Estimated cash-flow for the next 7, 30, 60 or 90 days (an estimate, not a guarantee).",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", enum: [7, 30, 60, 90] } },
      required: ["days"],
      additionalProperties: false,
    },
  },
];

async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutput> {
  const money = (cents: number) => formatCurrency(cents, { currency: ctx.currency, locale: ctx.locale });
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const period = (PERIODS.includes(input.period as Period) ? input.period : "this_month") as Period;

  switch (name) {
    case "get_financial_overview": {
      const prefs = await userPreferences(ctx.userId);
      const [nw, cash, sts] = await Promise.all([currentNetWorth(ctx.userId), cashTotals(ctx.userId, prefs.includeSavingsInSafeToSpend), safeToSpend(ctx.userId)]);
      return {
        facts: [
          { label: "Net worth", value: money(nw.netWorth), basis: `Assets ${money(nw.assets)} minus debts ${money(nw.liabilities)} across ${nw.accountCount} account(s)` },
          { label: "Cash in chequing/savings", value: money(cash.total), basis: "Latest synced or entered balances" },
          { label: "Safe to spend", value: money(sts.safeToSpend), basis: sts.nextPayday ? `Until next expected payday ${sts.nextPayday}` : "Over the next 14 days (no payday detected)" },
        ],
        data: {
          netWorth: money(nw.netWorth),
          assets: money(nw.assets),
          liabilities: money(nw.liabilities),
          cashTotal: money(cash.total),
          spendableCash: money(cash.available),
          safeToSpend: money(sts.safeToSpend),
          safeToSpendPerDay: money(sts.perDay),
          nextPayday: sts.nextPayday,
          safeToSpendBreakdown: sts.lines.map((l) => ({ item: l.label, amount: money(l.sign * l.amount) })),
          shortfall: sts.shortfall > 0 ? money(sts.shortfall) : null,
        },
      };
    }
    case "get_spending_by_category": {
      const r = periodRange(period, ctx.today);
      const a = await analytics(ctx.userId, { range: "custom", from: r.from, to: r.to });
      const top = a.categoryBreakdown.slice(0, 12);
      return {
        facts: [
          { label: `Spending ${r.label}`, value: money(a.metrics.spending), basis: `Transactions ${r.from} to ${r.to}, excluding transfers` },
          { label: `Income ${r.label}`, value: money(a.metrics.income), basis: `Transactions ${r.from} to ${r.to}` },
          ...(top[0] ? [{ label: "Largest category", value: `${top[0].name} · ${money(top[0].spending)}`, basis: `${formatBps(top[0].shareBps)} of spending ${r.label}` }] : []),
        ],
        data: {
          from: r.from,
          to: r.to,
          income: money(a.metrics.income),
          spending: money(a.metrics.spending),
          previousPeriodSpending: money(a.metrics.previous.spending),
          previousPeriodIncome: money(a.metrics.previous.income),
          savingsRate: formatBps(a.metrics.savingsRateBps),
          categories: top.map((c) => ({ name: c.name, spending: money(c.spending), previousPeriod: money(c.previous), share: formatBps(c.shareBps) })),
          topMerchants: a.merchants.slice(0, 5).map((m) => ({ name: m.merchant, spending: money(m.spending), count: m.count })),
        },
      };
    }
    case "search_transactions": {
      const r = periodRange(period, ctx.today);
      const query = typeof input.query === "string" ? input.query.slice(0, 100) : undefined;
      const filters = transactionFiltersSchema.parse({ q: query || undefined, from: r.from, to: r.to, pageSize: 20 });
      const result = await listTransactions(ctx.userId, filters);
      const dir = input.direction === "money_in" ? 1 : input.direction === "money_out" ? -1 : 0;
      const rows = result.rows.filter((t) => (dir === 0 ? true : Math.sign(t.amountCents) === dir));
      return {
        facts: [
          {
            label: query ? `Transactions matching “${query}”` : `Transactions ${r.label}`,
            value: `${result.total} found`,
            basis: `Money in ${money(result.totals.inflow)}, money out ${money(result.totals.outflow)} (${r.from} to ${r.to})`,
          },
        ],
        data: {
          totalMatches: result.total,
          moneyIn: money(result.totals.inflow),
          moneyOut: money(result.totals.outflow),
          shown: rows.map((t) => ({ date: t.date, merchant: t.merchantName, amount: money(t.amountCents), category: t.category?.name ?? "Uncategorized", pending: t.isPending })),
        },
      };
    }
    case "get_budget_status": {
      const budget = await findBudget(ctx.userId, "MONTHLY", `${monthKey(ctx.today)}-01`);
      if (!budget) return { facts: [{ label: "Budget", value: "None this month", basis: "No monthly budget exists yet" }], data: { budget: null } };
      const view = await budgetView(ctx.userId, budget.id);
      return {
        facts: [
          { label: "Budgeted this month", value: money(view.totals.budgeted), basis: `${view.lines.length} budget line(s)` },
          { label: "Spent against budget", value: money(view.totals.spent), basis: `Plus ${money(view.totals.unbudgetedSpent)} in categories without a budget` },
          { label: "Left in budget", value: money(view.totals.remaining), basis: "Budgeted plus rollovers, minus spending" },
        ],
        data: {
          period: `${view.budget.start} to ${view.budget.end}`,
          lines: view.lines.map((l) => ({ category: l.name, budgeted: money(l.available), spent: money(l.spent), remaining: money(l.remaining), status: l.status })),
          unbudgeted: view.unbudgeted.slice(0, 8).map((u) => ({ category: u.name, spent: money(u.spent) })),
        },
      };
    }
    case "get_goals": {
      const goals = await listGoals(ctx.userId);
      const rows = goals.map((g) => {
        const p = calculateGoalProgress(toCents(g.targetCents), toCents(g.currentCents), g.deadline ? g.deadline.toISOString().slice(0, 10) : null, ctx.today);
        return { g, p };
      });
      return {
        facts: rows.slice(0, 6).map(({ g, p }) => ({
          label: g.name,
          value: `${money(p.current)} of ${money(p.target)}`,
          basis: p.requiredMonthly !== null && !p.isComplete ? `About ${money(p.requiredMonthly)}/month needed to reach it by the deadline` : p.isComplete ? "Goal reached" : "No deadline set",
        })),
        data: rows.map(({ g, p }) => ({
          name: g.name,
          status: g.status,
          saved: money(p.current),
          target: money(p.target),
          remaining: money(p.remaining),
          progress: formatBps(p.progressBps),
          deadline: g.deadline ? g.deadline.toISOString().slice(0, 10) : null,
          requiredPerWeek: p.requiredWeekly === null ? null : money(p.requiredWeekly),
          requiredPerMonth: p.requiredMonthly === null ? null : money(p.requiredMonthly),
          note: "Goal balances track money the user set aside; they are not held by this app.",
        })),
      };
    }
    case "get_upcoming_bills": {
      const days = Math.min(60, Math.max(1, Number(input.days) || 14));
      const occ = (await billOccurrences(ctx.userId, ctx.today, addDays(ctx.today, days - 1))).filter((o) => !o.paid);
      const total = occ.reduce((a, o) => a + o.amountCents, 0);
      return {
        facts: [{ label: `Bills due in the next ${days} days`, value: money(total), basis: `${occ.length} unpaid bill(s)` }],
        data: occ.map((o) => ({ name: o.name, due: o.dueDate, amount: money(o.amountCents), estimated: o.isVariableAmount, autopay: o.autopay })),
      };
    }
    case "get_subscriptions": {
      const subs = await listSubscriptions(ctx.userId, ctx.today);
      return {
        facts: [{ label: "Subscriptions", value: `${money(subs.totals.monthly)}/month`, basis: `${subs.totals.count} active, ${money(subs.totals.yearly)} per year` }],
        data: subs.rows.filter((s) => s.status === "ACTIVE").map((s) => ({ name: s.name, amount: money(s.amountCents), frequency: s.frequency, nextCharge: s.nextChargeDate, monthly: money(s.monthlyCents) })),
      };
    }
    case "get_cash_flow_forecast": {
      const allowed = [7, 30, 60, 90] as const;
      const days = allowed.find((d) => d === Number(input.days)) ?? 30;
      const f = await cashFlowForecast(ctx.userId, days);
      return {
        facts: [
          { label: `Estimated balance in ${days} days`, value: money(f.endingBalance), basis: "Estimate from expected pay, bills, subscriptions and typical spending" },
          { label: "Lowest estimated balance", value: money(f.lowestBalance), basis: `On ${f.lowestBalanceDate}` },
        ],
        data: {
          estimate: true,
          startingCash: money(f.startingBalance),
          endingBalance: money(f.endingBalance),
          lowestBalance: money(f.lowestBalance),
          lowestDate: f.lowestBalanceDate,
          expectedInflows: money(f.totalInflow),
          expectedOutflows: money(f.totalOutflow),
          typicalDailySpending: money(f.dailyDiscretionary),
          daysBelowMinimumBuffer: f.belowBuffer.length,
          nextEvents: f.upcoming.slice(0, 15).map((e) => ({ date: e.date, label: e.label, amount: money(e.amount), kind: e.kind })),
        },
      };
    }
    default:
      throw new AppError("BAD_REQUEST", `Unknown tool ${name}`);
  }
}

const SYSTEM_PROMPT = `You are Harbour's budgeting assistant. Harbour is a personal finance organisation app for people in Canada; it is not a bank and cannot move, hold or transfer money.

Rules:
- Use the tools to look up the user's own data before answering any question about their finances. Never invent numbers; only state amounts that appear in tool results, and say which period they cover.
- You cannot take actions: you cannot move money, pay bills, change budgets or edit transactions. If asked, explain how the user can do it themselves in the app (e.g. "Budget → Add line").
- Give general, factual information and explanations of the user's data. Do not give personalised investment, tax or legal advice; suggest a qualified professional for those.
- Forecasts and safe-to-spend are estimates; say so when you use them.
- Goal balances are money the user has set aside, not money held by Harbour.
- Be concise: a short direct answer first, then at most a few bullet points. Use the same language as the user (English or French).`;

function localeFor(locale: string) {
  return locale.startsWith("fr") ? "fr-CA" : "en-CA";
}

/** Human-readable names for the read-only tools, shown under each answer. */
export const ASSISTANT_TOOL_LABELS: Record<string, string> = {
  get_financial_overview: "Net worth & safe-to-spend",
  get_spending_by_category: "Spending by category",
  search_transactions: "Transaction search",
  get_budget_status: "This month's budget",
  get_goals: "Savings goals",
  get_upcoming_bills: "Upcoming bills",
  get_subscriptions: "Subscriptions",
  get_cash_flow_forecast: "Cash-flow forecast",
};

export interface AssistantStatus {
  /** ENABLE_AI_ASSISTANT is on for this server. */
  enabled: boolean;
  /** An API key is configured. */
  configured: boolean;
  /** The user turned on AI features in Settings → Data & privacy. */
  optedIn: boolean;
}

export async function assistantStatus(userId: string): Promise<AssistantStatus> {
  const prefs = await userPreferences(userId);
  return { enabled: isEnabled("ENABLE_AI_ASSISTANT"), configured: Boolean(aiClient()), optedIn: prefs.aiOptIn };
}

/**
 * Answers a question with a manual tool-use loop. Returns the explanation text plus
 * facts computed by our own code from whatever data the model looked up.
 */
export async function askAssistant(userId: string, input: z.infer<typeof assistantRequestSchema>): Promise<AssistantAnswer> {
  if (!isEnabled("ENABLE_AI_ASSISTANT")) throw new AppError("FEATURE_DISABLED", "The assistant is turned off on this server.");
  const prefs = await userPreferences(userId);
  if (!prefs.aiOptIn) throw new AppError("FORBIDDEN", "Turn on AI features in Settings → Data & Privacy to use the assistant.");
  const client = aiClient();
  if (!client) return { answer: "The assistant isn't configured on this server (no API key).", facts: [], toolsUsed: [], source: "unavailable" };

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true, currency: true, locale: true } });
  const ctx: ToolContext = { userId, today: todayIn(user.timeZone), currency: user.currency, locale: localeFor(user.locale) };
  const messages: Anthropic.Messages.MessageParam[] = conversationFor(input.history, input.question).map((m) => ({ role: m.role, content: m.content }));
  const facts: AssistantFact[] = [];
  const toolsUsed: string[] = [];
  const system = `${SYSTEM_PROMPT}\n\nToday is ${formatDate(ctx.today, "long", ctx.locale)} (${ctx.today}). Currency: ${ctx.currency}.`;

  try {
    for (let step = 0; step < 6; step++) {
      const response = await client.messages.create({
        model: AI_MODEL,
        // Adaptive thinking shares this budget with the answer; keep room so replies aren't cut off.
        max_tokens: 16000,
        system,
        tools: TOOLS,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        messages,
      });
      if (response.stop_reason === "refusal") {
        return { answer: "I can't help with that request. I can answer questions about your spending, budgets, bills, goals and cash flow.", facts, toolsUsed, source: "ai" };
      }
      const toolUses = response.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        const text = response.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        const truncated = response.stop_reason === "max_tokens" ? "\n\n(Answer shortened.)" : "";
        return { answer: (text || "I couldn't produce an answer. Please rephrase your question.") + truncated, facts: dedupeFacts(facts), toolsUsed, source: "ai" };
      }
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        toolsUsed.push(use.name);
        try {
          const out = await runTool(use.name, use.input, ctx);
          facts.push(...out.facts);
          results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out.data) });
        } catch (error) {
          const message = error instanceof AppError ? error.message : "That information couldn't be loaded.";
          results.push({ type: "tool_result", tool_use_id: use.id, content: message, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
    return { answer: "That question needed more lookups than I'm allowed. Try asking about one thing at a time.", facts: dedupeFacts(facts), toolsUsed, source: "ai" };
  } catch (error) {
    console.error("[assistant] request failed:", error instanceof Error ? error.name : "unknown");
    return { answer: "The assistant is unavailable right now. Please try again later.", facts: dedupeFacts(facts), toolsUsed, source: "unavailable" };
  }
}

function dedupeFacts(facts: AssistantFact[]): AssistantFact[] {
  const seen = new Set<string>();
  return facts.filter((f) => {
    const key = `${f.label}|${f.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
