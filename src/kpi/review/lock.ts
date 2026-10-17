/**
 * KPI-8 · close a KPI period (01-contracts §3, the CloseMonthView pattern; D11).
 *
 *   GET  /kpi/periods/lock?year=&period=&site=   what's left per site before the period can close
 *   POST /kpi/periods/lock   {year, period?, site_id?}           → {lock, status}
 *   POST /kpi/periods/unlock {year, period?, site_id?, reason}   → {lock, status}
 *
 * `year` is the reporting year in the company's year type (FY 2026 = April
 * 2025–March 2026); `period` a calendar month 1–12 of it, or omitted/null for
 * the whole year. A value belongs to the period its own period ENDS in (as My
 * KPIs and the emissions lock read it): a September lock covers September's
 * monthly values, Q3 (Jul–Sep) and an annual value ending in September.
 *
 * Expected: every selected manual KPI × its targets × each of its periods
 * ending in the range. Targets: the company for company-level KPIs (shown as
 * a "Company" row, site_id null); for site-level KPIs the sites it's assigned
 * on, or every site when it has no site assignment. Left = missing, draft,
 * pending or rejected (auto and calculated values follow their sources and
 * never hold a period open).
 *
 * Who: Managers for their own sites (site_id required to lock or unlock),
 * Admins and the Superadmin for one site or the whole company (site_id null:
 * every site and the company-level values). Users: 403 KPI_FORBIDDEN.
 * Locking re-checks under the company's exclusive KPI lock (KPI_LOCK_CLASS),
 * which every value write holds shared, and refuses with 422
 * KPI_PERIOD_INCOMPLETE `details.left` while anything is left. Unlocking needs
 * a reason (400 KPI_REASON_REQUIRED). Both are audited (`kpi_period_lock`).
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import type { KpiFrequency, YearType } from "../contracts/enums";
import { KpiError } from "../contracts/errors";
import { KpiPeriodLockBodySchema, KpiPeriodLockQuerySchema } from "../contracts/schemas";
import type { KpiCaller } from "../guard";
import { parse } from "../http";
import { kpiSettings } from "../setup/settings";
import { isoDay, monthRange, periodsFor, yearRange, type KpiPeriod } from "../values/period";
import { assertSetupDone, KPI_LOCK_CLASS, lockMonthYear } from "../values/service";

type Row = Record<string, any>;

const LOCKERS = new Set<string>([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN]);
const COMPANY_WIDE = new Set<string>([UserRole.ADMIN, UserRole.SUPERADMIN]);

export const LEFT_REASONS = ["missing", "draft", "pending", "rejected"] as const;
export type LeftReason = (typeof LEFT_REASONS)[number];

export interface LeftItem {
  site_id: number | null;
  site_name: string | null;
  kpi_definition_id: number;
  code: string;
  kpi_name: string;
  period_start: string;
  period_label: string;
  reason: LeftReason;
  value_id: number | null;
}

type Counts = { missing: number; draft: number; pending: number; approved: number; rejected: number };

const day = (v: unknown) => isoDay(v) as string;
const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null);

/** The calendar range a lock (or a status request) covers. */
export const lockRange = (yearType: YearType, year: number, period: number | null) =>
  period ? monthRange(lockMonthYear(yearType, year, period), period) : yearRange(yearType, year);

/**
 * Which sites a site-level KPI is expected on: those it's assigned on (when it
 * has any site assignment), else every site in `all`. Shared with KPI-10.
 */
export const expectedSites = (kpiId: number, all: number[], assignments: Row[]): number[] => {
  const assigned = assignments.filter((a) => Number(a.kpi_definition_id) === kpiId && a.site_id !== null).map((a) => Number(a.site_id));
  return assigned.length ? all.filter((s) => assigned.includes(s)) : all;
};

/** Pure: the period's left items and per-target counts for one company. */
export function periodLeft(input: {
  range: { start: string; end: string };
  yearType: YearType;
  year: number;
  kpis: Array<{ id: number; code: string; name: string; level: string; frequency: KpiFrequency }>;
  sites: Array<{ site_id: number; name: string }>;
  includeCompany: boolean;
  assignments: Row[];
  values: Array<{ id: number; kpi_definition_id: number; site_id: number | null; period_start: string; frequency: string; status: string }>;
}) {
  const left: LeftItem[] = [];
  const perTarget = new Map<string, Map<number, { kpi_definition_id: number; code: string; name: string; periods: string[]; counts: Counts }>>();
  const key = (s: number | null) => (s === null ? "company" : String(s));
  const siteName = new Map(input.sites.map((s) => [s.site_id, s.name]));
  const byKey = new Map(input.values.map((v) => [`${v.kpi_definition_id}|${v.site_id ?? ""}|${v.period_start}|${v.frequency}`, v]));
  const allSites = input.sites.map((s) => s.site_id);
  for (const k of input.kpis) {
    const periods: KpiPeriod[] = periodsFor(k.frequency, input.yearType, input.year).filter((p) => p.end >= input.range.start && p.end <= input.range.end);
    if (!periods.length) continue;
    const targets: Array<number | null> = k.level === "company" ? (input.includeCompany ? [null] : []) : expectedSites(k.id, allSites, input.assignments);
    for (const t of targets) {
      const map = perTarget.get(key(t)) ?? new Map();
      perTarget.set(key(t), map);
      const entry = map.get(k.id) ?? { kpi_definition_id: k.id, code: k.code, name: k.name, periods: [], counts: { missing: 0, draft: 0, pending: 0, approved: 0, rejected: 0 } };
      map.set(k.id, entry);
      for (const p of periods) {
        entry.periods.push(p.start);
        const v = byKey.get(`${k.id}|${t ?? ""}|${p.start}|${p.frequency}`);
        const status = (v?.status ?? "missing") as keyof Counts;
        entry.counts[status] = (entry.counts[status] ?? 0) + 1;
        if (status !== "approved") {
          left.push({ site_id: t, site_name: t === null ? null : siteName.get(t) ?? null, kpi_definition_id: k.id, code: k.code, kpi_name: k.name, period_start: p.start, period_label: p.label, reason: status as LeftReason, value_id: v ? v.id : null });
        }
      }
    }
  }
  left.sort((a, b) => (a.site_id ?? 0) - (b.site_id ?? 0) || a.code.localeCompare(b.code) || a.period_start.localeCompare(b.period_start));
  return { left, perTarget };
}

interface Scope {
  companyId: number;
  /** Sites the request covers. */
  sites: Array<{ site_id: number; name: string }>;
  /** Whether the company-level values are in it (no site named). */
  includeCompany: boolean;
}

async function scopeFor(m: EntityManager, caller: KpiCaller, siteId: number | null | undefined, write: boolean): Promise<Scope> {
  if (!LOCKERS.has(caller.role)) throw new KpiError("KPI_FORBIDDEN", { allowed: ["Manager", "Admin", "Superadmin"] });
  const all: Row[] = await m.query(`SELECT site_id, name FROM site WHERE company_id = $1 ORDER BY site_id`, [caller.companyId]);
  const mine = all.filter((s) => !caller.sites || caller.sites.has(Number(s.site_id))).map((s) => ({ site_id: Number(s.site_id), name: String(s.name) }));
  if (siteId) {
    const site = mine.find((s) => s.site_id === siteId);
    if (!site) throw new KpiError("KPI_NOT_FOUND", { site_id: siteId });
    return { companyId: caller.companyId, sites: [site], includeCompany: false };
  }
  if (write && !COMPANY_WIDE.has(caller.role)) throw new KpiError("KPI_FORBIDDEN", { rule: "name_one_of_your_sites" });
  return { companyId: caller.companyId, sites: mine, includeCompany: true };
}

export async function periodStatus(m: EntityManager, scope: Scope, year: number, period: number | null) {
  const settings = await kpiSettings(m, scope.companyId);
  const yearType = settings.year_type;
  const range = lockRange(yearType, year, period);
  const kpis: Row[] = await m.query(
    `SELECT d.id, d.code, d.name, d.level, COALESCE(ck.frequency, d.default_frequency) AS frequency
       FROM kpi_definition d JOIN company_kpi ck ON ck.kpi_definition_id = d.id AND ck.company_id = $1 AND ck.selected
      WHERE d.active AND d.source = 'manual' AND (d.company_id IS NULL OR d.company_id = $1) ORDER BY d.code`,
    [scope.companyId],
  );
  const assignments: Row[] = await m.query(`SELECT kpi_definition_id, site_id FROM kpi_assignment WHERE company_id = $1`, [scope.companyId]);
  const values: Row[] = await m.query(
    `SELECT id, kpi_definition_id, site_id, period_start, frequency, status FROM kpi_value
      WHERE company_id = $1 AND source = 'manual' AND period_end >= $2 AND period_end <= $3`,
    [scope.companyId, range.start, range.end],
  );
  const { left, perTarget } = periodLeft({
    range,
    yearType,
    year,
    kpis: kpis.map((k) => ({ id: Number(k.id), code: k.code, name: k.name, level: k.level, frequency: k.frequency })),
    sites: scope.sites,
    includeCompany: scope.includeCompany,
    assignments,
    values: values.map((v) => ({ id: Number(v.id), kpi_definition_id: Number(v.kpi_definition_id), site_id: v.site_id === null ? null : Number(v.site_id), period_start: day(v.period_start), frequency: v.frequency, status: v.status })),
  });

  const locks: Row[] = await m.query(
    `SELECT l.*, TRIM(CONCAT(COALESCE(lb.name, ''), ' ', COALESCE(lb.last_name, ''))) AS locked_by_name, TRIM(CONCAT(COALESCE(rb.name, ''), ' ', COALESCE(rb.last_name, ''))) AS reopened_by_name
       FROM kpi_period_lock l LEFT JOIN "user" lb ON lb.user_id = l.locked_by LEFT JOIN "user" rb ON rb.user_id = l.reopened_by
      WHERE l.company_id = $1 AND l.year = $2 AND ${period ? "(l.period = $3 OR l.period IS NULL)" : "l.period IS NULL"}
      ORDER BY l.id`,
    period ? [scope.companyId, year, period] : [scope.companyId, year],
  );
  const lockOut = (l: Row | undefined) =>
    l ? { id: Number(l.id), site_id: l.site_id === null ? null : Number(l.site_id), year: Number(l.year), period: l.period === null ? null : Number(l.period), year_type: l.year_type, locked_by: Number(l.locked_by), locked_by_name: l.locked_by_name || null, locked_at: iso(l.locked_at) } : null;
  const targetRow = (siteId: number | null, name: string) => {
    const own = locks.filter((l) => (siteId === null ? l.site_id === null : l.site_id === null || Number(l.site_id) === siteId));
    const active = own.filter((l) => !l.reopened_at).pop();
    const reopened = own.filter((l) => l.reopened_at).pop();
    const kpisOut = [...(perTarget.get(siteId === null ? "company" : String(siteId))?.values() ?? [])].map((e) => ({ ...e, missing: e.counts.missing > 0 }));
    return {
      site_id: siteId,
      name,
      locked: !!active,
      lock: lockOut(active),
      reopened: !active && reopened ? { reopened_at: iso(reopened.reopened_at), reopened_by: reopened.reopened_by === null ? null : Number(reopened.reopened_by), reopened_by_name: reopened.reopened_by_name || null, reason: reopened.reopened_reason ?? null } : null,
      kpis: kpisOut,
      left: left.filter((x) => x.site_id === siteId).length,
    };
  };
  const sites = [...(scope.includeCompany ? [targetRow(null, "Company")] : []), ...scope.sites.map((s) => targetRow(s.site_id, s.name))];
  const label = period ? periodsFor("monthly", yearType, year).find((p) => p.start === range.start)?.label ?? null : periodsFor("annual", yearType, year)[0].label;
  return {
    company_id: scope.companyId,
    year,
    period,
    year_type: yearType,
    label,
    range,
    sites,
    left,
    can_lock: left.length === 0 && sites.length > 0,
    locked: sites.length > 0 && sites.every((s) => s.locked),
  };
}

export async function getPeriodStatus(caller: KpiCaller, query: unknown) {
  const q = parse(KpiPeriodLockQuerySchema, query ?? {});
  const m = AppDataSource.manager;
  await assertSetupDone(m, caller.companyId);
  const scope = await scopeFor(m, caller, q.site ?? null, false);
  return periodStatus(m, scope, q.year, q.period ?? null);
}

const auditLock = (m: EntityManager, id: number, action: "lock" | "unlock", siteId: number | null, year: number, period: number | null, userId: number, reason: string | null) =>
  m.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('kpi_period_lock', $1, $2, $3, $4, $5)`, [
    id,
    action,
    JSON.stringify({ locked: { old: action === "unlock", new: action === "lock" }, site_id: { old: siteId, new: siteId }, year: { old: year, new: year }, period: { old: period, new: period } }),
    reason,
    userId || null,
  ]);

export async function lockPeriod(caller: KpiCaller, body: unknown) {
  const b = parse(KpiPeriodLockBodySchema, body ?? {});
  const period = b.period ?? null;
  const siteId = b.site_id ?? null;
  const lockId = await AppDataSource.transaction(async (m) => {
    await assertSetupDone(m, caller.companyId);
    const scope = await scopeFor(m, caller, siteId, true);
    // Exclusive: waits for value writes in flight (they hold the key shared), and blocks new ones until this commits.
    await m.query(`SELECT pg_advisory_xact_lock($1, $2)`, [KPI_LOCK_CLASS, caller.companyId]);
    const status = await periodStatus(m, scope, b.year, period);
    if (status.left.length) throw new KpiError("KPI_PERIOD_INCOMPLETE", { left: status.left });
    const [existing]: Row[] = await m.query(
      `SELECT id, reopened_at FROM kpi_period_lock WHERE company_id = $1 AND site_id IS NOT DISTINCT FROM $2 AND year = $3 AND period IS NOT DISTINCT FROM $4 FOR UPDATE`,
      [caller.companyId, siteId, b.year, period],
    );
    if (existing && !existing.reopened_at) return Number(existing.id);
    let id: number;
    if (existing) {
      await m.query(`UPDATE kpi_period_lock SET locked_by = $2, locked_at = now(), year_type = $3, reopened_by = NULL, reopened_at = NULL, reopened_reason = NULL WHERE id = $1`, [existing.id, caller.userId, status.year_type]);
      id = Number(existing.id);
    } else {
      const [row]: Row[] = await m.query(
        `INSERT INTO kpi_period_lock (company_id, site_id, year, period, year_type, locked_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [caller.companyId, siteId, b.year, period, status.year_type, caller.userId],
      );
      id = Number(row.id);
    }
    await auditLock(m, id, "lock", siteId, b.year, period, caller.userId, null);
    return id;
  });
  return { lock: await lockRow(lockId), status: await periodStatus(AppDataSource.manager, await scopeFor(AppDataSource.manager, caller, siteId, false), b.year, period) };
}

export async function unlockPeriod(caller: KpiCaller, body: unknown) {
  const b = parse(KpiPeriodLockBodySchema, body ?? {});
  const reason = (b.reason ?? "").trim();
  if (!reason) throw new KpiError("KPI_REASON_REQUIRED", { field: "reason" });
  const period = b.period ?? null;
  const siteId = b.site_id ?? null;
  const lockId = await AppDataSource.transaction(async (m) => {
    await scopeFor(m, caller, siteId, true);
    await m.query(`SELECT pg_advisory_xact_lock($1, $2)`, [KPI_LOCK_CLASS, caller.companyId]);
    const [row]: Row[] = await m.query(
      `SELECT id FROM kpi_period_lock WHERE company_id = $1 AND site_id IS NOT DISTINCT FROM $2 AND year = $3 AND period IS NOT DISTINCT FROM $4 AND reopened_at IS NULL FOR UPDATE`,
      [caller.companyId, siteId, b.year, period],
    );
    if (!row) {
      // A site under a company-wide (or whole-year) lock reopens only with that lock.
      const [wider]: Row[] = await m.query(
        `SELECT site_id, period FROM kpi_period_lock WHERE company_id = $1 AND year = $2 AND reopened_at IS NULL AND (site_id IS NULL OR site_id IS NOT DISTINCT FROM $3) AND (period IS NULL OR period IS NOT DISTINCT FROM $4) LIMIT 1`,
        [caller.companyId, b.year, siteId, period],
      );
      throw new KpiError("KPI_NOT_FOUND", wider ? { locked_by: { site_id: wider.site_id === null ? null : Number(wider.site_id), period: wider.period === null ? null : Number(wider.period) } } : { locked: false });
    }
    await m.query(`UPDATE kpi_period_lock SET reopened_by = $2, reopened_at = now(), reopened_reason = $3 WHERE id = $1`, [row.id, caller.userId, reason]);
    await auditLock(m, Number(row.id), "unlock", siteId, b.year, period, caller.userId, reason);
    return Number(row.id);
  });
  return { lock: await lockRow(lockId), status: await periodStatus(AppDataSource.manager, await scopeFor(AppDataSource.manager, caller, siteId, false), b.year, period) };
}

async function lockRow(id: number) {
  const [l]: Row[] = await AppDataSource.query(`SELECT * FROM kpi_period_lock WHERE id = $1`, [id]);
  return {
    id: Number(l.id),
    company_id: Number(l.company_id),
    site_id: l.site_id === null ? null : Number(l.site_id),
    year: Number(l.year),
    period: l.period === null ? null : Number(l.period),
    year_type: l.year_type,
    locked_by: Number(l.locked_by),
    locked_at: iso(l.locked_at),
    reopened_by: l.reopened_by === null ? null : Number(l.reopened_by),
    reopened_at: iso(l.reopened_at),
    reopened_reason: l.reopened_reason ?? null,
  };
}
