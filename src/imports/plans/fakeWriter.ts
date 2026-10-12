import { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { Emission, EmissionStatus } from "../../entities/Emission";
import { ActivityMatch, ImportRow, PlannedRow, RowIssue } from "../contracts";
import { EmissionWriter, WriterContext } from "../writer";

/**
 * A stand-in EmissionWriter for IM2 part 1 (tests and local development).
 * IM1 replaces it in part 2. It is never used in production: see
 * writerRegistry.ts.
 *
 * What it does, so tests can rely on it:
 *  - scope checks: SITE_NOT_ALLOWED, CATEGORY_NOT_ASSIGNED (from the context);
 *  - value checks: MISSING_VALUE, NON_POSITIVE_VALUE;
 *  - period checks: PERIOD_INVALID for a bad date or a future month;
 *  - activity: a plan match wins (matched_by "plan_match"); a name containing
 *    "unknown" is UNKNOWN_ACTIVITY; anything else resolves to a factor of the
 *    same name worth 1 kgCO2e per unit, so total_tco2e = value / 1000;
 *  - DUPLICATE_IN_PLAN warning on the second row with the same site,
 *    category, month and activity; DUPLICATE_EXISTING when a saved emission
 *    row already has that site, category, month and activity_name (so the
 *    re-check at commit can catch a row typed after planning);
 *  - insertRows writes plain pending emission rows with those totals, and
 *    throws when a row's notes are "__FAIL_INSERT__" (MCP-24).
 */

export const FAKE_FAIL_NOTES = "__FAIL_INSERT__";

const pad = (n: number) => String(n).padStart(2, "0");

const resolvePeriod = (row: ImportRow): { date: string; period: "monthly" | "yearly"; year_type?: "CY" | "FY" } | RowIssue => {
  if (row.period.kind === "yearly") {
    const date = row.period.year_type === "CY" ? `${row.period.year}-12-31` : `${row.period.year}-03-31`;
    return { date, period: "yearly", year_type: row.period.year_type };
  }
  const d = new Date(`${row.period.date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== row.period.date) {
    return { code: "PERIOD_INVALID", severity: "error", message: `"${row.period.date}" is not a valid date`, field: "period" };
  }
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
  if (row.period.date.slice(0, 7) > thisMonth) {
    return { code: "PERIOD_INVALID", severity: "error", message: "The month is in the future", field: "period" };
  }
  return { date: row.period.date, period: "monthly" };
};

/** site|category|YYYY-MM|activity_name of saved emission rows touching these rows' sites. */
const existingKeys = async (rows: ImportRow[]): Promise<Set<string>> => {
  const siteIds = [...new Set(rows.map((r) => r.site_id))];
  if (!siteIds.length) return new Set();
  const found: { site_id: number; category_id: number; month: string; name: string | null }[] = await AppDataSource.query(
    `SELECT site_id, category_id, to_char(date_of_reporting, 'YYYY-MM') AS month, activity_data->>'activity_name' AS name
       FROM emission WHERE site_id = ANY($1::int[]) AND activity_data ? 'activity_name'`,
    [siteIds],
  );
  return new Set(found.map((f) => [f.site_id, f.category_id, f.month, String(f.name || "").trim().toLowerCase()].join("|")));
};

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const fakeWriter: EmissionWriter = {
  async planRows(ctx: WriterContext, rows: ImportRow[], opts: { planMatches: ActivityMatch[] }): Promise<PlannedRow[]> {
    const seen = new Map<string, number>();
    const existing = await existingKeys(rows);
    return rows.map((row) => {
      const issues: RowIssue[] = [];
      if (!ctx.allowed_site_ids.includes(row.site_id)) {
        issues.push({ code: "SITE_NOT_ALLOWED", severity: "error", message: "Site unknown or not in your scope", field: "site_id" });
      } else if (!(ctx.allowed_category_ids_by_site[row.site_id] || []).includes(row.category_id)) {
        issues.push({ code: "CATEGORY_NOT_ASSIGNED", severity: "error", message: "Category not assigned to this site (or not to you)", field: "category_id" });
      }
      const period = resolvePeriod(row);
      if ("code" in period) issues.push(period);
      if (row.activity_value === undefined || row.activity_value === null) {
        issues.push({ code: "MISSING_VALUE", severity: "error", message: "activity_value is required", field: "activity_value" });
      } else if (!(row.activity_value > 0)) {
        issues.push({ code: "NON_POSITIVE_VALUE", severity: "error", message: "activity_value must be greater than zero", field: "activity_value" });
      }
      const match = opts.planMatches.find(
        (m) => m.site_id === row.site_id && m.category_id === row.category_id && sameName(m.sheet_name, row.activity_name),
      );
      let factorName = match ? match.factor_name : row.activity_name;
      if (!match && /unknown/i.test(row.activity_name)) {
        issues.push({ code: "UNKNOWN_ACTIVITY", severity: "error", message: "No factor or mapping with this name", field: "activity_name" });
      }
      if (!("code" in period)) {
        const key = [row.site_id, row.category_id, period.date.slice(0, 7), factorName.trim().toLowerCase()].join("|");
        const n = (seen.get(key) || 0) + 1;
        seen.set(key, n);
        if (existing.has(key)) {
          issues.push({ code: "DUPLICATE_EXISTING", severity: "error", message: "An entry for this site, category, month and activity is already saved" });
        }
        if (n > 1) {
          issues.push({ code: "DUPLICATE_IN_PLAN", severity: "warning", message: "Another row in this plan has the same site, category, month and activity" });
        }
      }
      const hasError = issues.some((i) => i.severity === "error");
      if (hasError || "code" in period) return { row_ref: row.row_ref, state: "issue", issues, input: row };
      const value = Number(row.activity_value);
      return {
        row_ref: row.row_ref,
        state: "ready",
        issues,
        input: row,
        result: {
          activity: { name: row.activity_name, matched_by: match ? "plan_match" : "factor", factor_name: factorName },
          factor: { emission_factor_id: 1, year: Number(period.date.slice(0, 4)), value: 1, unit: `kgCO2e/${row.activity_unit}`, fallback_year: false },
          activity_value: value,
          activity_unit: row.activity_unit,
          total_tco2e: Math.round((value / 1000) * 1e6) / 1e6,
          reporting_date: period.date,
          reporting_period: period.period,
          ...(period.year_type ? { year_type: period.year_type } : {}),
        },
      };
    });
  },

  async insertRows(tx: EntityManager, ctx: WriterContext, rows: PlannedRow[], batch) {
    const repo = tx.getRepository(Emission);
    const ids: number[] = [];
    for (const row of rows) {
      if (row.state !== "ready" || !row.result) continue;
      if (row.input.notes === FAKE_FAIL_NOTES) throw new Error("fake writer: forced insert failure");
      const saved = await repo.save(
        repo.create({
          activity_data: { activity_name: row.input.activity_name, activity_value: row.result.activity_value, ...(row.input.fields || {}) },
          total_emission: row.result.total_tco2e,
          unit: "tCO2e",
          date_of_reporting: new Date(row.result.reporting_date),
          activity_data_unit: row.result.activity_unit,
          status: EmissionStatus.PENDING,
          created_by: { user_id: ctx.user_id } as any,
          category: { category_id: row.input.category_id } as any,
          site: { site_id: row.input.site_id } as any,
          reporting_period: row.result.reporting_period,
          year_type: row.result.year_type ?? null,
          upload_batch_id: batch.upload_batch_id,
          extra_data: { notes: row.input.notes ?? null, import_channel: batch.channel, import_row_ref: row.row_ref },
          emission_factor_snapshot: null,
        }),
      );
      ids.push(saved.pk_id);
    }
    return { inserted: ids.length, fera_inserted: 0, ids };
  },
};
