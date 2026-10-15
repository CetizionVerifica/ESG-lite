/**
 * S3-15 part 1: loads what the review checks need for a set of rows and
 * stores the result on `emission.checks`. Batch-friendly: one query per
 * concern for the whole set, whatever its size.
 *
 *   refreshChecks(manager, ids)            after an insert, edit or evidence change
 *   refreshChecks(manager, ids, prior)     after an edit that may have moved the row
 *   checkKeysFor(manager, ids)             the month keys to pass as `prior` (before an edit or delete)
 *
 * Only pending rows are (re)computed; approved and rejected rows keep what
 * they had. Every refresh also recomputes the pending rows of the same and
 * the following month for the same activity, whose WITHIN_THRESHOLD reads
 * the month totals the change moved.
 */
import type { EntityManager } from "typeorm";
import { ColumnConfig } from "../../entities/ColumnConfig";
import { Emission } from "../../entities/Emission";
import { getCalculationSpec } from "../../services/calculationSpec";
import { findDuplicate } from "../../services/emissionWrite/checks";
import type { CalculationSpec } from "../../entities/ColumnConfig";
import { attentionSql, ATTENTION_BELOW } from "../../utils/importAttention";
import { log } from "../../utils/logger";
import { computeChecks, DEFAULT_THRESHOLD_PCT, type CheckRow } from "./checks";
import type { RowChecks } from "../contracts/checks";

/** Statuses that count towards a month's total for WITHIN_THRESHOLD (drafts and rejected rows don't). */
const COUNTED_STATUSES = ["pending", "approved"];

/** One activity in one month: what a monthly row's threshold check reads. */
export interface CheckKey {
  site_id: number;
  category_id: number;
  emission_category: string;
  /** First day of the month, YYYY-MM-01. */
  month: string;
}

interface LoadedRow extends CheckRow {
  pk_id: number;
  site_id: number;
  category_id: number;
  company_id: number | null;
  date: string;
  activity_data: Record<string, any> | null;
  fera_linked_id: number | null;
  has_evidence: boolean;
  needs_attention: boolean;
}

const keyString = (k: Pick<CheckKey, "site_id" | "category_id" | "emission_category" | "month">) => `${k.site_id}:${k.category_id}:${k.month}:${k.emission_category}`;

const previousMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
};

const ids = (list: unknown[]): number[] => [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

/** The month keys of the monthly rows among `rowIds` (rows without an activity have none). */
export const checkKeysFor = async (manager: EntityManager, rowIds: number[]): Promise<CheckKey[]> => {
  const list = ids(rowIds);
  if (!list.length) return [];
  const rows: Array<{ site_id: number; category_id: number; ec: string; month: string }> = await manager.query(
    `SELECT site_id, category_id, activity_data ->> 'emission_category' AS ec, to_char(date_trunc('month', date_of_reporting), 'YYYY-MM-DD') AS month
       FROM emission
      WHERE pk_id = ANY($1) AND reporting_period = 'monthly' AND activity_data ->> 'emission_category' IS NOT NULL`,
    [list],
  );
  return rows.map((r) => ({ site_id: Number(r.site_id), category_id: Number(r.category_id), emission_category: r.ec, month: r.month }));
};

/** Pending monthly rows of each key's month and the month after, same site, category and activity. */
const affectedRows = async (manager: EntityManager, keys: CheckKey[]): Promise<number[]> => {
  if (!keys.length) return [];
  const rows: Array<{ pk_id: number }> = await manager.query(
    `WITH k AS (SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::date[]) AS k(site_id, category_id, ec, m))
     SELECT DISTINCT e.pk_id FROM emission e JOIN k
         ON e.site_id = k.site_id AND e.category_id = k.category_id AND e.activity_data ->> 'emission_category' = k.ec
      WHERE e.status = 'pending' AND e.reporting_period = 'monthly'
        AND e.date_of_reporting >= k.m AND e.date_of_reporting < (k.m + interval '2 months')`,
    [keys.map((k) => k.site_id), keys.map((k) => k.category_id), keys.map((k) => k.emission_category), keys.map((k) => k.month)],
  );
  return rows.map((r) => Number(r.pk_id));
};

const loadRows = async (manager: EntityManager, rowIds: number[]): Promise<LoadedRow[]> => {
  const rows: any[] = await manager.query(
    `SELECT e.pk_id, e.site_id, e.category_id, s.company_id, to_char(e.date_of_reporting, 'YYYY-MM-DD') AS date,
            e.reporting_period, e.activity_data, e.activity_data_unit, e.emission_factor_snapshot, e.fera_linked_id,
            EXISTS (SELECT 1 FROM emission_document d
                     WHERE d.emission_id = e.pk_id OR d.emission_id = e.fera_linked_id
                        OR d.emission_id IN (SELECT p.pk_id FROM emission p WHERE p.fera_linked_id = e.pk_id)) AS has_evidence,
            ${attentionSql("e").replace(/:attentionBelow/g, "$2")} AS needs_attention
       FROM emission e JOIN site s ON s.site_id = e.site_id
      WHERE e.pk_id = ANY($1) AND e.status = 'pending'`,
    [rowIds, ATTENTION_BELOW],
  );
  return rows.map((r) => ({
    ...r,
    pk_id: Number(r.pk_id),
    site_id: Number(r.site_id),
    category_id: Number(r.category_id),
    company_id: r.company_id === null ? null : Number(r.company_id),
    fera_linked_id: r.fera_linked_id === null ? null : Number(r.fera_linked_id),
    date_of_reporting: r.date,
  }));
};

const thresholds = async (manager: EntityManager, companyIds: number[]): Promise<Map<number, number>> => {
  const out = new Map<number, number>();
  if (!companyIds.length) return out;
  const rows: Array<{ company_id: number; threshold_percentage: string }> = await manager.query(
    `SELECT company_id, threshold_percentage FROM emission_threshold WHERE company_id = ANY($1)`,
    [companyIds],
  );
  for (const r of rows) out.set(Number(r.company_id), Number(r.threshold_percentage));
  return out;
};

/** Sum of counted rows per key, for the keys' months. */
const monthTotals = async (manager: EntityManager, keys: CheckKey[]): Promise<Map<string, number>> => {
  const out = new Map<string, number>();
  if (!keys.length) return out;
  const rows: Array<{ site_id: number; category_id: number; ec: string; m: string; total: string | null }> = await manager.query(
    `WITH k AS (SELECT DISTINCT * FROM unnest($1::int[], $2::int[], $3::text[], $4::date[]) AS k(site_id, category_id, ec, m))
     SELECT k.site_id, k.category_id, k.ec, to_char(k.m, 'YYYY-MM-DD') AS m,
            (SELECT SUM(e.total_emission) FROM emission e
              WHERE e.site_id = k.site_id AND e.category_id = k.category_id AND e.activity_data ->> 'emission_category' = k.ec
                AND e.status::text = ANY($5) AND e.reporting_period = 'monthly'
                AND e.date_of_reporting >= k.m AND e.date_of_reporting < (k.m + interval '1 month')) AS total
       FROM k`,
    [keys.map((k) => k.site_id), keys.map((k) => k.category_id), keys.map((k) => k.emission_category), keys.map((k) => k.month), COUNTED_STATUSES],
  );
  for (const r of rows) {
    if (r.total !== null) out.set(keyString({ site_id: Number(r.site_id), category_id: Number(r.category_id), emission_category: r.ec, month: r.m }), Number(r.total));
  }
  return out;
};

/** The id of another counted row this one duplicates (same site, category, date and activity identity), or null. */
const duplicates = async (manager: EntityManager, rows: LoadedRow[]): Promise<Map<number, number | null>> => {
  const out = new Map<number, number | null>();
  if (!rows.length) return out;
  const candidates: any[] = await manager.query(
    `SELECT o.pk_id, o.activity_data, e.pk_id AS of_id
       FROM emission e JOIN emission o
         ON o.site_id = e.site_id AND o.category_id = e.category_id AND o.date_of_reporting = e.date_of_reporting
        AND o.reporting_period = e.reporting_period AND o.pk_id <> e.pk_id
        AND o.pk_id <> COALESCE(e.fera_linked_id, 0) AND COALESCE(o.fera_linked_id, 0) <> e.pk_id
      WHERE e.pk_id = ANY($1) AND o.status::text = ANY($2)
      ORDER BY o.pk_id`,
    [rows.map((r) => r.pk_id), COUNTED_STATUSES],
  );
  const byRow = new Map<number, Emission[]>();
  for (const c of candidates) {
    const list = byRow.get(Number(c.of_id)) ?? [];
    list.push({ pk_id: Number(c.pk_id), activity_data: c.activity_data } as Emission);
    byRow.set(Number(c.of_id), list);
  }
  const specs = new Map<string, Promise<CalculationSpec | null>>();
  const configRepo = manager.getRepository(ColumnConfig);
  for (const row of rows) {
    const existing = byRow.get(row.pk_id);
    if (!existing?.length) {
      out.set(row.pk_id, null);
      continue;
    }
    const specKey = `${row.site_id}:${row.category_id}`;
    if (!specs.has(specKey)) specs.set(specKey, getCalculationSpec(configRepo, row.site_id, row.category_id));
    const dup = findDuplicate(existing, row.activity_data ?? {}, await specs.get(specKey)!);
    out.set(row.pk_id, dup ? dup.pk_id : null);
  }
  return out;
};

/** Computes the checks of the pending rows among `rowIds` without storing them. */
export const computeChecksFor = async (manager: EntityManager, rowIds: number[]): Promise<Map<number, RowChecks>> => {
  const out = new Map<number, RowChecks>();
  const rows = await loadRows(manager, ids(rowIds));
  if (!rows.length) return out;

  const keys: CheckKey[] = [];
  for (const r of rows) {
    const ec = r.activity_data?.emission_category;
    if (r.reporting_period !== "monthly" || typeof ec !== "string") continue;
    const month = `${r.date.slice(0, 7)}-01`;
    keys.push({ site_id: r.site_id, category_id: r.category_id, emission_category: ec, month });
    keys.push({ site_id: r.site_id, category_id: r.category_id, emission_category: ec, month: previousMonth(month) });
  }
  const companyIds = ids(rows.map((r) => r.company_id));
  const [totals, limits, dups] = await Promise.all([monthTotals(manager, keys), thresholds(manager, companyIds), duplicates(manager, rows)]);

  for (const r of rows) {
    const ec = r.activity_data?.emission_category;
    const month = `${r.date.slice(0, 7)}-01`;
    const key = typeof ec === "string" ? { site_id: r.site_id, category_id: r.category_id, emission_category: ec } : null;
    out.set(
      r.pk_id,
      computeChecks(r, {
        hasEvidence: Boolean(r.has_evidence),
        duplicateOf: dups.get(r.pk_id) ?? null,
        thresholdPct: (r.company_id !== null ? limits.get(r.company_id) : undefined) ?? DEFAULT_THRESHOLD_PCT,
        monthTotal: key ? totals.get(keyString({ ...key, month })) ?? null : null,
        previousMonthTotal: key ? totals.get(keyString({ ...key, month: previousMonth(month) })) ?? null : null,
        importNeedsAttention: Boolean(r.needs_attention),
      }),
    );
  }
  return out;
};

/**
 * Recomputes and stores the checks of `rowIds` (pending ones), plus the
 * pending rows of the same and the following month for their activities and
 * for `prior` keys (where an edited or deleted row used to be): both compare
 * month totals the change moved. Returns the stored checks.
 */
export const refreshChecks = async (manager: EntityManager, rowIds: number[], prior: CheckKey[] = []): Promise<Map<number, RowChecks>> => {
  const own = ids(rowIds);
  const keys = [...prior, ...(await checkKeysFor(manager, own))];
  const target = ids([...own, ...(await affectedRows(manager, keys))]);
  if (!target.length) return new Map();
  const computed = await computeChecksFor(manager, target);
  if (computed.size) {
    const entries = [...computed.entries()];
    await manager.query(
      `UPDATE emission e SET checks = v.checks
         FROM (SELECT unnest($1::int[]) AS pk_id, unnest($2::jsonb[]) AS checks) v
        WHERE e.pk_id = v.pk_id`,
      [entries.map(([id]) => id), entries.map(([, c]) => JSON.stringify(c))],
    );
  }
  return computed;
};

/**
 * refreshChecks for write paths: the write already happened, so a failure
 * here is logged (ids only) and never fails the write or the request. The row
 * then keeps its previous checks, or none, and shows under "Needs attention".
 */
export const refreshChecksSafely = async (manager: EntityManager, rowIds: number[], prior: CheckKey[] = []): Promise<void> => {
  // Inside a transaction a failed statement aborts it, so the refresh runs in
  // a savepoint and a failure rolls back only the refresh, never the write.
  const inTx = Boolean(manager.queryRunner?.isTransactionActive);
  try {
    if (inTx) await manager.query("SAVEPOINT s3_review_checks");
    await refreshChecks(manager, rowIds, prior);
    if (inTx) await manager.query("RELEASE SAVEPOINT s3_review_checks");
  } catch (error) {
    if (inTx) await manager.query("ROLLBACK TO SAVEPOINT s3_review_checks").catch(() => undefined);
    log.error("Scope3Review", "Check refresh failed", { ids: ids(rowIds).slice(0, 50), error: (error as Error).message });
  }
};
