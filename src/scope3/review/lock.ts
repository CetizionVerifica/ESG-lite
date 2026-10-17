/**
 * S3-15 part 2 · close a month (docs/scope3/review/CLAUDE.md item 7, D11).
 *
 *   periodStatus  → GET /periods/lock: per site, the categories owed
 *                   (contributorSiteCategories) with counts by status,
 *                   "Nothing this month" markers, the Scope 3 grid and what
 *                   is left before the month can be locked
 *   lockPeriod    → POST /periods/lock: refused (PERIOD_INCOMPLETE) while
 *                   anything is left; one period_lock row per site
 *   unlockPeriod  → POST /periods/unlock: a reason of 5+ characters
 *
 * Who: a Manager for their own sites, an Admin for every site of their
 * company, a Superadmin for any company (naming it). Another company's site
 * or company is 404; a Manager on a site of their company that isn't theirs,
 * or locking every site, is 403; a User is 403.
 *
 * Lock and reopen write audit_log rows (entity_type scope3_period_lock).
 * Logging: ids and codes only.
 */
import { In, type EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { Site } from "../../entities/Site";
import type { User } from "../../entities/User";
import { UserRole } from "../../types/type";
import { accessibleSiteIds, resolveUserCompanyId } from "../../utils/companyScope";
import { contributorSiteCategories, monthBounds } from "../../services/contributorObligations";
import { GHG_CATEGORIES } from "../contracts/ghgCategory";
import { Scope3Error } from "../contracts/errors";
import { UNLOCK_REASON_MIN, type PeriodCategoryState, type PeriodLeftReason } from "../contracts/schemas";
import { log } from "../../utils/logger";
import { PERIOD_LOCK_CLASS } from "./periodLease";

/**
 * A refusal the §7 codes don't cover (validation, company, role, not found),
 * in the `{code, message, details?}` shape with the same codes S3-1 answers
 * (SCOPE3_VALIDATION, SCOPE3_COMPANY_REQUIRED, SCOPE3_FORBIDDEN, SCOPE3_NOT_FOUND).
 */
const ACCESS_CODES = { 400: "SCOPE3_VALIDATION", 403: "SCOPE3_FORBIDDEN", 404: "SCOPE3_NOT_FOUND" } as const;
export class AccessError extends Error {
  readonly code: string;
  constructor(readonly status: 400 | 403 | 404, message: string, code?: string, readonly details?: unknown) {
    super(message);
    this.name = "AccessError";
    this.code = code ?? ACCESS_CODES[status];
  }

  toBody() {
    return this.details === undefined ? { code: this.code, message: this.message } : { code: this.code, message: this.message, details: this.details };
  }
}

export interface Caller {
  userId: number;
  role: string;
}

/** The roles that may close a month. */
const LOCKERS = new Set<string>([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN]);
const COMPANY_WIDE = new Set<string>([UserRole.ADMIN, UserRole.SUPERADMIN]);

export interface LockScope {
  companyId: number;
  /** The sites the request covers, ascending. */
  siteIds: number[];
}

/**
 * Resolves the company and sites a lock request covers, or throws an
 * AccessError. `write` is lock or unlock: a Manager must name one of their
 * own sites (company-wide is Admin and Superadmin, D11).
 */
export async function resolveLockScope(caller: Caller, req: { site_id?: number | null; company_id?: number }, write: boolean): Promise<LockScope> {
  if (!LOCKERS.has(caller.role)) throw new AccessError(403, "Only a Manager, Admin or Superadmin can close a month.");
  const siteId = req.site_id ?? null;
  const site = siteId
    ? ((await AppDataSource.query(`SELECT site_id, company_id FROM site WHERE site_id = $1`, [siteId])) as Array<{ site_id: number; company_id: number | null }>)[0]
    : undefined;
  if (siteId && !site) throw new AccessError(404, "Not found.");

  let companyId: number | null;
  if (caller.role === UserRole.SUPERADMIN) {
    companyId = site ? Number(site.company_id) : req.company_id ?? null;
    if (!companyId) throw new AccessError(400, "company_id is required for a Superadmin.", "SCOPE3_COMPANY_REQUIRED");
    if (req.company_id && site && Number(site.company_id) !== req.company_id) throw new AccessError(404, "Not found.");
    const exists = await AppDataSource.query(`SELECT 1 FROM company WHERE company_id = $1`, [companyId]);
    if (!exists.length) throw new AccessError(404, "Not found.");
  } else {
    companyId = await resolveUserCompanyId(caller.userId);
    if (!companyId) throw new AccessError(404, "Not found.");
    if (req.company_id && req.company_id !== companyId) throw new AccessError(404, "Not found.");
    if (site && Number(site.company_id) !== companyId) throw new AccessError(404, "Not found.");
  }

  const companySites: number[] = (
    (await AppDataSource.query(`SELECT site_id FROM site WHERE company_id = $1 ORDER BY site_id`, [companyId])) as Array<{ site_id: number }>
  ).map((r) => Number(r.site_id));

  if (COMPANY_WIDE.has(caller.role)) return { companyId, siteIds: siteId ? [siteId] : companySites };

  // Manager: their own sites only.
  const own = (await accessibleSiteIds(caller.userId, caller.role)) ?? new Set<number>();
  if (siteId) {
    if (!own.has(siteId)) throw new AccessError(403, "You can only close months for your own sites.");
    return { companyId, siteIds: [siteId] };
  }
  if (write) throw new AccessError(403, "Only an Admin can close a month for every site; name one of your sites.");
  return { companyId, siteIds: companySites.filter((id) => own.has(id)) };
}

// ---------------------------------------------------------------------------
// Completeness (pure)
// ---------------------------------------------------------------------------

export interface MonthRow {
  status: string;
  reporting_period: string;
  /** YYYY-MM-DD */
  date: string;
}

export interface StatusCounts {
  draft: number;
  pending: number;
  approved: number;
  rejected: number;
}

/**
 * A site's category in a month, as My month reads it: monthly rows dated in
 * the month; else a yearly batch whose period ends in the month; else an
 * open (not fully approved) yearly batch covering it. A fully approved yearly
 * batch ending in another month "covers" the month. A Sent back row always
 * wins (it needs action), then Draft, then Pending. "Nothing this month"
 * counts only when nothing was filed.
 */
export const categoryState = (rows: MonthRow[], monthStart: string, monthEnd: string, nothing: boolean): { state: PeriodCategoryState; counts: StatusCounts } => {
  const monthly = rows.filter((r) => r.reporting_period !== "yearly");
  const yearly = rows.filter((r) => r.reporting_period === "yearly");
  const yearlyDueNow = yearly.filter((r) => r.date >= monthStart && r.date <= monthEnd);
  const yearlyOpen = yearly.some((r) => r.status !== "approved");
  const entries = monthly.length ? monthly : yearlyDueNow.length ? yearlyDueNow : yearlyOpen ? yearly : [];
  const counts: StatusCounts = { draft: 0, pending: 0, approved: 0, rejected: 0 };
  for (const r of entries) if (r.status in counts) counts[r.status as keyof StatusCounts] += 1;
  let state: PeriodCategoryState;
  if (counts.rejected) state = "rejected";
  else if (counts.draft) state = "draft";
  else if (counts.pending) state = "pending";
  else if (counts.approved) state = "approved";
  else if (!monthly.length && yearly.length) state = "covered";
  else if (nothing) state = "nothing";
  else state = "missing";
  return { state, counts };
};

const LEFT_STATES = new Set<PeriodCategoryState>(["missing", "draft", "pending", "rejected"]);
export const leftReasonOf = (state: PeriodCategoryState): PeriodLeftReason | null => (LEFT_STATES.has(state) ? (state as PeriodLeftReason) : null);

// ---------------------------------------------------------------------------
// GET /periods/lock
// ---------------------------------------------------------------------------

export interface PeriodCategory {
  category_id: number;
  category_name: string;
  scope: string | null;
  ghg_category: number | null;
  state: PeriodCategoryState;
  counts: StatusCounts;
  nothing: boolean;
}

export interface PeriodSite {
  site_id: number;
  name: string;
  locked: boolean;
  /** The active lock: this site's own, or the company-wide one (`site_id` null) it sits under. */
  lock: { site_id: number | null; locked_at: string; locked_by: number; locked_by_name: string | null } | null;
  reopened: { reopened_at: string; reopened_by: number | null; reopened_by_name: string | null; reason: string | null } | null;
  categories: PeriodCategory[];
  /** The 15 GHG Protocol categories: boundary status (S3-1) × whether this site has data for the month. */
  scope3: Array<{ n: number; status: string; data: boolean }>;
  left: number;
}

export interface PeriodLeftItem {
  site_id: number;
  site_name: string;
  category_id: number;
  category_name: string;
  reason: PeriodLeftReason;
}

export interface PeriodStatus {
  company_id: number;
  year: number;
  month: number;
  /** YYYY-MM */
  period: string;
  review_workflow_v2: boolean;
  sites: PeriodSite[];
  left: PeriodLeftItem[];
  /** True when the switch is on and nothing is left. */
  can_lock: boolean;
  /** True when every site in `sites` is locked. */
  locked: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: unknown): string | null => (d ? new Date(d as any).toISOString() : null);

/** Rows `e` of a month: monthly rows dated in it, or yearly batches covering it (`start`/`end`: the month's first and last day parameters). */
const inMonthSql = (start: string, end: string) => `((e.reporting_period <> 'yearly' AND e.date_of_reporting BETWEEN ${start}::date AND ${end}::date)
   OR (e.reporting_period = 'yearly' AND (
        (e.year_type = 'CY' AND EXTRACT(YEAR FROM e.date_of_reporting) = EXTRACT(YEAR FROM ${start}::date))
     OR (e.year_type = 'FY' AND ${start}::date > e.date_of_reporting - INTERVAL '1 year' AND ${start}::date <= e.date_of_reporting))))`;

export async function periodStatus(manager: EntityManager, scope: LockScope, year: number, month: number): Promise<PeriodStatus> {
  const { monthStart, monthEnd } = monthBounds(year, month);
  const [company]: Array<{ review_workflow_v2: boolean }> = await manager.query(`SELECT review_workflow_v2 FROM company WHERE company_id = $1`, [scope.companyId]);
  const switchOn = company?.review_workflow_v2 === true;

  const sites = scope.siteIds.length
    ? await manager.getRepository(Site).find({ where: { site_id: In(scope.siteIds) }, relations: ["categories"], order: { site_id: "ASC" } })
    : [];
  // The categories a site's contributors owe: its categories without FERA (no grants narrow a site).
  const owed = new Map(sites.map((s) => [s.site_id, contributorSiteCategories({ site: s, sites: [], categories: [] } as unknown as User)[0]?.categories ?? []]));
  const categoryIds = [...new Set([...owed.values()].flat().map((c) => c.category_id))];

  const [rows, nothing, locks, grid, boundary] = await Promise.all([
    sites.length && categoryIds.length
      ? (manager.query(
          `SELECT e.site_id, e.category_id, e.status::text AS status, e.reporting_period, to_char(e.date_of_reporting, 'YYYY-MM-DD') AS date
             FROM emission e
            WHERE e.site_id = ANY($1::int[]) AND e.category_id = ANY($2::int[]) AND ${inMonthSql("$3", "$4")}`,
          [scope.siteIds, categoryIds, monthStart, monthEnd],
        ) as Promise<Array<MonthRow & { site_id: number; category_id: number }>>)
      : Promise.resolve([]),
    manager.query(`SELECT site_id, category_id FROM nothing_this_month WHERE site_id = ANY($1::int[]) AND period = $2::date`, [scope.siteIds, monthStart]) as Promise<
      Array<{ site_id: number; category_id: number }>
    >,
    manager.query(
      `SELECT l.id, l.site_id, l.locked_by, l.locked_at, l.reopened_by, l.reopened_at, l.reopened_reason,
              lb.name AS locked_by_name, rb.name AS reopened_by_name
         FROM period_lock l
         LEFT JOIN "user" lb ON lb.user_id = l.locked_by
         LEFT JOIN "user" rb ON rb.user_id = l.reopened_by
        WHERE l.company_id = $1 AND l.year = $2 AND (l.month = $3 OR l.month IS NULL)
          AND (l.site_id = ANY($4::int[]) OR l.site_id IS NULL)
        ORDER BY l.id`,
      [scope.companyId, year, month, scope.siteIds],
    ) as Promise<any[]>,
    manager.query(
      `SELECT e.site_id, c.ghg_category, COUNT(*)::int AS n
         FROM emission e JOIN category c ON c.category_id = e.category_id
        WHERE e.site_id = ANY($1::int[]) AND c.ghg_category IS NOT NULL AND e.status::text IN ('pending', 'approved')
          AND ${inMonthSql("$2", "$3")}
        GROUP BY e.site_id, c.ghg_category`,
      [scope.siteIds, monthStart, monthEnd],
    ) as Promise<Array<{ site_id: number; ghg_category: number; n: number }>>,
    manager.query(`SELECT ghg_category, status FROM company_scope3_category WHERE company_id = $1`, [scope.companyId]) as Promise<
      Array<{ ghg_category: number; status: string }>
    >,
  ]);

  const nothingSet = new Set(nothing.map((r) => `${r.site_id}:${r.category_id}`));
  const dataSet = new Set(grid.map((r) => `${r.site_id}:${r.ghg_category}`));
  const boundaryOf = new Map(boundary.map((b) => [Number(b.ghg_category), b.status]));
  const left: PeriodLeftItem[] = [];

  const out: PeriodSite[] = sites.map((site) => {
    const siteLocks = locks.filter((l) => l.site_id === null || Number(l.site_id) === site.site_id);
    const active = siteLocks.filter((l) => l.reopened_at === null).pop();
    const lastReopen = siteLocks.filter((l) => l.reopened_at !== null).pop();
    const categories: PeriodCategory[] = (owed.get(site.site_id) ?? []).map((c) => {
      const mine = rows.filter((r) => Number(r.site_id) === site.site_id && Number(r.category_id) === c.category_id);
      const marked = nothingSet.has(`${site.site_id}:${c.category_id}`);
      const { state, counts } = categoryState(mine, monthStart, monthEnd, marked);
      const reason = leftReasonOf(state);
      if (reason) left.push({ site_id: site.site_id, site_name: site.name, category_id: c.category_id, category_name: c.category_name, reason });
      return {
        category_id: c.category_id,
        category_name: c.category_name,
        scope: c.scope ?? null,
        ghg_category: (c as any).ghg_category ?? null,
        state,
        counts,
        nothing: marked,
      };
    });
    return {
      site_id: site.site_id,
      name: site.name,
      locked: switchOn && !!active,
      lock: active
        ? { site_id: active.site_id === null ? null : Number(active.site_id), locked_at: iso(active.locked_at)!, locked_by: Number(active.locked_by), locked_by_name: active.locked_by_name ?? null }
        : null,
      reopened:
        !active && lastReopen
          ? { reopened_at: iso(lastReopen.reopened_at)!, reopened_by: lastReopen.reopened_by === null ? null : Number(lastReopen.reopened_by), reopened_by_name: lastReopen.reopened_by_name ?? null, reason: lastReopen.reopened_reason ?? null }
          : null,
      categories,
      scope3: GHG_CATEGORIES.map((g) => ({ n: g.n, status: boundaryOf.get(g.n) ?? "screening", data: dataSet.has(`${site.site_id}:${g.n}`) })),
      left: categories.filter((c) => leftReasonOf(c.state)).length,
    };
  });

  return {
    company_id: scope.companyId,
    year,
    month,
    period: `${year}-${pad(month)}`,
    review_workflow_v2: switchOn,
    sites: out,
    left,
    can_lock: switchOn && left.length === 0 && out.length > 0,
    locked: out.length > 0 && out.every((s) => s.locked),
  };
}

// ---------------------------------------------------------------------------
// POST /periods/lock and /periods/unlock
// ---------------------------------------------------------------------------

/** pg_advisory_xact_lock class for period locks, so two lock calls for one company queue; writes hold it shared (periodLease.ts). */
const LOCK_CLASS = PERIOD_LOCK_CLASS;

const auditLock = async (tx: EntityManager, id: number, action: "lock" | "unlock", siteId: number | null, period: string, userId: number, reason: string | null) =>
  tx.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('scope3_period_lock', $1, $2, $3, $4, $5)`, [
    id,
    action,
    JSON.stringify({ locked: { old: action === "unlock", new: action === "lock" }, site_id: { old: siteId, new: siteId }, period: { old: period, new: period } }),
    reason,
    userId,
  ]);

/** Locks the month for the scope's sites (each once). Refused with PERIOD_INCOMPLETE while anything is left. */
export async function lockPeriod(caller: Caller, scope: LockScope, year: number, month: number): Promise<PeriodStatus> {
  const before = await periodStatus(AppDataSource.manager, scope, year, month);
  if (!before.review_workflow_v2) throw new Scope3Error("REVIEW_WORKFLOW_OFF");
  if (before.left.length) throw new Scope3Error("PERIOD_INCOMPLETE", { left: before.left });
  const period = before.period;
  const lockedNow: number[] = [];
  await AppDataSource.transaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock($1, $2)`, [LOCK_CLASS, scope.companyId]);
    // Checked again under the lock: a row written since the read above keeps the month open.
    const again = await periodStatus(tx, scope, year, month);
    if (again.left.length) throw new Scope3Error("PERIOD_INCOMPLETE", { left: again.left });
    for (const siteId of scope.siteIds) {
      const [existing]: Array<{ id: number; reopened_at: Date | null }> = await tx.query(
        `SELECT id, reopened_at FROM period_lock WHERE company_id = $1 AND site_id = $2 AND year = $3 AND month = $4 ORDER BY id LIMIT 1 FOR UPDATE`,
        [scope.companyId, siteId, year, month],
      );
      if (existing && existing.reopened_at === null) continue;
      let id: number;
      if (existing) {
        await tx.query(
          `UPDATE period_lock SET locked_by = $2, locked_at = now(), reopened_by = NULL, reopened_at = NULL, reopened_reason = NULL WHERE id = $1`,
          [existing.id, caller.userId],
        );
        id = Number(existing.id);
      } else {
        const [row]: Array<{ id: number }> = await tx.query(
          `INSERT INTO period_lock (company_id, site_id, year, month, locked_by, locked_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
          [scope.companyId, siteId, year, month, caller.userId],
        );
        id = Number(row.id);
      }
      await auditLock(tx, id, "lock", siteId, period, caller.userId, null);
      lockedNow.push(siteId);
    }
  });
  log.info("Scope3Review", "Month locked", { companyId: scope.companyId, siteIds: lockedNow, period, userId: caller.userId });
  return periodStatus(AppDataSource.manager, scope, year, month);
}

/** Reopens the month for the scope's sites. A reason of UNLOCK_REASON_MIN+ characters is required. */
export async function unlockPeriod(caller: Caller, scope: LockScope, year: number, month: number, reason: unknown, companyWide: boolean): Promise<PeriodStatus> {
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < UNLOCK_REASON_MIN) throw new Scope3Error("UNLOCK_REASON_REQUIRED", { min_length: UNLOCK_REASON_MIN });
  const period = `${year}-${pad(month)}`;
  const reopened: number[] = [];
  await AppDataSource.transaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock($1, $2)`, [LOCK_CLASS, scope.companyId]);
    // A site's own rows; a company-wide unlock also reopens "every site" rows.
    const rows: Array<{ id: number; site_id: number | null }> = await tx.query(
      `SELECT id, site_id FROM period_lock
        WHERE company_id = $1 AND year = $2 AND (month = $3 OR month IS NULL) AND reopened_at IS NULL
          AND (site_id = ANY($4::int[]) OR ($5::boolean AND site_id IS NULL))
        ORDER BY id FOR UPDATE`,
      [scope.companyId, year, month, scope.siteIds, companyWide],
    );
    for (const r of rows) {
      await tx.query(`UPDATE period_lock SET reopened_by = $2, reopened_at = now(), reopened_reason = $3 WHERE id = $1`, [r.id, caller.userId, why]);
      await auditLock(tx, Number(r.id), "unlock", r.site_id === null ? null : Number(r.site_id), period, caller.userId, why);
      reopened.push(Number(r.id));
    }
  });
  log.info("Scope3Review", "Month reopened", { companyId: scope.companyId, lockIds: reopened, period, userId: caller.userId });
  return periodStatus(AppDataSource.manager, scope, year, month);
}
