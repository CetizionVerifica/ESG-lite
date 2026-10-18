/**
 * D19 (wave E) · GET /kpi/esg?year=&site=&pillar=&topic= — the ESG dashboard
 * (docs/kpi/wave-e.md). Manager (their sites), Admin, Superadmin (company_id);
 * a User → 403 KPI_FORBIDDEN; 409 KPI_SETUP_INCOMPLETE before setup; a site
 * outside the caller's scope → 404 (KPI-10's `dashboardScope`).
 *
 *   pillars          E, S and G, always all three (so the cards stay clickable): selected KPIs
 *                    by state (approved | pending | missing | not_due, KPI-10's rule and D17's
 *                    expected sites), coverage_pct = approved / (approved + pending + missing),
 *                    the change on last year in percentage points, and the same per topic
 *   trends           the headline KPIs per pillar (headlines.ts), at most 4 per pillar, each
 *                    with its series (the year's months or quarters; annual KPIs: the last 5
 *                    years), year figure, last year's, % change and the target's progress
 *   sites            per site in scope: coverage % per pillar of its site-level KPIs
 *                    (null when nothing is counted there)
 *   movers           the 5 largest year-on-year changes of selected numeric KPIs, with
 *                    whether the change is good (headlines.ts DIRECTION_GOOD)
 *   pending_not_in   values of the year waiting for review: not in these figures (D14)
 *
 * Figures read approved values only, through values/yearly.ts as the KPI-10
 * cards do; GHG figures are the approved Scope 1 and 2 values KPI-5 wrote from
 * the GHG report's functions. Nothing here computes an emission total.
 * `site` narrows to one site and drops company-level KPIs (as KPI-10 cards);
 * `topic` narrows everything to that topic; `pillar` narrows trends, movers
 * and pending_not_in (pillars and sites keep all three pillars).
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { KPI_PILLARS, KPI_TOPICS, NUMERIC_VALUE_TYPES, pillarOfTopic, type KpiPillar, type YearType } from "../contracts/enums";
import { PILLAR_LABELS, TOPIC_LABELS } from "../contracts/labels";
import { KpiEsgQuerySchema } from "../contracts/schemas";
import type { KpiCaller } from "../guard";
import { parse } from "../http";
import { dashboardScope } from "../dashboard/service";
import type { KpiState } from "../dashboard/coverage";
import { expectedSites } from "../review/lock";
import { ownerIndex } from "../setup/owners";
import { todayIso } from "../setup/settings";
import { figureDefs, targetsWithProgress } from "../targets/service";
import { periodsFor, yearRange, type KpiPeriod } from "../values/period";
import { combine, figureOf, loadValues, type FigureDef, type StoredValue } from "../values/yearly";
import { directionGood, HEADLINES, HEADLINES_PER_PILLAR, isGood, type DirectionGood, type Headline } from "./headlines";

type Row = Record<string, any>;
type Def = Row & FigureDef & { code: string };

export const ANNUAL_SERIES_YEARS = 5;
export const MOVERS = 5;

interface Counts {
  kpis: number;
  approved: number;
  pending: number;
  missing: number;
  not_due: number;
}
const zero = (): Counts => ({ kpis: 0, approved: 0, pending: 0, missing: 0, not_due: 0 });
const add = (c: Counts, s: KpiState) => {
  c.kpis++;
  c[s]++;
};
/** approved / (approved + pending + missing), rounded; null when nothing is counted. */
export const coveragePct = (c: Pick<Counts, "approved" | "pending" | "missing">): number | null => {
  const counted = c.approved + c.pending + c.missing;
  return counted ? Math.round((c.approved / counted) * 100) : null;
};
const changePct = (now: number | null, prev: number | null): number | null =>
  now !== null && prev !== null && prev !== 0 ? Number((((now - prev) / Math.abs(prev)) * 100).toFixed(1)) : null;
const tidy = (n: number) => Number(n.toPrecision(12));
/** The sum of the numbers that exist; null when none does (missing is never 0). */
const sumKnown = (nums: Array<number | null>): number | null => {
  const known = nums.filter((n): n is number => n !== null);
  return known.length ? tidy(known.reduce((a, b) => a + b, 0)) : null;
};

/** A KPI's state for one year, overall and per site (site-level KPIs), by KPI-10's rule. */
function statesOf(
  d: Def,
  ctx: { year: number; yearType: YearType; today: string; siteIds: number[]; assignments: Row[]; values: StoredValue[] },
): { overall: KpiState; bySite: Map<number, KpiState> } {
  const bySite = new Map<number, KpiState>();
  const periods = periodsFor(d.frequency, ctx.yearType, ctx.year);
  const due = periods.filter((p) => p.end < ctx.today);
  const starts = new Set(periods.map((p) => p.start));
  const mine = ctx.values.filter((v) => v.kpi_definition_id === d.id && v.frequency === d.frequency && starts.has(v.period_start));
  if (d.source !== "manual") {
    const stateFor = (vals: StoredValue[]): KpiState => (!vals.length ? (due.length ? "missing" : "not_due") : vals.some((v) => v.status === "pending") ? "pending" : "approved");
    const inScope = mine.filter((v) => (d.level === "company" ? v.site_id === null : v.site_id !== null && ctx.siteIds.includes(v.site_id)));
    if (d.level === "site") for (const s of ctx.siteIds) bySite.set(s, stateFor(inScope.filter((v) => v.site_id === s)));
    return { overall: stateFor(inScope), bySite };
  }
  const targets: Array<number | null> = d.level === "company" ? [null] : expectedSites(d.id, ctx.siteIds, ctx.assignments);
  if (!due.length || !targets.length) {
    for (const t of targets) if (t !== null) bySite.set(t, "not_due");
    return { overall: "not_due", bySite };
  }
  const byKey = new Map(mine.map((v) => [`${v.site_id ?? ""}|${v.period_start}`, v]));
  let anyMissing = false;
  let anyPending = false;
  for (const t of targets) {
    let missing = false;
    let pending = false;
    for (const p of due) {
      const v = byKey.get(`${t ?? ""}|${p.start}`);
      if (v?.status === "pending") pending = true;
      if (!v || (v.status !== "pending" && v.status !== "approved")) missing = true;
    }
    anyMissing ||= missing;
    anyPending ||= pending;
    if (t !== null) bySite.set(t, missing ? "missing" : pending ? "pending" : "approved");
  }
  return { overall: anyMissing ? "missing" : anyPending ? "pending" : "approved", bySite };
}

/** The reporting year an annual period belongs to: the year it ends in (CY 2025 ends Dec 2025; FY 2026 ends Mar 2026). */
const reportingYear = (p: KpiPeriod): number => Number(p.end.slice(0, 4));

/** The series' periods: the year's months or quarters; for an annual KPI the last 5 years. */
function seriesPeriods(frequency: string, yearType: YearType, year: number): KpiPeriod[] {
  if (frequency === "annual") {
    const out: KpiPeriod[] = [];
    for (let y = year - ANNUAL_SERIES_YEARS + 1; y <= year; y++) out.push(periodsFor("annual", yearType, y)[0]);
    return out;
  }
  return periodsFor(frequency as "monthly" | "quarterly", yearType, year);
}

export async function esg(caller: KpiCaller, query: unknown) {
  const q = parse(KpiEsgQuerySchema, query ?? {});
  const m: EntityManager = AppDataSource.manager;
  const scope = await dashboardScope(m, caller, q.site);
  const { yearType } = scope;
  const siteIds = scope.sites.map((s) => s.site_id);
  const today = todayIso();
  const range = yearRange(yearType, q.year);

  const { byId, byCode } = await figureDefs(m, caller.companyId);
  const pillarOf = (d: Row): KpiPillar => (d.pillar ?? pillarOfTopic(String(d.topic)) ?? "governance") as KpiPillar;
  const topicOk = (d: Row) => !q.topic || d.topic === q.topic;
  const pillarOk = (d: Row) => !q.pillar || pillarOf(d) === q.pillar;
  // Selected KPIs in scope: a site filter drops company-level KPIs (as the KPI-10 cards).
  const selected = ([...byId.values()] as Def[])
    .filter((d) => d.selected && d.active && topicOk(d) && (scope.siteFilter === null || d.level === "site"))
    .sort((a, b) => KPI_TOPICS.indexOf(a.topic) - KPI_TOPICS.indexOf(b.topic) || String(a.code).localeCompare(String(b.code)));

  const owners = await ownerIndex(m, caller.companyId);
  const allSites: number[] = (await m.query(`SELECT site_id FROM site WHERE company_id = $1`, [caller.companyId])).map((r: Row) => Number(r.site_id));
  const assignments = owners.ownedPairs(selected.filter((d) => d.source === "manual").map((d) => ({ id: d.id, topic: String(d.topic), level: d.level })), allSites);

  // Every status for this year and last (states), approved ones back to the first series year (figures).
  const inScope = (v: StoredValue) => v.site_id === null || siteIds.includes(v.site_id);
  const allValues = (await loadValues(m, caller.companyId, { from: yearRange(yearType, q.year - 1).start, to: range.end, statuses: ["draft", "pending", "approved", "rejected"] })).filter(inScope);
  const approved = (await loadValues(m, caller.companyId, { from: yearRange(yearType, q.year - ANNUAL_SERIES_YEARS).start, to: range.end, statuses: ["approved"] })).filter(inScope);

  // ── Pillars and topics ──
  const ctx = (year: number) => ({ year, yearType, today, siteIds, assignments, values: allValues });
  const now = new Map(selected.map((d) => [d.id, statesOf(d, ctx(q.year))]));
  const last = new Map(selected.map((d) => [d.id, statesOf(d, ctx(q.year - 1)).overall]));
  const pillars = KPI_PILLARS.map((pillar) => {
    const defs = selected.filter((d) => pillarOf(d) === pillar);
    const c = zero();
    const prev = zero();
    for (const d of defs) {
      add(c, now.get(d.id)!.overall);
      add(prev, last.get(d.id)!);
    }
    const pct = coveragePct(c);
    const prevPct = coveragePct(prev);
    const topics = KPI_TOPICS.filter((t) => defs.some((d) => d.topic === t)).map((topic) => {
      const tc = zero();
      for (const d of defs.filter((x) => x.topic === topic)) add(tc, now.get(d.id)!.overall);
      return { topic, label: TOPIC_LABELS[topic], kpis: tc.kpis, approved: tc.approved, pending: tc.pending, missing: tc.missing, coverage_pct: coveragePct(tc) };
    });
    return {
      pillar,
      label: PILLAR_LABELS[pillar],
      ...c,
      coverage_pct: pct,
      change: { approved_pct_vs_last_year: pct !== null && prevPct !== null ? pct - prevPct : null },
      topics,
    };
  });

  // ── Sites × pillars ──
  const sites = scope.sites.map((s) => {
    const out = {} as Record<KpiPillar, number | null>;
    for (const pillar of KPI_PILLARS) {
      const c = zero();
      for (const d of selected.filter((x) => x.level === "site" && pillarOf(x) === pillar)) {
        const st = now.get(d.id)!.bySite.get(s.site_id);
        if (st) add(c, st);
      }
      out[pillar] = coveragePct(c);
    }
    return { site_id: s.site_id, name: s.name, pillars: out };
  });

  // ── Figures (approved only) ──
  const figureOpts = (year: number) => ({ year, yearType, sites: siteIds, ...(scope.siteFilter !== null ? { site: scope.siteFilter } : {}) });
  const yearValue = (d: Def, year: number) => figureOf(d, approved, byCode, figureOpts(year)).value;
  const pointValue = (d: Def, p: KpiPeriod): number | null => {
    if (p.frequency === "annual") return yearValue(d, reportingYear(p));
    const at = approved.filter((v) => v.kpi_definition_id === d.id && v.period_start === p.start && v.frequency === p.frequency);
    const pick = d.level === "company" ? at.filter((v) => v.site_id === null) : at.filter((v) => v.site_id !== null && (scope.siteFilter === null || v.site_id === scope.siteFilter));
    return pick.length ? combine(pick.map((v) => v.value), d.aggregation) : null;
  };
  const targets = await targetsWithProgress(m, caller, {});
  const targetOf = (d: Def) =>
    targets
      .filter((t) => t.kpi_definition_id === d.id && t.site_id === (d.level === "site" ? scope.siteFilter : null))
      .sort((a, b) => (a.target_year >= q.year ? 0 : 1) - (b.target_year >= q.year ? 0 : 1) || a.target_year - b.target_year)[0] ?? null;

  // ── Headline trends ──
  const numeric = (d: Def) => NUMERIC_VALUE_TYPES.includes(d.value_type as never);
  const selectedByCode = new Map(selected.filter(numeric).map((d) => [String(d.code), d]));
  const trendOf = (h: Headline, pillar: KpiPillar, parts: Def[]) => {
    const single = parts.length === 1;
    const first = parts[0];
    // Parts at different frequencies read as yearly figures.
    const frequency = parts.every((p) => p.frequency === first.frequency) ? first.frequency : "annual";
    const series = seriesPeriods(frequency, yearType, q.year).map((p) => ({
      period: p.label,
      period_start: p.start,
      label: p.label,
      value: sumKnown(parts.map((d) => pointValue(d, p))),
    }));
    const value = sumKnown(parts.map((d) => yearValue(d, q.year)));
    const previous = sumKnown(parts.map((d) => yearValue(d, q.year - 1)));
    const target = single ? targetOf(first) : null;
    return {
      pillar,
      topic: single ? first.topic : h.topic,
      kpi_definition_id: first.id,
      code: single ? first.code : h.code,
      name: single ? first.name : h.name ?? first.name,
      unit: first.canonical_unit ?? null,
      decimals: Math.max(...parts.map((d) => Number(d.decimals ?? 0))),
      direction_good: h.direction_good,
      series,
      value,
      previous,
      change_pct: changePct(value, previous),
      target: target ? { progress_pct: target.progress.progress_pct, status: target.progress.status, label: target.label } : null,
    };
  };
  const trends = [];
  for (const pillar of KPI_PILLARS.filter((p) => !q.pillar || p === q.pillar)) {
    let n = 0;
    for (const h of HEADLINES) {
      if (n >= HEADLINES_PER_PILLAR) break;
      const parts = h.parts.map((c) => selectedByCode.get(c)).filter((d): d is Def => !!d && pillarOf(d) === pillar);
      if (!parts.length || parts.some((d) => d.canonical_unit !== parts[0].canonical_unit)) continue;
      trends.push(trendOf(h, pillar, parts));
      n++;
    }
  }

  // ── Biggest movers ──
  const movers = selected
    .filter((d) => numeric(d) && pillarOk(d))
    .map((d) => {
      const change = changePct(yearValue(d, q.year), yearValue(d, q.year - 1));
      const t = targets.find((x) => x.kpi_definition_id === d.id);
      const direction: DirectionGood = directionGood(String(d.code), t?.direction ?? null);
      return { kpi_definition_id: d.id, name: d.name, pillar: pillarOf(d), change_pct: change, direction_good: direction, good: change === null ? false : isGood(direction, change), code: String(d.code) };
    })
    .filter((x) => x.change_pct !== null)
    .sort((a, b) => Math.abs(b.change_pct as number) - Math.abs(a.change_pct as number) || a.code.localeCompare(b.code))
    .slice(0, MOVERS)
    .map(({ code: _code, ...rest }) => rest);

  // ── Pending, not counted yet (D14) ──
  const inFilter = new Set(selected.filter(pillarOk).map((d) => d.id));
  const pending = allValues.filter(
    (v) => v.status === "pending" && inFilter.has(v.kpi_definition_id) && v.period_start >= range.start && (scope.siteFilter === null || v.site_id === scope.siteFilter),
  );

  return {
    year: q.year,
    year_type: yearType,
    label: periodsFor("annual", yearType, q.year)[0].label,
    filters: { site: scope.siteFilter, pillar: q.pillar ?? null, topic: q.topic ?? null },
    pillars,
    trends,
    sites,
    movers,
    pending_not_in: { count: pending.length, link: "/data/approvals?view=kpi" },
  };
}
