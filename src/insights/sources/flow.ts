/**
 * IN-6 · what the disclosure flow reads (no new figures here; derive/flow.ts builds the graph).
 *
 *   scopesBySite(scope)   each site's approved Scope 1/2/3 for the period: GET /manager/overview's
 *                         kpis for that one site (`computeManagerOverview`; Overview's by_site has
 *                         gross/net only, so it runs once per site, cached with the panel)
 *   flowKpis(scope)       the company's selected KPIs that column 2 shows: GHG KPIs whose
 *                         auto_source is ghg_scope1 / ghg_scope2_location / ghg_scope3_total (and
 *                         the Scope 3 category KPIs when no Scope 3 total KPI is selected), with
 *                         their approved figure for the year (values/yearly.ts `figureOf`, as
 *                         /kpi/esg); plus count-only nodes: other auto or formula KPIs of the
 *                         climate and energy topics (energy, intensity, market-based Scope 2)
 *   flowMappings(scope, codes)  kpi_disclosure_map rows of the company's enabled framework
 *                         versions for those KPIs (KPI → disclosure, with fit)
 * Approved values only. A company-level GHG KPI while only some sites are read has no
 * comparable figure: value null (the node stays, without tonnes).
 */
import { AppDataSource } from "../../config/data-source";
import { kpiSettings } from "../../kpi/setup/settings";
import { figureDefs } from "../../kpi/targets/service";
import { yearRange } from "../../kpi/values/period";
import { figureOf, loadValues } from "../../kpi/values/yearly";
import { computeManagerOverview, parseOverviewPeriod } from "../../services/managerOverview.service";
import { once, overviewKey, type InsightsScope } from "../scope";

type Row = Record<string, any>;

export const scopesBySite = (scope: InsightsScope) =>
  once(scope, `flow-sites:${overviewKey(scope.period)}`, async () => {
    const period = parseOverviewPeriod(overviewKey(scope.period))!;
    const out: Array<{ site_id: number; name: string; scope_1: number; scope_2: number; scope_3: number }> = [];
    for (const id of scope.siteIds) {
      const k = (await computeManagerOverview({ period, siteIds: [id], managed: scope.siteNames, categoryIds: [] })).kpis;
      out.push({ site_id: id, name: scope.siteNames.get(id) ?? `Site ${id}`, scope_1: k.scope_1, scope_2: k.scope_2, scope_3: k.scope_3 });
    }
    return out;
  });

/** auto_source → the scope its tonnes come from (location-based Scope 2 only, I9). */
export const GHG_TONNES_SOURCES: Record<string, 1 | 2 | 3> = { ghg_scope1: 1, ghg_scope2_location: 2, ghg_scope3_total: 3 };
const SCOPE3_CATEGORY = /^ghg_scope3_category_\d+$/;
const COUNT_ONLY_TOPICS = new Set(["climate", "energy"]);

export interface FlowKpi {
  id: number;
  code: string;
  name: string;
  scope: 1 | 2 | 3 | null;
  value: number | null;
}

export const flowKpis = (scope: InsightsScope): Promise<FlowKpi[]> =>
  once(scope, "flow-kpis", async () => {
    const m = AppDataSource.manager;
    const { byId, byCode } = await figureDefs(m, scope.companyId);
    const selected = [...byId.values()].filter((d) => d.selected && d.active);
    const hasS3Total = selected.some((d) => d.auto_source === "ghg_scope3_total");
    const picked = selected.filter((d) => {
      const src = String(d.auto_source ?? "");
      if (d.source === "auto" && src in GHG_TONNES_SOURCES) return true;
      if (d.source === "auto" && SCOPE3_CATEGORY.test(src)) return !hasS3Total;
      return (d.source === "auto" || d.source === "formula") && COUNT_ONLY_TOPICS.has(String(d.topic));
    });
    if (!picked.length) return [];
    const yearType = (await kpiSettings(m, scope.companyId)).year_type;
    const range = yearRange(yearType, scope.period.year);
    const values = (await loadValues(m, scope.companyId, { from: range.start, to: range.end, statuses: ["approved"] })).filter(
      (v) => v.site_id === null || scope.siteIds.includes(v.site_id),
    );
    const partial = !(scope.caller.allSites && scope.siteIds.length === scope.caller.siteIds.length);
    return picked
      .map((d) => {
        const src = String(d.auto_source ?? "");
        const s: 1 | 2 | 3 | null = d.source === "auto" ? (GHG_TONNES_SOURCES[src] ?? (SCOPE3_CATEGORY.test(src) ? 3 : null)) : null;
        let value: number | null = null;
        if (s !== null && !(d.level === "company" && partial)) value = figureOf(d as never, values, byCode, { year: scope.period.year, yearType, sites: scope.siteIds }).value;
        return { id: Number(d.id), code: String(d.code), name: String(d.name), scope: s, value };
      })
      .sort((a, b) => (a.scope ?? 9) - (b.scope ?? 9) || a.code.localeCompare(b.code));
  });

export interface FlowMapping {
  kpi: string;
  framework: string;
  code: string;
  title: string;
  fit: "exact" | "partial" | "derived";
}

export const flowMappings = (scope: InsightsScope, kpiIds: number[]): Promise<FlowMapping[]> =>
  once(scope, `flow-maps:${kpiIds.join(",")}`, async () => {
    if (!kpiIds.length) return [];
    const rows: Row[] = await AppDataSource.query(
      `SELECT kd.code AS kpi, f.code AS framework, d.code, d.title, m.fit
         FROM kpi_disclosure_map m
         JOIN kpi_disclosure d ON d.id = m.disclosure_id
         JOIN kpi_framework f ON f.id = d.framework_id
         JOIN company_framework cf ON cf.framework_id = f.id AND cf.company_id = $1
         JOIN kpi_definition kd ON kd.id = m.kpi_definition_id AND (kd.company_id IS NULL OR kd.company_id = $1)
        WHERE m.kpi_definition_id = ANY($2::int[])
        ORDER BY CASE f.code WHEN 'GRI' THEN 1 WHEN 'BRSR' THEN 2 WHEN 'ESRS' THEN 3 ELSE 4 END, d.sort_key, d.code, kd.code`,
      [scope.companyId, kpiIds],
    );
    return rows.map((r) => ({ kpi: String(r.kpi), framework: String(r.framework), code: String(r.code), title: String(r.title), fit: r.fit }));
  });
