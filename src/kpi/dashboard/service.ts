/**
 * KPI-10 · GET /kpi/dashboard?year=&framework=&site=&topic= (Manager, Admin,
 * Superadmin; a User → 403 KPI_FORBIDDEN; 409 KPI_SETUP_INCOMPLETE before setup).
 *
 *   coverage        per enabled framework (or the one asked for): coverage.ts, plus `gaps`
 *                   (how many gap rows answer its counted disclosures)
 *   gaps            manual selected KPIs × targets × periods of the year that have ended with
 *                   nothing submitted (missing, draft or rejected), one row per KPI and target:
 *                   {kpi_definition_id, code, kpi_name, topic, site_id, site_name, periods_missing,
 *                   period_labels, owner_user_id, owner_name, link}
 *   cards           selected numeric KPIs: the year's approved figure, last year's, % change,
 *                   12 periods, status and the target's progress (KPI-9)
 *   pending_not_in  KPI values and emission rows of the year waiting for review: not counted (D14)
 *
 * Scope: the caller's sites (a Manager's own; `site` narrows to one of them)
 * and the company-level KPIs. Figures read approved values only. A KPI's
 * state for coverage: manual KPIs need an approved value for every target ×
 * every period of the year that has ended (`expectedSites`: the sites where it
 * has an owner through the D17 resolver, else every site); auto and calculated KPIs count the values that exist
 * (none at all = missing); nothing due yet = not_due.
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import { NUMERIC_VALUE_TYPES, pillarOfTopic, type YearType } from "../contracts/enums";
import { KpiError } from "../contracts/errors";
import { KpiDashboardQuerySchema } from "../contracts/schemas";
import type { KpiCaller } from "../guard";
import { parse } from "../http";
import { expectedSites } from "../review/lock";
import { ownerIndex } from "../setup/owners";
import { enabledFrameworks, kpiSettings, todayIso } from "../setup/settings";
import { figureDefs, targetsWithProgress } from "../targets/service";
import { periodsFor, yearRange, type KpiPeriod } from "../values/period";
import { assertSetupDone } from "../values/service";
import { combine, figureOf, loadValues, type FigureDef, type StoredValue } from "../values/yearly";
import { coverage, type FrameworkCoverage, type KpiState } from "./coverage";

type Row = Record<string, any>;

export const DASHBOARD_ROLES = new Set<string>([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN]);
const SERIES_LENGTH = 12;

export interface DashboardScope {
  companyId: number;
  yearType: YearType;
  /** Sites in scope (the caller's, or the one asked for). */
  sites: Array<{ site_id: number; name: string }>;
  siteFilter: number | null;
}

export async function dashboardScope(m: EntityManager, caller: KpiCaller, site: number | undefined): Promise<DashboardScope> {
  if (!DASHBOARD_ROLES.has(caller.role)) throw new KpiError("KPI_FORBIDDEN", { allowed: ["Manager", "Admin", "Superadmin"] });
  await assertSetupDone(m, caller.companyId);
  const all: Row[] = await m.query(`SELECT site_id, name FROM site WHERE company_id = $1 ORDER BY site_id`, [caller.companyId]);
  let sites = all.filter((s) => !caller.sites || caller.sites.has(Number(s.site_id))).map((s) => ({ site_id: Number(s.site_id), name: String(s.name) }));
  if (site !== undefined) {
    sites = sites.filter((s) => s.site_id === site);
    if (!sites.length) throw new KpiError("KPI_NOT_FOUND", { site_id: site });
  }
  return { companyId: caller.companyId, yearType: (await kpiSettings(m, caller.companyId)).year_type, sites, siteFilter: site ?? null };
}

const ym = (iso: string) => iso.slice(0, 7);

/** The last `n` periods of `frequency` ending with the end of reporting year `year`. */
function lastPeriods(def: FigureDef, yearType: YearType, year: number, n: number): KpiPeriod[] {
  const out: KpiPeriod[] = [];
  for (let y = year; out.length < n && y > year - n - 1; y--) out.unshift(...periodsFor(def.frequency, yearType, y));
  return out.slice(-n);
}

export async function dashboard(caller: KpiCaller, query: unknown) {
  const q = parse(KpiDashboardQuerySchema, query ?? {});
  const m = AppDataSource.manager;
  const scope = await dashboardScope(m, caller, q.site);
  const { yearType } = scope;
  const siteIds = scope.sites.map((s) => s.site_id);
  const siteName = new Map(scope.sites.map((s) => [s.site_id, s.name]));
  const today = todayIso();
  const range = yearRange(yearType, q.year);

  const frameworks = (await enabledFrameworks(m, caller.companyId)).filter((f) => !q.framework || f.code === q.framework);
  const { byId, byCode } = await figureDefs(m, caller.companyId);
  const selected = [...byId.values()].filter((d) => d.selected && d.active);
  // D17: owners (and the expected sites) through the resolver: per-KPI override, else topic owner.
  const owners = await ownerIndex(m, caller.companyId);
  const allSites: number[] = (await m.query(`SELECT site_id FROM site WHERE company_id = $1`, [caller.companyId])).map((r: Row) => Number(r.site_id));
  const assignments = owners.ownedPairs(selected.filter((d) => d.source === "manual").map((d) => ({ id: d.id, topic: String(d.topic), level: d.level })), allSites);

  // Values: every status for the year (states and gaps), approved ones back 11 years (cards).
  const yearValues = await loadValues(m, caller.companyId, { from: range.start, to: range.end, statuses: ["draft", "pending", "approved", "rejected"] });
  const approved = await loadValues(m, caller.companyId, { from: yearRange(yearType, q.year - SERIES_LENGTH + 1).start, to: range.end, statuses: ["approved"] });
  const inScope = (v: StoredValue) => v.site_id === null || siteIds.includes(v.site_id);
  const key = (kpi: number, site: number | null, start: string, freq: string) => `${kpi}|${site ?? ""}|${start}|${freq}`;
  const byKey = new Map(yearValues.filter(inScope).map((v) => [key(v.kpi_definition_id, v.site_id, v.period_start, v.frequency), v]));

  // State of each selected KPI for coverage, and the gaps.
  const states = new Map<number, KpiState>();
  const gaps: Row[] = [];
  for (const d of selected) {
    const periods = periodsFor(d.frequency, yearType, q.year);
    const due = periods.filter((p) => p.end < today);
    if (d.source !== "manual") {
      const mine = yearValues.filter((v) => v.kpi_definition_id === d.id && v.frequency === d.frequency && inScope(v) && (d.level === "company" ? v.site_id === null : v.site_id !== null));
      states.set(d.id, !mine.length ? (due.length ? "missing" : "not_due") : mine.some((v) => v.status === "pending") ? "pending" : "approved");
      continue;
    }
    const targets: Array<number | null> = d.level === "company" ? [null] : expectedSites(d.id, siteIds, assignments);
    if (!due.length || !targets.length) {
      states.set(d.id, "not_due");
      continue;
    }
    let anyMissing = false;
    let anyPending = false;
    for (const t of targets) {
      const missing = due.filter((p) => {
        const v = byKey.get(key(d.id, t, p.start, p.frequency));
        if (v?.status === "pending") anyPending = true;
        return !v || (v.status !== "pending" && v.status !== "approved");
      });
      if (!missing.length) continue;
      anyMissing = true;
      const owner = owners.resolve({ id: d.id, topic: String(d.topic) }, t);
      const last = missing[missing.length - 1];
      gaps.push({
        kpi_definition_id: d.id,
        code: d.code,
        kpi_name: d.name,
        topic: d.topic,
        pillar: d.pillar ?? pillarOfTopic(d.topic),
        site_id: t,
        site_name: t === null ? null : siteName.get(t) ?? null,
        periods_missing: missing.map((p) => p.start),
        period_labels: missing.map((p) => p.label),
        owner_user_id: owner.owner_user_id,
        owner_name: owner.owner_name,
        link: `/kpi?period=${ym(last.end)}${t === null ? "" : `&site=${t}`}`,
      });
    }
    states.set(d.id, anyMissing ? "missing" : anyPending ? "pending" : "approved");
  }

  // Coverage per framework.
  const material = new Map<string, { material: boolean; reason: string | null }>(
    ((await m.query(`SELECT esrs_topic, material, reason FROM company_material_topic WHERE company_id = $1`, [caller.companyId])) as Row[]).map((r) => [r.esrs_topic, { material: r.material === true, reason: r.reason ?? null }]),
  );
  const kpiInfo = new Map([...byId.values()].map((d) => [d.id, { selected: d.selected === true && d.active === true, reason_excluded: d.reason_excluded ?? null, state: states.get(d.id) }]));
  const coverageOut: Array<FrameworkCoverage & { gaps: number }> = [];
  const frameworkKpis = new Set<number>();
  const frameworksOf = new Map<number, string[]>();
  for (const f of frameworks) {
    const disclosures: Row[] = await m.query(`SELECT id, code, title, section, requirement, esrs_topic FROM kpi_disclosure WHERE framework_id = $1 ORDER BY sort_key, code`, [f.framework_id]);
    const mappings: Row[] = await m.query(
      `SELECT mp.disclosure_id, mp.kpi_definition_id, mp.fit FROM kpi_disclosure_map mp JOIN kpi_disclosure ds ON ds.id = mp.disclosure_id
        JOIN kpi_definition d ON d.id = mp.kpi_definition_id AND (d.company_id IS NULL OR d.company_id = $2)
       WHERE ds.framework_id = $1`,
      [f.framework_id, caller.companyId],
    );
    const cov = coverage({
      framework: { id: Number(f.framework_id), code: f.code, version: f.version },
      disclosures: disclosures.map((d) => ({ id: Number(d.id), code: d.code, title: d.title, section: d.section, requirement: d.requirement, esrs_topic: d.esrs_topic ?? null })),
      mappings: mappings.map((x) => ({ disclosure_id: Number(x.disclosure_id), kpi_definition_id: Number(x.kpi_definition_id), fit: x.fit })),
      kpis: kpiInfo,
      material,
    });
    const answering = new Set(cov.disclosures.filter((d) => d.state !== "excluded").flatMap((d) => d.kpis));
    for (const k of answering) {
      frameworkKpis.add(k);
      frameworksOf.set(k, [...(frameworksOf.get(k) ?? []), f.code]);
    }
    coverageOut.push({
      ...cov,
      gaps: gaps.filter((g) => answering.has(g.kpi_definition_id)).length,
      ...(f.code === "ESRS" ? { material_topics: [...material.entries()].map(([esrs_topic, v]) => ({ esrs_topic, material: v.material, reason: v.reason })) } : {}),
    });
  }

  const topicOk = (d: Row) => !q.topic || d.topic === q.topic;
  const frameworkOk = (id: number) => !q.framework || frameworkKpis.has(id);
  const gapsOut = gaps
    .filter((g) => topicOk(g) && frameworkOk(g.kpi_definition_id) && (scope.siteFilter === null || g.site_id === scope.siteFilter))
    .map((g) => ({
      ...g,
      frameworks: frameworksOf.get(g.kpi_definition_id) ?? [],
      kpi: { id: g.kpi_definition_id, code: g.code, name: g.kpi_name },
      site: g.site_id === null ? null : { id: g.site_id, name: g.site_name },
      owner: g.owner_user_id === null ? null : { id: g.owner_user_id, name: g.owner_name },
    }));

  // Cards: selected numeric KPIs.
  const targets = await targetsWithProgress(m, caller, {});
  const figureOpts = (year: number) => ({ year, yearType, sites: siteIds, ...(scope.siteFilter !== null ? { site: scope.siteFilter } : {}) });
  const cards = selected
    .filter((d) => NUMERIC_VALUE_TYPES.includes(d.value_type as never) && topicOk(d) && frameworkOk(d.id))
    .filter((d) => scope.siteFilter === null || d.level === "site")
    .sort((a, b) => String(a.topic).localeCompare(String(b.topic)) || String(a.code).localeCompare(String(b.code)))
    .map((d) => {
      const def = d as FigureDef & { code: string };
      const now = figureOf(def, approved, byCode, figureOpts(q.year));
      const prev = figureOf(def, approved, byCode, figureOpts(q.year - 1));
      const series = lastPeriods(def, yearType, q.year, SERIES_LENGTH).map((p) => {
        const at = approved.filter((v) => v.kpi_definition_id === d.id && v.period_start === p.start && v.frequency === p.frequency);
        const pick = d.level === "company" ? at.filter((v) => v.site_id === null) : at.filter((v) => v.site_id !== null && (scope.siteFilter === null ? siteIds.includes(v.site_id) : v.site_id === scope.siteFilter));
        return { period: p.label, period_start: p.start, label: p.label, value: pick.length ? combine(pick.map((v) => v.value), d.aggregation) : null };
      });
      const target =
        targets
          .filter((t) => t.kpi_definition_id === d.id && t.site_id === (d.level === "site" ? scope.siteFilter : null))
          .sort((a, b) => (a.target_year >= q.year ? 0 : 1) - (b.target_year >= q.year ? 0 : 1) || a.target_year - b.target_year)[0] ?? null;
      const pending = yearValues.filter((v) => v.kpi_definition_id === d.id && v.status === "pending" && inScope(v)).length;
      return {
        kpi_definition_id: d.id,
        code: d.code,
        name: d.name,
        topic: d.topic,
        pillar: d.pillar ?? pillarOfTopic(d.topic),
        source: d.source,
        level: d.level,
        unit: d.canonical_unit ?? null,
        decimals: Number(d.decimals ?? 0),
        value: now.value,
        complete: now.complete,
        previous: prev.value,
        change_pct: now.value !== null && prev.value !== null && prev.value !== 0 ? Number((((now.value - prev.value) / Math.abs(prev.value)) * 100).toFixed(1)) : null,
        status: now.value === null ? "none" : now.complete ? "approved" : "partial",
        pending,
        series,
        target: target
          ? { id: target.id, target_year: target.target_year, target_value: target.target_value, direction: target.direction, progress_pct: target.progress.progress_pct, status: target.progress.status, achieved: target.progress.achieved, label: target.label }
          : null,
      };
    });

  // Pending, not counted yet (D14).
  const pendingKpi = yearValues.filter((v) => v.status === "pending" && inScope(v));
  const [emissions]: Row[] = siteIds.length
    ? await m.query(`SELECT COUNT(*)::int AS n FROM emission WHERE site_id = ANY($1::int[]) AND status::text = 'pending' AND date_of_reporting BETWEEN $2::date AND $3::date`, [siteIds, range.start, range.end])
    : [{ n: 0 }];

  return {
    year: q.year,
    year_type: yearType,
    label: periodsFor("annual", yearType, q.year)[0].label,
    filters: { framework: q.framework ?? null, site: scope.siteFilter, topic: q.topic ?? null },
    coverage: coverageOut,
    gaps: gapsOut,
    cards,
    pending_not_in: {
      count: pendingKpi.length,
      value_ids: pendingKpi.slice(0, 200).map((v) => v.id),
      kpi_values: pendingKpi.length,
      kpi_value_ids: pendingKpi.slice(0, 200).map((v) => v.id),
      emission_rows: Number(emissions?.n ?? 0),
      link: "/data/approvals?view=kpi",
    },
  };
}
