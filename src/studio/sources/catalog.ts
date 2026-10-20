/**
 * DS-2 · the Data drawer list (05-ux "Data" panel): what a design of this kind
 * can link to, each item with a ready binding and its resolved value and
 * approval date, from the same resolver as the page.
 *
 *   GHG:            Scopes (total, 1, 2 location, 2 market, 3), Scope 3 categories 1–15
 *                   (with values or "Excluded: …"), sites, months, gases and biogenic
 *                   CO₂, intensity, base year, data quality and coverage
 *   sustainability: the company's selected KPIs, filtered by `q` (code or name),
 *                   `topic` and `framework` (KPIs mapped to that framework)
 */
import { AppDataSource } from "../../config/data-source";
import { GHG_CATEGORIES } from "../../scope3/contracts/ghgCategory";
import type { Binding, GhgBinding, GhgMetric, KpiBinding } from "../contracts";
import { METRIC_LABELS } from "./ghg";
import { resolveBinding, type Loaders } from "./resolve";
import type { ResolveContext, ResolvedBinding } from "./types";

type Row = Record<string, any>;

export interface DataItem {
  id: string;
  label: string;
  binding: Binding;
  resolved: Pick<ResolvedBinding, "display" | "value" | "unit" | "approvedAt" | "unavailable" | "series" | "complete">;
}
export interface DataGroup {
  id: string;
  label: string;
  items: DataItem[];
}

const ghg = (metric: GhgMetric, extra: Partial<GhgBinding> = {}): GhgBinding => ({ source: "ghg", metric, years: { last: 1 }, sites: "all", ...extra }) as GhgBinding;

async function item(L: Loaders, ctx: ResolveContext, id: string, label: string, binding: Binding): Promise<DataItem> {
  const r = await resolveBinding(L, ctx, binding, 0);
  return {
    id,
    label,
    binding,
    resolved: { display: r.display, value: r.value, unit: r.unit, approvedAt: r.approvedAt ?? null, ...(r.unavailable ? { unavailable: r.unavailable } : {}), ...(r.series ? { series: r.series } : {}), ...(r.complete !== undefined ? { complete: r.complete } : {}) },
  };
}

export async function ghgCatalog(L: Loaders, ctx: ResolveContext): Promise<DataGroup[]> {
  const groups: DataGroup[] = [];
  const metrics = async (id: string, label: string, list: GhgMetric[]) => {
    const items = [];
    for (const m of list) items.push(await item(L, ctx, m, METRIC_LABELS[m], ghg(m)));
    groups.push({ id, label, items });
  };
  await metrics("scopes", "Scopes", ["total", "scope1", "scope2_location", "scope2_market", "scope3"]);

  const cats = [];
  for (const c of GHG_CATEGORIES) cats.push(await item(L, ctx, `scope3_category_${c.n}`, `${c.n} · ${c.name}`, ghg("scope3_category", { scope3Category: c.n })));
  groups.push({ id: "scope3_categories", label: "Scope 3 categories", items: cats });

  groups.push({
    id: "breakdowns",
    label: "Sites, months and sources",
    items: [
      await item(L, ctx, "by_site", "Total by site", ghg("total", { breakdown: "site" })),
      await item(L, ctx, "by_month", "Total by month", ghg("total", { breakdown: "month" })),
      await item(L, ctx, "by_scope", "Total by scope", ghg("total", { breakdown: "scope" })),
      await item(L, ctx, "scope1_by_fuel", "Scope 1 by fuel", ghg("scope1", { breakdown: "fuel" })),
      await item(L, ctx, "scope3_by_category", "Scope 3 by category", ghg("scope3", { breakdown: "scope3_category" })),
    ],
  });
  await metrics("gases", "Gases", ["gas_co2", "gas_ch4", "gas_n2o", "gas_other", "biogenic_co2"]);
  await metrics("intensity", "Intensity", ["intensity_revenue", "intensity_output", "intensity_employee"]);
  await metrics("base_year", "Base year and quality", ["base_year_total", "dq_score", "primary_data_pct", "sites_covered", "months_covered"]);
  return groups;
}

export async function kpiCatalog(L: Loaders, ctx: ResolveContext, q: { q?: string; topic?: string; framework?: string }): Promise<DataGroup[]> {
  const params: unknown[] = [ctx.companyId];
  let where = "";
  if (q.q) {
    params.push(`%${q.q.toLowerCase()}%`);
    where += ` AND (lower(d.code) LIKE $${params.length} OR lower(d.name) LIKE $${params.length})`;
  }
  if (q.topic) {
    params.push(q.topic);
    where += ` AND d.topic = $${params.length}`;
  }
  if (q.framework) {
    params.push(q.framework.toUpperCase());
    where += ` AND EXISTS (SELECT 1 FROM kpi_disclosure_map mp JOIN kpi_disclosure ds ON ds.id = mp.disclosure_id JOIN kpi_framework f ON f.id = ds.framework_id
                           WHERE mp.kpi_definition_id = d.id AND f.code = $${params.length})`;
  }
  const rows: Row[] = await AppDataSource.query(
    `SELECT d.code, d.name, d.topic FROM kpi_definition d JOIN company_kpi ck ON ck.kpi_definition_id = d.id AND ck.company_id = $1
      WHERE ck.selected AND d.active AND (d.company_id IS NULL OR d.company_id = $1) ${where}
      ORDER BY d.topic, d.name LIMIT 60`,
    params,
  );
  const byTopic = new Map<string, DataItem[]>();
  for (const r of rows) {
    const binding: KpiBinding = { source: "kpi", kpis: [String(r.code)], years: { last: 1 }, sites: "all" };
    const it = await item(L, ctx, String(r.code), String(r.name), binding);
    byTopic.set(String(r.topic), [...(byTopic.get(String(r.topic)) ?? []), it]);
  }
  return [...byTopic.entries()].map(([topic, items]) => ({ id: topic, label: topic.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), items }));
}
