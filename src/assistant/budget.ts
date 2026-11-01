/**
 * AS-1 · how much the help assistant may spend (A5), counted from assistant_call
 * (every attempted model call has a row). UTC day and month.
 *
 *   USER_DAY_CALLS       a person's model calls per day
 *   COMPANY_MONTH_USD    a client's spend per month (a Superadmin has no client:
 *                        only the per-person limit applies)
 *   budgetVerdict(u)     the limit reached, or null (pure)
 *   usageFor(userId, companyId)
 *   logCall(row)         the row's id
 *   saveFeedback(callId, userId, helpful)  a thumb on the person's own call
 */
import { AppDataSource } from "../config/data-source";

export const USER_DAY_CALLS = 40;
export const COMPANY_MONTH_USD = 15;

export interface AssistantUsage {
  userDayCalls: number;
  companyMonthUsd: number;
}

export type BudgetLimit = "user_day_calls" | "company_month_usd";

export const budgetVerdict = (u: AssistantUsage): BudgetLimit | null => {
  if (u.userDayCalls >= USER_DAY_CALLS) return "user_day_calls";
  if (u.companyMonthUsd >= COMPANY_MONTH_USD) return "company_month_usd";
  return null;
};

export async function usageFor(userId: number, companyId: number | null): Promise<AssistantUsage> {
  const [day]: Array<{ calls: number | string }> = await AppDataSource.query(
    `SELECT COUNT(*) AS calls FROM assistant_call
      WHERE user_id = $1 AND purpose IS NULL AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [userId],
  );
  let companyMonthUsd = 0;
  if (companyId !== null) {
    const [month]: Array<{ cost: string }> = await AppDataSource.query(
      `SELECT COALESCE(SUM(cost_usd), 0) AS cost FROM assistant_call
        WHERE company_id = $1 AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [companyId],
    );
    companyMonthUsd = Number(month?.cost ?? 0);
  }
  return { userDayCalls: Number(day?.calls ?? 0), companyMonthUsd };
}

export interface CallRow {
  companyId: number | null;
  userId: number;
  role: string;
  pagePath: string | null;
  articleIds: string[];
  sources: string[];
  answered: boolean | null;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  ok: boolean;
  errorCode: string | null;
  promptVersion: number;
  /** The kind of file attached, never its name or contents. */
  fileType?: string | null;
  /** "translate" for the search-words call: it costs money but isn't one of the person's questions. */
  purpose?: string | null;
}

const list = (ids: string[]): string | null => (ids.length ? ids.join(",").slice(0, 300) : null);

export async function logCall(r: CallRow): Promise<number> {
  const rows: Array<{ id: number }> = await AppDataSource.query(
    `INSERT INTO assistant_call (company_id, user_id, role, page_path, article_ids, sources, answered, model, tokens_in, tokens_out, cost_usd, ok, error_code, prompt_version, file_type, purpose)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id`,
    [
      r.companyId,
      r.userId,
      r.role.slice(0, 20),
      r.pagePath ? r.pagePath.slice(0, 200) : null,
      list(r.articleIds),
      list(r.sources),
      r.answered,
      r.model.slice(0, 80),
      r.tokensIn,
      r.tokensOut,
      r.costUsd,
      r.ok,
      r.errorCode ? r.errorCode.slice(0, 40) : null,
      r.promptVersion,
      r.fileType ?? null,
      r.purpose ?? null,
    ],
  );
  return Number(rows[0]?.id);
}

/** False when the call isn't this person's. */
export async function saveFeedback(callId: number, userId: number, helpful: boolean): Promise<boolean> {
  const [, changed]: [unknown, number] = await AppDataSource.query(`UPDATE assistant_call SET helpful = $1 WHERE id = $2::bigint AND user_id = $3`, [helpful, callId, userId]);
  return changed > 0;
}
