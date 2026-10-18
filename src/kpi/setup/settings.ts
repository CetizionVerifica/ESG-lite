/**
 * KPI-3 · reads of a company's setup that the rest of src/kpi uses (values,
 * auto, formulas, my KPIs). No writes here; `service.ts` owns them.
 *
 *   kpiSettings(m, company)         settings, with defaults when setup hasn't started
 *   setupCompleted(m, company)      setup_completed_at is set
 *   companyKpiRow(m, company, kpi)  the company_kpi row (selected, frequency) or null
 *   enabledFrameworks(m, company)   framework versions the company reports on
 *   (owners: setup/owners.ts resolveOwner, D17; kpi_topic_grant is no longer read)
 *   userSiteIds(m, user)            sites a user belongs to (user.site and user_sites)
 */
import type { EntityManager } from "typeorm";
import type { KpiFrequency, YearType } from "../contracts/enums";
import { DEFAULT_DUE_DAY, reportingYearOf } from "../values/period";

type Row = Record<string, any>;

export interface KpiSettings {
  company_id: number;
  year_type: YearType;
  first_year: number;
  due_day: number;
  setup_completed_at: Date | null;
  /** False until the first PUT /kpi/setup stores a row. */
  stored: boolean;
}

/** The year type most of the company's emission rows use, else CY ("prefilled", 05-ux S2). */
export async function inferredYearType(m: EntityManager, companyId: number): Promise<YearType> {
  const rows: Row[] = await m.query(
    `SELECT e.year_type, COUNT(*)::int AS n FROM emission e JOIN site s ON s.site_id = e.site_id
      WHERE s.company_id = $1 AND e.year_type IN ('CY', 'FY') GROUP BY e.year_type ORDER BY n DESC, e.year_type LIMIT 1`,
    [companyId],
  );
  return rows[0]?.year_type === "FY" ? "FY" : "CY";
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export async function kpiSettings(m: EntityManager, companyId: number): Promise<KpiSettings> {
  const rows: Row[] = await m.query(`SELECT * FROM company_kpi_settings WHERE company_id = $1`, [companyId]);
  if (rows.length) {
    const r = rows[0];
    return { company_id: companyId, year_type: r.year_type === "FY" ? "FY" : "CY", first_year: Number(r.first_year), due_day: Number(r.due_day), setup_completed_at: r.setup_completed_at ?? null, stored: true };
  }
  const yearType = await inferredYearType(m, companyId);
  return { company_id: companyId, year_type: yearType, first_year: reportingYearOf(todayIso(), yearType), due_day: DEFAULT_DUE_DAY, setup_completed_at: null, stored: false };
}

export async function setupCompleted(m: EntityManager, companyId: number): Promise<boolean> {
  const rows: Row[] = await m.query(`SELECT 1 FROM company_kpi_settings WHERE company_id = $1 AND setup_completed_at IS NOT NULL`, [companyId]);
  return rows.length > 0;
}

export async function companyKpiRow(m: EntityManager, companyId: number, kpiId: number): Promise<{ selected: boolean; frequency: KpiFrequency | null; reason_excluded: string | null } | null> {
  const rows: Row[] = await m.query(`SELECT selected, frequency, reason_excluded FROM company_kpi WHERE company_id = $1 AND kpi_definition_id = $2`, [companyId, kpiId]);
  return rows.length ? { selected: rows[0].selected === true, frequency: (rows[0].frequency ?? null) as KpiFrequency | null, reason_excluded: rows[0].reason_excluded ?? null } : null;
}

export async function enabledFrameworks(m: EntityManager, companyId: number): Promise<Row[]> {
  return m.query(
    `SELECT cf.framework_id, f.code, f.version, f.name, cf.enabled_at, cf.enabled_by
       FROM company_framework cf JOIN kpi_framework f ON f.id = cf.framework_id
      WHERE cf.company_id = $1 ORDER BY CASE f.code WHEN 'GRI' THEN 1 WHEN 'BRSR' THEN 2 WHEN 'ESRS' THEN 3 ELSE 4 END, f.version`,
    [companyId],
  );
}

/** The sites a user belongs to: `user.site_id` and `user_sites`. */
export async function userSiteIds(m: EntityManager, userId: number): Promise<Set<number>> {
  const rows: Row[] = await m.query(
    `SELECT site_id FROM "user" WHERE user_id = $1 AND site_id IS NOT NULL
     UNION SELECT site_id FROM user_sites WHERE user_id = $1`,
    [userId],
  );
  return new Set(rows.map((r) => Number(r.site_id)));
}
