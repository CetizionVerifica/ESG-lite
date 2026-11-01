/**
 * Keeps a yearly Scope 3 plan from counting a year twice. emissionWrite flags
 * DUPLICATE_EXISTING for monthly rows only, so a planner that builds yearly
 * rows (sold products, commuting survey, investments) must itself leave out
 * the rows already saved for the year and replace its own older drafts.
 */
import { AppDataSource } from "../config/data-source";
import type { ImportRow } from "../imports/contracts";
import type { StoredPeriod } from "../services/emissionWrite/period";
import type { CalculationSpec } from "../entities/ColumnConfig";
import { specIdentityMatches } from "../services/calculationSpec";

/** The activity_data of the rows saved for the period on a site × category (any status). */
export async function savedYearRows(site_id: number, category_id: number, period: StoredPeriod): Promise<Array<Record<string, unknown>>> {
  const saved: Array<{ activity_data: Record<string, unknown> | null }> = await AppDataSource.query(
    `SELECT activity_data FROM emission WHERE site_id = $1 AND category_id = $2 AND reporting_period = 'yearly' AND date_of_reporting = $3`,
    [site_id, category_id, period.date_of_reporting],
  );
  return saved.map((e) => e.activity_data ?? {});
}

/**
 * The year's saved rows on the site's standard form, as a test for plan rows:
 * same activity (the form's mapping of the row's label chain) and same identity
 * (the form's identity columns). Any status counts, as emissionWrite's monthly
 * duplicate check.
 */
export async function importedRows(site_id: number, category_id: number, period: StoredPeriod): Promise<(row: ImportRow) => boolean> {
  const saved = await savedYearRows(site_id, category_id, period);
  if (!saved.length) return () => false;
  const [config]: Array<{ emission_category_mapping: Record<string, string> | null; calculation: CalculationSpec | null }> = await AppDataSource.query(
    `SELECT emission_category_mapping, calculation FROM column_config WHERE site_id = $1 AND category_id = $2 ORDER BY config_name LIMIT 1`,
    [site_id, category_id],
  );
  const mapping = config?.emission_category_mapping ?? {};
  const spec = config?.calculation ?? null;
  return (row) => {
    const data = { ...row.fields, emission_category: mapping[row.activity_name ?? ""] ?? row.activity_name };
    return saved.some((e) => e.emission_category === data.emission_category && (!spec || specIdentityMatches(spec, data, e)));
  };
}

/**
 * Cancels the open draft plans with this source name for the same site and
 * category, other than `keep`, so only one can be imported: two drafts would
 * both pass the saved-rows check and count the year twice. With `keep`, only
 * drafts older than it go, so two overlapping calls can't cancel each other
 * (the newest plan stays). A plan being committed holds its row lock, so this
 * waits for that commit and the saved-rows check that follows sees its rows.
 * Returns the number cancelled.
 */
export async function cancelOtherDrafts(companyId: number, sourceName: string, site_id: number, category_id: number, keep: string | null): Promise<number> {
  // WHERE kept on the UPDATE line for the data-safety check.
  const [, n]: [unknown, number] = await AppDataSource.query(
    `UPDATE import_plan p SET status = 'cancelled', version = p.version + 1, updated_at = now() WHERE p.status = 'draft' AND p.company_id = $1 AND p.source_name = $2 AND p.plan_id::text IS DISTINCT FROM $5 AND ($5::text IS NULL OR p.created_at < (SELECT k.created_at FROM import_plan k WHERE k.plan_id::text = $5)) AND EXISTS (SELECT 1 FROM import_plan_row r WHERE r.plan_id = p.plan_id AND (r.input->>'site_id')::int = $3 AND (r.input->>'category_id')::int = $4)`,
    [companyId, sourceName, site_id, category_id, keep],
  );
  return Number(n) || 0;
}
