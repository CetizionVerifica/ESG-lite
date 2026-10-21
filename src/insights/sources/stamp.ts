/**
 * IN-1 · the data stamp (layer rule 7, I11): one short hash that changes
 * whenever anything a panel reads changes, so a cached panel and the browser's
 * ETag stay valid exactly as long as the data does.
 *
 * It covers, for the company and the scope's sites: emission rows (count, the
 * approved count and tCO₂e, the pending count, the latest change), production
 * rows, KPI values and targets, the setup the KPI panels read (selection,
 * frameworks, material topics and their scores), the base year, the KPI switch,
 * and `insight_event` once IN-4 has created it. Approving, rejecting, editing
 * or deleting a row moves at least one of these, so the stamp moves too.
 */
import { createHash } from "crypto";
import { AppDataSource } from "../../config/data-source";
import type { InsightsScope } from "../scope";
import { once } from "../scope";

type Row = Record<string, unknown>;

const STAMP_SQL = `
SELECT
  (SELECT concat_ws(':', COUNT(*), COUNT(*) FILTER (WHERE status = 'approved'), COUNT(*) FILTER (WHERE status = 'pending'),
                    COALESCE(SUM(total_emission) FILTER (WHERE status = 'approved'), 0), MAX(updated_at))
     FROM emission WHERE site_id = ANY($2::int[])) AS emissions,
  (SELECT concat_ws(':', COUNT(*), COUNT(*) FILTER (WHERE status = 'approved'), COALESCE(SUM(quantity) FILTER (WHERE status = 'approved'), 0), MAX(updated_at))
     FROM production_data WHERE site_id = ANY($2::int[])) AS production,
  (SELECT concat_ws(':', COUNT(*), COUNT(*) FILTER (WHERE status = 'approved'), MAX(updated_at))
     FROM kpi_value WHERE company_id = $1) AS kpi_values,
  (SELECT concat_ws(':', COUNT(*), MAX(updated_at)) FROM kpi_target WHERE company_id = $1) AS kpi_targets,
  (SELECT concat_ws(':', COUNT(*), MAX(updated_at)) FROM company_kpi WHERE company_id = $1) AS kpi_selection,
  (SELECT concat_ws(':', COUNT(*), MAX(id)) FROM company_framework WHERE company_id = $1) AS frameworks,
  (SELECT concat_ws(':', COUNT(*), MAX(decided_at), string_agg(concat(esrs_topic, material, impact_score, '/', financial_score), ',' ORDER BY esrs_topic))
     FROM company_material_topic WHERE company_id = $1) AS materiality,
  (SELECT concat_ws(':', COUNT(*), MAX(updated_at)) FROM company_base_year WHERE company_id = $1) AS base_year,
  (SELECT concat_ws(':', kpi_tracking_enabled) FROM company WHERE company_id = $1) AS company,
  to_regclass('insight_event') IS NOT NULL AS has_events`;

/** The stamp parts, before hashing (tests compare them). */
export async function stampParts(companyId: number, siteIds: number[]): Promise<Row> {
  const [row]: Row[] = await AppDataSource.query(STAMP_SQL, [companyId, siteIds]);
  const out: Row = { ...row };
  if (row.has_events) {
    // IN-4's table: events of the company (site-level or company-level) move the stamp.
    const [ev]: Row[] = await AppDataSource.query(`SELECT concat_ws(':', COUNT(*), MAX(updated_at)) AS events FROM insight_event WHERE company_id = $1`, [companyId]);
    out.events = ev.events;
  }
  delete out.has_events;
  return out;
}

export const hashStamp = (parts: Row, salt: string): string =>
  createHash("sha1").update(salt).update(JSON.stringify(parts)).digest("hex").slice(0, 16);

/**
 * The scope's data stamp (memoised for the request). Today's UTC date is in the
 * salt: expected progress and "this month" move with the calendar, not the data.
 */
export const dataStamp = (scope: InsightsScope, today = new Date().toISOString().slice(0, 10)): Promise<string> =>
  once(scope, "stamp", async () => hashStamp(await stampParts(scope.companyId, scope.siteIds), `${scope.companyId}|${scope.siteIds.join(",")}|${scope.kpiOn}|${today}`));
