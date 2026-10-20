/**
 * DS-9 · the AI budget and call log (D10, RS-8 `budget.ts`).
 *
 *   usageFor(companyId, docId)   today's spend and calls for the doc, this month's spend for
 *                                the company (UTC days and months), from report_ai_call
 *   budgetVerdict(usage)         pure: which limit a next call would break, or null
 *   assertBudget(...)            throws DS_AI_BUDGET_EXCEEDED {limit} before a call
 *   logCall(...)                 one report_ai_call row per model call, ok or not
 *
 * Limits: $5 or 200 calls per doc per day, $50 per company per month (AI_BUDGET).
 * Chat turns count as calls (each model call is a row). A call is refused when
 * the spend has reached the limit or the calls have reached the count, so the
 * 200th call runs and the 201st is refused.
 */
import { AppDataSource } from "../../config/data-source";
import { AI_BUDGET, DsError, type AiUsage } from "../contracts";

export interface Usage {
  todayUsd: number;
  calls: number;
  monthUsd: number;
}

export type BudgetLimit = "doc_day_usd" | "doc_day_calls" | "company_month_usd";

export function budgetVerdict(u: Usage, limits: typeof AI_BUDGET = AI_BUDGET, opts: { hasDoc: boolean } = { hasDoc: true }): BudgetLimit | null {
  if (u.monthUsd >= limits.perCompanyPerMonthUsd) return "company_month_usd";
  if (!opts.hasDoc) return null;
  if (u.todayUsd >= limits.perDocPerDayUsd) return "doc_day_usd";
  if (u.calls >= limits.perDocPerDayCalls) return "doc_day_calls";
  return null;
}

const round = (n: number) => Math.round(n * 100_000) / 100_000;

export async function usageFor(companyId: number, docId: number | null): Promise<Usage> {
  const [m]: Array<{ usd: string | null }> = await AppDataSource.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM report_ai_call WHERE company_id = $1 AND created_at >= date_trunc('month', timezone('UTC', now()))`,
    [companyId],
  );
  let today = { usd: 0, calls: 0 };
  if (docId !== null) {
    const [d]: Array<{ usd: string | null; calls: string }> = await AppDataSource.query(
      `SELECT COALESCE(SUM(cost_usd), 0) AS usd, COUNT(*) AS calls FROM report_ai_call WHERE company_id = $1 AND doc_id = $2 AND created_at >= date_trunc('day', timezone('UTC', now()))`,
      [companyId, docId],
    );
    today = { usd: Number(d?.usd ?? 0), calls: Number(d?.calls ?? 0) };
  }
  return { todayUsd: round(today.usd), calls: today.calls, monthUsd: round(Number(m?.usd ?? 0)) };
}

export async function assertBudget(companyId: number, docId: number | null): Promise<void> {
  const limit = budgetVerdict(await usageFor(companyId, docId), AI_BUDGET, { hasDoc: docId !== null });
  if (limit) throw new DsError("DS_AI_BUDGET_EXCEEDED", { limit });
}

export async function usageResponse(companyId: number, docId: number): Promise<AiUsage> {
  const u = await usageFor(companyId, docId);
  return {
    todayUsd: u.todayUsd,
    budgetUsd: AI_BUDGET.perDocPerDayUsd,
    calls: u.calls,
    callBudget: AI_BUDGET.perDocPerDayCalls,
    monthUsd: u.monthUsd,
    monthBudgetUsd: AI_BUDGET.perCompanyPerMonthUsd,
  };
}

export interface CallLog {
  companyId: number;
  docId: number | null;
  userId: number | null;
  action: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  ok: boolean;
  errorCode: string | null;
}

export async function logCall(c: CallLog): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO report_ai_call (company_id, doc_id, action, model, tokens_in, tokens_out, cost_usd, ok, error_code, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [c.companyId, c.docId, c.action.slice(0, 40), c.model.slice(0, 120), c.tokensIn, c.tokensOut, c.costUsd, c.ok, c.errorCode, c.userId || null],
  );
}
