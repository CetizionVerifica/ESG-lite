/**
 * DS-5 · GET /studio/readiness?kind=&year=&yearType=&sites= (role R).
 *
 * GHG (05-ux S1 card), for the period and the caller's sites in scope:
 *   - approved, pending and rejected entry counts (the status values the GHG
 *     report reads: `approved` only goes into figures; Scope 1–3 categories);
 *   - sites with no approved rows;
 *   - months missing per site that reports monthly (a site with monthly rows
 *     in the period); months still to come are not expected;
 *   - Scope 3 categories addressed n/15: reported (approved tCO₂e in the
 *     category, computeScope3), or excluded / not relevant in screening;
 *   - each gap with a deep link: Review (/data/approvals), My entries
 *     (/data/mine), the ledger (/data/ledger?site=), Scope 3 screening.
 *
 * Sustainability: the RS readiness from the KPI modules, read-only:
 * dashboard() (coverage per framework, gaps, pending values) and
 * periodStatus() (the whole-year lock). Before KPI setup is done it says so.
 */
import { AppDataSource } from "../../config/data-source";
import { getPeriodRange } from "../../reporting/ghg-data";
import { KpiError } from "../../kpi/contracts/errors";
import { dashboard } from "../../kpi/dashboard/service";
import { periodStatus } from "../../kpi/review/lock";
import { kpiSettings } from "../../kpi/setup/settings";
import type { StudioCaller } from "../guard";
import type { GhgReadiness, ReadinessGap, SustainabilityReadiness, YearType } from "../contracts";
import { reportingMonthKeys } from "../sources/ghg/rows";
import { GhgLoader } from "../sources/ghg";
import { periodLabel } from "./build";

type Row = Record<string, any>;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2025-03" → "Mar 2025". */
export const monthText = (key: string) => `${MONTH_SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** "Categories 8, 10 and 13" / "Category 8". */
export function categoriesText(ns: number[]): string {
  if (ns.length === 1) return `Category ${ns[0]}`;
  return `Categories ${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export interface GhgReadinessFacts {
  year: number;
  yearType: YearType;
  sites: Array<{ id: number; name: string }>;
  counts: { approved: number; pending: number; rejected: number };
  /** Site id → approved rows in the period. */
  approvedBySite: Map<number, number>;
  /** Site id → months (YYYY-MM) with approved monthly rows. */
  approvedMonths: Map<number, Set<string>>;
  /** Sites with monthly rows (any status) in the period. */
  monthlySites: Set<number>;
  /** The months of the period that have started (YYYY-MM). */
  monthsSoFar: string[];
  scope3: { reported: number[]; excluded: number[] };
}

/** Pure: the GHG readiness from the counted facts. */
export function ghgReadiness(f: GhgReadinessFacts): GhgReadiness {
  const gaps: ReadinessGap[] = [];
  const label = periodLabel(f.yearType, f.year);
  if (f.counts.approved === 0) {
    gaps.push({ kind: "no_data", severity: "error", message: `There are no approved emission entries for ${label} yet.`, link: "/data/approvals", linkLabel: "Open Review", count: 0 });
  }
  if (f.counts.pending > 0) {
    gaps.push({
      kind: "pending_entries",
      severity: "error",
      message: `${plural(f.counts.pending, "entry waits", "entries wait")} for approval. A final needs them approved.`,
      link: "/data/approvals",
      linkLabel: "Open Review",
      count: f.counts.pending,
    });
  }
  if (f.counts.rejected > 0) {
    gaps.push({
      kind: "rejected_entries",
      severity: "warning",
      message: `${plural(f.counts.rejected, "rejected entry isn't", "rejected entries aren't")} corrected yet.`,
      link: "/data/mine",
      linkLabel: "My entries",
      count: f.counts.rejected,
    });
  }
  const sitesMissing = f.sites.filter((s) => !(f.approvedBySite.get(s.id) ?? 0));
  for (const s of sitesMissing) {
    gaps.push({ kind: "site_no_data", severity: "warning", message: `${s.name} has no approved data for ${label}.`, link: `/data/ledger?site=${s.id}`, linkLabel: "Open site", siteId: s.id });
  }
  const monthsMissing: GhgReadiness["monthsMissing"] = [];
  for (const s of f.sites) {
    if (!f.monthlySites.has(s.id)) continue;
    const have = f.approvedMonths.get(s.id) ?? new Set<string>();
    const missing = f.monthsSoFar.filter((m) => !have.has(m));
    if (!missing.length || missing.length === f.monthsSoFar.length) continue; // a site with nothing is already "no approved data"
    monthsMissing.push({ siteId: s.id, siteName: s.name, months: missing });
    gaps.push({
      kind: "months_missing",
      severity: "warning",
      message: `${s.name} has no approved data for ${missing.length > 3 ? `${missing.length} months` : missing.map(monthText).join(", ")}.`,
      link: `/data/ledger?site=${s.id}`,
      linkLabel: "Open site",
      siteId: s.id,
      months: missing,
    });
  }
  const covered = new Set<string>();
  for (const months of f.approvedMonths.values()) for (const m of months) if (f.monthsSoFar.includes(m)) covered.add(m);
  const reported = [...new Set(f.scope3.reported)].filter((n) => n >= 1 && n <= 15).sort((a, b) => a - b);
  const excluded = [...new Set(f.scope3.excluded)].filter((n) => n >= 1 && n <= 15 && !reported.includes(n)).sort((a, b) => a - b);
  const unaddressed = Array.from({ length: 15 }, (_, i) => i + 1).filter((n) => !reported.includes(n) && !excluded.includes(n));
  if (unaddressed.length) {
    gaps.push({
      kind: "scope3_unaddressed",
      severity: "warning",
      message: `${categoriesText(unaddressed)} ${unaddressed.length === 1 ? "is" : "are"} neither reported nor excluded.`,
      link: "/settings/scope3/screening",
      linkLabel: "Scope 3 screening",
      categories: unaddressed,
    });
  }
  const state = gaps.some((g) => g.kind === "no_data") ? "not_ready" : gaps.length ? "almost" : "ready";
  return {
    kind: "ghg",
    year: f.year,
    yearType: f.yearType,
    periodLabel: label,
    approvedRows: f.counts.approved,
    pendingRows: f.counts.pending,
    rejectedRows: f.counts.rejected,
    sitesCovered: f.sites.length - sitesMissing.length,
    sitesTotal: f.sites.length,
    sitesMissing,
    monthsCovered: covered.size,
    monthsExpected: f.monthsSoFar.length,
    monthsMissing,
    scope3Addressed: `${reported.length + excluded.length}/15`,
    scope3: { reported, excluded, unaddressed },
    state,
    gaps,
  };
}

/** The months of the reporting year that have started by `now` (all 12 for a past year). */
export function monthsSoFar(yearType: YearType, year: number, now = new Date()): string[] {
  const nowKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return reportingMonthKeys(yearType, year).filter((m) => m <= nowKey);
}

export async function loadGhgReadiness(caller: StudioCaller, q: { year: number; yearType: YearType; siteIds: number[] }): Promise<GhgReadiness> {
  const range = getPeriodRange(q.yearType, q.year, "yearly");
  const sites: Row[] = q.siteIds.length ? await AppDataSource.query(`SELECT site_id, name FROM site WHERE site_id = ANY($1::int[]) ORDER BY site_id`, [q.siteIds]) : [];
  const rows: Row[] = q.siteIds.length
    ? await AppDataSource.query(
        `SELECT e.site_id, e.status::text AS status, e.reporting_period, to_char(date_trunc('month', e.date_of_reporting), 'YYYY-MM') AS month, COUNT(*)::int AS n
           FROM emission e LEFT JOIN category c ON c.category_id = e.category_id
          WHERE e.site_id = ANY($1::int[]) AND e.date_of_reporting >= $2 AND e.date_of_reporting <= $3
            AND c.scope IN ('Scope 1', 'Scope 2', 'Scope 3') AND e.status::text IN ('approved', 'pending', 'rejected')
          GROUP BY 1, 2, 3, 4`,
        [q.siteIds, range.startDate, range.endDate],
      )
    : [];
  const counts = { approved: 0, pending: 0, rejected: 0 };
  const approvedBySite = new Map<number, number>();
  const approvedMonths = new Map<number, Set<string>>();
  const monthlySites = new Set<number>();
  for (const r of rows) {
    const site = Number(r.site_id);
    const n = Number(r.n) || 0;
    counts[r.status as keyof typeof counts] += n;
    if (r.reporting_period !== "yearly") monthlySites.add(site);
    if (r.status !== "approved") continue;
    approvedBySite.set(site, (approvedBySite.get(site) ?? 0) + n);
    if (r.reporting_period !== "yearly") {
      const set = approvedMonths.get(site) ?? new Set<string>();
      set.add(String(r.month));
      approvedMonths.set(site, set);
    }
  }
  let reported: number[] = [];
  let excluded: number[] = [];
  if (q.siteIds.length) {
    const s3 = await new GhgLoader(caller.companyId, q.yearType).scope3(q.year, q.siteIds);
    reported = s3.rows.filter((r) => r.n !== null && r.tco2e > 0).map((r) => Number(r.n));
  }
  const screening: Row[] = await AppDataSource.query(`SELECT ghg_category, status FROM company_scope3_category WHERE company_id = $1 AND status IN ('excluded', 'not_relevant')`, [caller.companyId]).catch(() => []);
  excluded = screening.map((r) => Number(r.ghg_category));
  return ghgReadiness({
    year: q.year,
    yearType: q.yearType,
    sites: sites.map((s) => ({ id: Number(s.site_id), name: String(s.name) })),
    counts,
    approvedBySite,
    approvedMonths,
    monthlySites,
    monthsSoFar: monthsSoFar(q.yearType, q.year),
    scope3: { reported, excluded },
  });
}

/** Pure: the RS readiness from the KPI dashboard and lock answers. */
export function sustainabilityReadiness(input: {
  year: number;
  yearType: YearType;
  setupDone: boolean;
  locked: boolean;
  lockedAt: string | null;
  coverage: Array<{ framework: string; pct: number }>;
  gaps: Array<{ code: string; kpi_name: string; site_id: number | null; period_labels: string[] }>;
  pendingCount: number;
}): SustainabilityReadiness {
  const label = periodLabel(input.yearType, input.year);
  const gaps: ReadinessGap[] = [];
  const missing = new Map<string, { kpi: string; name: string; sites: Set<number>; periods: Set<string> }>();
  for (const g of input.gaps) {
    const m = missing.get(g.code) ?? { kpi: g.code, name: g.kpi_name, sites: new Set<number>(), periods: new Set<string>() };
    if (g.site_id !== null) m.sites.add(g.site_id);
    g.period_labels.forEach((p) => m.periods.add(p));
    missing.set(g.code, m);
  }
  if (!input.setupDone) {
    gaps.push({ kind: "kpi_setup", severity: "error", message: "KPI setup isn't finished, so there are no KPI values to report yet.", link: "/kpi/setup", linkLabel: "Open KPI setup" });
  } else {
    if (missing.size) {
      gaps.push({
        kind: "kpi_missing",
        severity: "warning",
        message: `${plural(input.gaps.length, "KPI value set is", "KPI value sets are")} missing for ${label}.`,
        link: "/kpi/dashboard",
        linkLabel: "Open KPI dashboard",
        count: input.gaps.length,
      });
    }
    if (input.pendingCount > 0) {
      gaps.push({ kind: "kpi_pending", severity: "warning", message: `${plural(input.pendingCount, "KPI value waits", "KPI values wait")} for approval.`, link: "/data/approvals?view=kpi", linkLabel: "Open Review", count: input.pendingCount });
    }
    if (!input.locked) {
      gaps.push({ kind: "year_not_locked", severity: "error", message: `${label} isn't locked yet. A final needs the year locked.`, link: "/kpi/dashboard", linkLabel: "Lock the year" });
    }
  }
  const state = !input.setupDone ? "not_ready" : gaps.length ? "almost" : "ready";
  return {
    kind: "sustainability",
    year: input.year,
    yearType: input.yearType,
    periodLabel: label,
    setupDone: input.setupDone,
    locked: input.locked,
    lockedAt: input.lockedAt,
    coverage: input.coverage,
    missing: [...missing.values()].map((m) => ({ kpi: m.kpi, name: m.name, sites: [...m.sites].sort((a, b) => a - b), periods: [...m.periods] })),
    pendingCount: input.pendingCount,
    state,
    gaps,
  };
}

export async function loadSustainabilityReadiness(caller: StudioCaller, year: number): Promise<SustainabilityReadiness> {
  const m = AppDataSource.manager;
  const yearType = (await kpiSettings(m, caller.companyId)).year_type as YearType;
  const kpiCaller = { companyId: caller.companyId, userId: caller.userId, role: caller.role, sites: caller.sites };
  let dash: Awaited<ReturnType<typeof dashboard>> | null = null;
  try {
    dash = await dashboard(kpiCaller, { year });
  } catch (err) {
    if (!(err instanceof KpiError && err.code === "KPI_SETUP_INCOMPLETE")) throw err;
  }
  if (!dash) return sustainabilityReadiness({ year, yearType, setupDone: false, locked: false, lockedAt: null, coverage: [], gaps: [], pendingCount: 0 });
  const allSites: Row[] = await m.query(`SELECT site_id, name FROM site WHERE company_id = $1 ORDER BY site_id`, [caller.companyId]);
  const mine = allSites.filter((s) => !caller.sites || caller.sites.has(Number(s.site_id))).map((s) => ({ site_id: Number(s.site_id), name: String(s.name) }));
  const status = await periodStatus(m, { companyId: caller.companyId, sites: mine, includeCompany: true }, year, null);
  const lockTimes = status.sites.map((s) => s.lock?.locked_at).filter((t): t is string => !!t).sort();
  return sustainabilityReadiness({
    year,
    yearType,
    setupDone: true,
    locked: status.locked,
    lockedAt: status.locked ? lockTimes[lockTimes.length - 1] ?? null : null,
    coverage: dash.coverage.map((c) => ({ framework: c.framework, pct: c.percent })),
    gaps: (dash.gaps as Row[]).map((g) => ({ code: String(g.code), kpi_name: String(g.kpi_name), site_id: g.site_id === null ? null : Number(g.site_id), period_labels: (g.period_labels ?? []) as string[] })),
    pendingCount: Number(dash.pending_not_in.kpi_values) || 0,
  });
}
