/**
 * IN-9 · the AI wording budget (I14): per company per calendar month (UTC), at most
 * AI_MONTHLY_USD dollars or AI_MONTHLY_CALLS calls, counted from insight_ai_call
 * (every attempted model call has a row). Over budget the cards keep their rule
 * text; the route still answers 200 (the IN_AI_BUDGET code is logged, not returned).
 *
 *   monthUsage(companyId)   {calls, cost_usd} so far this month
 *   overBudget(usage)       true at or past either limit (pure)
 */
import { AppDataSource } from "../../config/data-source";

export const AI_MONTHLY_USD = 10;
export const AI_MONTHLY_CALLS = 2000;

export interface Usage {
  calls: number;
  cost_usd: number;
}

export const overBudget = (u: Usage): boolean => u.calls >= AI_MONTHLY_CALLS || u.cost_usd >= AI_MONTHLY_USD;

export async function monthUsage(companyId: number): Promise<Usage> {
  const [r]: Array<{ calls: string; cost: string }> = await AppDataSource.query(
    `SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost FROM insight_ai_call
      WHERE company_id = $1 AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [companyId],
  );
  return { calls: Number(r?.calls ?? 0), cost_usd: Number(r?.cost ?? 0) };
}
