/**
 * IN-2 · which selected KPIs are filled from data (KPI-5 auto adapters), for
 * the ESG ring's `auto_share`. Reads the KPI services unchanged: the company's
 * definitions (`figureDefs`, the same selection /kpi/esg uses: selected and
 * active) and its approved values of the reporting year (`loadValues`, in the
 * company's KPI year type). A KPI counts when its `source` is 'auto' and it
 * has at least one approved value of the year on the scope's sites (or at
 * company level). Counts only; no figure is aggregated here.
 *
 *   autoFilledByTopic(scope, year?)  Map<topic, number of auto KPIs with an approved value>
 */
import { AppDataSource } from "../../config/data-source";
import { kpiSettings } from "../../kpi/setup/settings";
import { figureDefs } from "../../kpi/targets/service";
import { yearRange } from "../../kpi/values/period";
import { loadValues } from "../../kpi/values/yearly";
import { once, type InsightsScope } from "../scope";

export const autoFilledByTopic = (scope: InsightsScope, year: number = scope.period.year): Promise<Map<string, number>> =>
  once(scope, `kpi-auto:${year}`, async () => {
    const m = AppDataSource.manager;
    const { byId } = await figureDefs(m, scope.companyId);
    const auto = [...byId.values()].filter((d) => d.selected && d.active && d.source === "auto");
    const out = new Map<string, number>();
    if (!auto.length) return out;
    const { year_type } = await kpiSettings(m, scope.companyId);
    const range = yearRange(year_type, year);
    const values = await loadValues(m, scope.companyId, { from: range.start, to: range.end, statuses: ["approved"], kpiIds: auto.map((d) => d.id) });
    const filled = new Set(values.filter((v) => v.site_id === null || scope.siteIds.includes(v.site_id)).map((v) => v.kpi_definition_id));
    for (const d of auto) if (filled.has(d.id)) out.set(String(d.topic), (out.get(String(d.topic)) ?? 0) + 1);
    return out;
  });
