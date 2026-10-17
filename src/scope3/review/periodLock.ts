/**
 * S3-15 part 2 · the month lock guard (docs/scope3/01-contracts.md §4, D11).
 *
 * A site-month is closed when its company has `review_workflow_v2` on and an
 * active `period_lock` row covers it (same site or every site, same month or
 * the whole year, not reopened). With the switch off nothing is ever closed,
 * so every write behaves as today.
 *
 * A row belongs to the month of its `date_of_reporting`; a yearly row's date
 * is its period end, so it belongs to its period-end month, as My month
 * counts it.
 *
 * Every write path asks here before it writes (create, edit, delete, approve,
 * reject, bulk, batch, import plan and commit, MCP commit, submit,
 * "Nothing this month"): see `guard.ts` for the HTTP routes and
 * `emissionWrite` for the import paths.
 */
import type { EntityManager } from "typeorm";
import { Scope3Error } from "../contracts/errors";

/** One site in one month. */
export interface SiteMonth {
  site_id: number;
  year: number;
  /** 1–12 */
  month: number;
}

const ints = (list: unknown[]): number[] => [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

/** The year and month of a stored or requested date: "YYYY-MM…" strings are read as written, a Date in UTC. */
export const yearMonthOf = (date: string | Date): { year: number; month: number } | null => {
  if (typeof date === "string") {
    const m = /^(\d{4})-(\d{2})/.exec(date);
    if (m) return { year: Number(m[1]), month: Number(m[2]) };
  }
  const d = new Date(date as any);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
};

/** `site_id` and the month of `date`, or null for a date that can't be read. */
export const siteMonthOf = (site_id: number, date: string | Date): SiteMonth | null => {
  const ym = yearMonthOf(date);
  return ym && Number.isInteger(Number(site_id)) ? { site_id: Number(site_id), ...ym } : null;
};

const key = (s: SiteMonth) => `${s.site_id}:${s.year}:${s.month}`;

/** The closed site-months among `items` (each once). */
export const lockedSiteMonths = async (manager: EntityManager, items: Array<SiteMonth | null>): Promise<SiteMonth[]> => {
  const seen = new Map<string, SiteMonth>();
  for (const it of items) if (it) seen.set(key(it), it);
  if (!seen.size) return [];
  const list = [...seen.values()];
  const rows: Array<{ site_id: number; year: number; month: number }> = await manager.query(
    `WITH k AS (SELECT DISTINCT * FROM unnest($1::int[], $2::int[], $3::int[]) AS k(site_id, y, m))
     SELECT k.site_id, k.y AS year, k.m AS month
       FROM k
       JOIN site s ON s.site_id = k.site_id
       JOIN company c ON c.company_id = s.company_id
      WHERE c.review_workflow_v2 = true
        AND EXISTS (SELECT 1 FROM period_lock l
                     WHERE l.company_id = c.company_id
                       AND (l.site_id = k.site_id OR l.site_id IS NULL)
                       AND l.year = k.y AND (l.month = k.m OR l.month IS NULL)
                       AND l.reopened_at IS NULL)
      ORDER BY k.site_id, k.y, k.m`,
    [list.map((s) => s.site_id), list.map((s) => s.year), list.map((s) => s.month)],
  );
  return rows.map((r) => ({ site_id: Number(r.site_id), year: Number(r.year), month: Number(r.month) }));
};

/** The site-months of rows `ids` and of their FERA families (a twin shares its parent's site and date). */
export const siteMonthsOfRows = async (manager: EntityManager, ids: unknown[]): Promise<SiteMonth[]> => {
  const list = ints(ids);
  if (!list.length) return [];
  const rows: Array<{ site_id: number; year: number; month: number }> = await manager.query(
    `SELECT DISTINCT e.site_id, EXTRACT(YEAR FROM e.date_of_reporting)::int AS year, EXTRACT(MONTH FROM e.date_of_reporting)::int AS month
       FROM emission e
      WHERE e.pk_id = ANY($1::int[])
         OR e.fera_linked_id = ANY($1::int[])
         OR e.pk_id IN (SELECT f.fera_linked_id FROM emission f WHERE f.pk_id = ANY($1::int[]) AND f.fera_linked_id IS NOT NULL)`,
    [list],
  );
  return rows.map((r) => ({ site_id: Number(r.site_id), year: Number(r.year), month: Number(r.month) }));
};

/** The site-months of an upload batch's rows. */
export const siteMonthsOfBatch = async (manager: EntityManager, batchId: string): Promise<SiteMonth[]> => {
  const rows: Array<{ site_id: number; year: number; month: number }> = await manager.query(
    `SELECT DISTINCT site_id, EXTRACT(YEAR FROM date_of_reporting)::int AS year, EXTRACT(MONTH FROM date_of_reporting)::int AS month
       FROM emission WHERE upload_batch_id = $1`,
    [batchId],
  );
  return rows.map((r) => ({ site_id: Number(r.site_id), year: Number(r.year), month: Number(r.month) }));
};

/** The ids among `ids` whose site-month is closed (a row alone, without its family). */
export const lockedRowIds = async (manager: EntityManager, ids: unknown[]): Promise<Set<number>> => {
  const list = ints(ids);
  if (!list.length) return new Set();
  const rows: Array<{ pk_id: number }> = await manager.query(
    `SELECT e.pk_id
       FROM emission e
       JOIN site s ON s.site_id = e.site_id
       JOIN company c ON c.company_id = s.company_id
      WHERE e.pk_id = ANY($1::int[]) AND c.review_workflow_v2 = true
        AND EXISTS (SELECT 1 FROM period_lock l
                     WHERE l.company_id = c.company_id
                       AND (l.site_id = e.site_id OR l.site_id IS NULL)
                       AND l.year = EXTRACT(YEAR FROM e.date_of_reporting)::int
                       AND (l.month = EXTRACT(MONTH FROM e.date_of_reporting)::int OR l.month IS NULL)
                       AND l.reopened_at IS NULL)`,
    [list],
  );
  return new Set(rows.map((r) => Number(r.pk_id)));
};

/** The PERIOD_LOCKED error for closed site-months (`details.periods`). */
export const periodLockedError = (periods: SiteMonth[]) => new Scope3Error("PERIOD_LOCKED", { periods });

/** Throws PERIOD_LOCKED when any of `items` is closed. */
export const assertPeriodsOpen = async (manager: EntityManager, items: Array<SiteMonth | null>): Promise<void> => {
  const locked = await lockedSiteMonths(manager, items);
  if (locked.length) throw periodLockedError(locked);
};
