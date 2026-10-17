/**
 * S3-12 · POST /scope3/extrapolate: one Pending, estimated row that fills a
 * known gap from approved rows (guidance L1384-1399, coffee example L1189-1196).
 *
 *   coverage   the target site's approved rows of the category cover
 *              `coverage_pct` of the activity: the proxy row is the rest,
 *              Σ source kg × (100 − c) ÷ c
 *   intensity  (Σ source kg ÷ Σ approved output at the source sites) ×
 *              approved output at the sites without data (`production_data`)
 *
 * This file finds the sources and the output and builds the row; the engine
 * (`emissionWrite/methods/proxy.ts`) does the multiplication and
 * `insertEntry` saves it. Sources are approved, measured rows of the GHG
 * category and year: never a proxy row (`emission.proxy`), never a survey row.
 * The row is Pending, yearly, `data_type` secondary and `is_estimate` true
 * (the S3-3 columns; completeness scores 3 because the row carries a proxy),
 * and its `proxy` names the source row ids. The method is the most common
 * method of the sources (`emission.method`, else their `@method`). A second pending proxy for the same category, site,
 * year and basis is refused with `DUPLICATE_EXISTING` and the existing id.
 *
 * Roles: Manager and above, for sites they can access (Superadmin any site of
 * the company). Each row writes an `emission` and a `scope3_proxy` audit row.
 */
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import type { EmissionFactor } from "../../entities/EmissionFactor";
import { UserRole } from "../../types/type";
import { accessibleSiteIds } from "../../utils/companyScope";
import { computeRow, type CategoryContext } from "../../services/emissionWrite/compute";
import { insertEntry, reportingYearFor, type PreparedEntry } from "../../services/emissionWrite/index";
import { toStoredPeriod } from "../../services/emissionWrite/period";
import { ROW_METHOD_COLUMN } from "../../services/calculationSpec";
import { ExtrapolateBodySchema, PROXY_BASIS_LABELS, type Proxy } from "../contracts/schemas";
import { Scope3Error } from "../contracts/errors";
import { BoundaryError } from "../boundary/errors";
import { isScope3Sql } from "../taxonomy/service";
import { yearRange } from "./service";
import { ScreeningError } from "./errors";
import { commonMethod } from "./proxyRows";

export const EXTRAPOLATE_ROLES = new Set<string>([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN]);

export interface Caller {
  userId: number;
  role: string;
}

const SourceFilterSchema = z
  .object({
    site_ids: z.array(z.number().int().positive()).max(500).optional(),
    category_ids: z.array(z.number().int().positive()).max(500).optional(),
  })
  .strict();

const issuesOf = (issues: z.core.$ZodIssue[]) => issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message }));

const invalid = (reason: string, extra: Record<string, unknown> = {}, message?: string) => new Scope3Error("EXTRAPOLATION_BASIS_INVALID", { reason, ...extra }, message);

const kgSql = `COALESCE(e.total_kgco2e, e.total_emission::numeric * 1000)`;
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d });

/** The body, validated: a coverage outside 1–99 (or missing) is EXTRAPOLATION_BASIS_INVALID, anything else malformed 400 SCOPE3_VALIDATION. */
function parseBody(raw: unknown) {
  const body = (raw ?? {}) as Record<string, unknown>;
  if (body.basis === "coverage") {
    const c = body.coverage_pct;
    if (typeof c !== "number" || !Number.isFinite(c) || c < 1 || c > 99) {
      throw invalid("coverage_pct", {}, "Give the share of the activity the recorded rows cover, from 1 to 99 %.");
    }
  }
  const parsed = ExtrapolateBodySchema.safeParse(body);
  if (!parsed.success) throw new BoundaryError("SCOPE3_VALIDATION", { issues: issuesOf(parsed.error.issues) });
  const filter = SourceFilterSchema.safeParse(parsed.data.source_filter ?? {});
  if (!filter.success) throw new BoundaryError("SCOPE3_VALIDATION", { issues: issuesOf(filter.error.issues).map((i) => ({ ...i, path: `source_filter.${i.path}` })) });
  return { ...parsed.data, filter: filter.data };
}

interface SourceRow {
  pk_id: number;
  site_id: number;
  kg: number;
  method: string | null;
}

/** A synthetic factor: what the proxy multiplies by. It is snapshotted on the row like any factor. */
const proxyFactor = (name: string, value: string, unit: string, year: number): EmissionFactor =>
  ({
    emission_factor_id: null,
    emission_category_name: name,
    global_category_name: name,
    factor_value: value,
    denominator_unit: unit,
    source: "Extrapolated by ESGLite (S3-12)",
    year,
    factor_type: "other",
    dataset: "extrapolation",
  }) as unknown as EmissionFactor;

const ctxFor = (siteId: number, categoryId: number, categoryName: string): CategoryContext => ({
  site_id: siteId,
  category_id: categoryId,
  category_name: categoryName,
  scope: "Scope 3",
  assigned: true,
  hasForm: false,
  spec: null,
  selectColumns: new Set(),
  factors: null as any,
  fera: null,
});

/**
 * Builds the proxy row (and, unless `dryRun`, saves it). The dry run returns
 * the same figures, formula and sources without writing, for the dialog.
 */
export async function extrapolate(companyId: number, caller: Caller, raw: unknown, opts: { dryRun?: boolean } = {}) {
  if (!EXTRAPOLATE_ROLES.has(caller.role)) throw new BoundaryError("SCOPE3_FORBIDDEN");
  const body = parseBody(raw);
  const n = body.ghg_category;

  // Sites: the company's, and (below Superadmin) the caller's.
  const companySites: number[] = (await AppDataSource.query(`SELECT site_id FROM site WHERE company_id = $1`, [companyId])).map((r: any) => Number(r.site_id));
  const allowed = await accessibleSiteIds(caller.userId, caller.role);
  const visible = new Set(companySites.filter((id) => !allowed || allowed.has(id)));
  const mustSee = (ids: number[]) => {
    if (ids.some((id) => !visible.has(id))) throw new BoundaryError("SCOPE3_NOT_FOUND");
  };
  mustSee([body.site_id]);
  if (body.output_site_ids) mustSee(body.output_site_ids);
  if (body.filter.site_ids) mustSee(body.filter.site_ids);

  // The category the row is filed under: the target site's own category with this GHG number.
  const [cat]: any[] = await AppDataSource.query(
    `SELECT c.category_id, c.category_name FROM category c JOIN site_categories sc ON sc.category_id = c.category_id
      WHERE sc.site_id = $1 AND c.ghg_category = $2 AND ${isScope3Sql("c")}
      ORDER BY c.category_id LIMIT 1`,
    [body.site_id, n],
  );
  if (!cat) throw invalid("category_not_on_site", { site_id: body.site_id, ghg_category: n }, `This site has no category mapped to Category ${n}.`);
  const categoryId = Number(cat.category_id);

  const period = toStoredPeriod({ kind: "yearly", year: body.year, year_type: body.year_type } as any, categoryId);
  if (!period.ok) throw new BoundaryError("SCOPE3_VALIDATION", { field: "year", message: period.message });
  const { start, end } = yearRange(body.year, body.year_type);

  // One pending proxy per category, site, year and basis.
  const [dup]: any[] = await AppDataSource.query(
    `SELECT e.pk_id FROM emission e JOIN category c ON c.category_id = e.category_id
      WHERE e.site_id = $1 AND c.ghg_category = $2 AND e.status = 'pending' AND e.proxy ->> 'basis' = $3
        AND e.date_of_reporting >= $4 AND e.date_of_reporting <= $5
      ORDER BY e.pk_id LIMIT 1`,
    [body.site_id, n, body.basis, start, end],
  );
  if (dup) throw new ScreeningError("DUPLICATE_EXISTING", { existing_id: Number(dup.pk_id) });

  const outputSites = body.basis === "intensity" ? [...new Set(body.output_site_ids ?? [body.site_id])] : [];
  const sourceSites =
    body.filter.site_ids ?? (body.basis === "coverage" ? [body.site_id] : [...visible].filter((id) => !outputSites.includes(id)));
  if (body.basis === "intensity" && sourceSites.some((id) => outputSites.includes(id))) {
    throw invalid("output_site_is_source", { site_ids: sourceSites.filter((id) => outputSites.includes(id)) }, "A site can't be both a source and a site without data.");
  }

  const measured = (sites: number[]) => {
    const params: unknown[] = [companyId, n, start, end, sites];
    let catFilter = "";
    if (body.filter.category_ids?.length) {
      params.push(body.filter.category_ids);
      catFilter = `AND e.category_id = ANY($${params.length}::int[])`;
    }
    return AppDataSource.query(
      `SELECT e.pk_id, e.site_id, ${kgSql} AS kg, COALESCE(e.method, e.activity_data ->> '${ROW_METHOD_COLUMN}') AS method
         FROM emission e
         JOIN category c ON c.category_id = e.category_id
         JOIN site s ON s.site_id = e.site_id
        WHERE s.company_id = $1 AND c.ghg_category = $2 AND ${isScope3Sql("c")}
          AND e.status = 'approved' AND e.proxy IS NULL AND NOT COALESCE(e.extra_data ? 'survey', false)
          AND e.date_of_reporting >= $3 AND e.date_of_reporting <= $4
          AND e.site_id = ANY($5::int[]) ${catFilter}
        ORDER BY e.pk_id`,
      params,
    ) as Promise<any[]>;
  };
  const sources: SourceRow[] = (await measured(sourceSites)).map((r) => ({ pk_id: Number(r.pk_id), site_id: Number(r.site_id), kg: Number(r.kg) || 0, method: r.method ?? null }));
  if (!sources.length) throw invalid("no_source_rows", {}, `No approved Category ${n} rows for ${body.year_type} ${body.year} to extrapolate from.`);
  const sourceKg = sources.reduce((s, r) => s + r.kg, 0);
  if (!(sourceKg > 0)) throw invalid("no_source_rows", {}, "The approved source rows add up to zero.");
  const method = commonMethod(sources.map((s) => s.method));
  const label = PROXY_BASIS_LABELS[body.basis];

  let factor: EmissionFactor;
  let quantity: number;
  let unit: string;
  let proxy: Proxy;
  let formula: string;
  const detail: Record<string, unknown> = { source_kg: Math.round(sourceKg * 10000) / 10000, source_rows: sources.length, source_site_ids: [...new Set(sources.map((s) => s.site_id))] };
  const from = sources.map((s) => s.pk_id).slice(0, 10_000);

  if (body.basis === "coverage") {
    const c = body.coverage_pct!;
    quantity = Math.round(sourceKg * 10000) / 10000;
    unit = "kgCO2e";
    factor = proxyFactor(`Category ${n} · scaled up from ${fmt(c)} % coverage`, "1.00000000", "kgCO2e", body.year);
    proxy = { basis: "coverage", coverage_pct: c, from };
    formula = `${fmt(sourceKg)} kgCO₂e × (100 − ${fmt(c)}) ÷ ${fmt(c)}`;
  } else {
    // Sites without data must really have none, or the proxy would double count.
    const covered = await measured(outputSites);
    if (covered.length) throw invalid("output_site_has_data", { site_ids: [...new Set(covered.map((r) => Number(r.site_id)))] }, "A site chosen as without data already has approved rows for this category and year.");
    const sitesWithData = [...new Set(sources.map((s) => s.site_id))];
    const production = async (sites: number[]) =>
      (await AppDataSource.query(
        `SELECT unit, SUM(quantity) AS qty FROM production_data
          WHERE status = 'approved' AND site_id = ANY($1::int[]) AND start_date >= $2 AND start_date <= $3
          GROUP BY unit`,
        [sites, start, end],
      )) as any[];
    const [src, out] = await Promise.all([production(sitesWithData), production(outputSites)]);
    const srcQty = src.reduce((s, r) => s + Number(r.qty), 0);
    const outQty = out.reduce((s, r) => s + Number(r.qty), 0);
    if (!(srcQty > 0) || !(outQty > 0)) {
      throw invalid("no_production", { source_output: srcQty, output: outQty }, "Approved production is needed at the sites with data and at the sites without.");
    }
    const units = new Set([...src, ...out].map((r) => String(r.unit).trim().toLowerCase()));
    if (units.size !== 1) throw invalid("production_units_differ", { units: [...units] }, "Production is recorded in more than one unit; extrapolate one product unit at a time.");
    unit = String(src[0].unit).trim();
    const intensity = sourceKg / srcQty;
    quantity = outQty;
    factor = proxyFactor(`Category ${n} · ${fmt(intensity, 4)} kgCO₂e per ${unit} at sites with data`, String(intensity), unit, body.year);
    const share = Math.round((srcQty / (srcQty + outQty)) * 10000) / 100;
    proxy = { basis: "intensity", ...(share > 0 && share <= 100 ? { coverage_pct: share } : {}), from };
    formula = `${fmt(sourceKg)} kgCO₂e ÷ ${fmt(srcQty)} ${unit} × ${fmt(outQty)} ${unit}`;
    Object.assign(detail, { source_output: srcQty, output: outQty, output_unit: unit, output_site_ids: outputSites, intensity_kg_per_unit: intensity });
  }

  const activity_data: Record<string, any> = {
    emission_category: factor.emission_category_name,
    activity_value: String(quantity),
    "Extrapolation basis": label,
    ...(method ? { [ROW_METHOD_COLUMN]: method } : {}),
  };
  const ctx = ctxFor(body.site_id, categoryId, cat.category_name);
  // The DQ time rule compares the factor year with the year the row is reported in (S3-3).
  const result = computeRow(ctx, { factor, activity_data, activity_unit: unit, method, proxy, reportingYear: reportingYearFor(period.period.date_of_reporting) });
  if (!result.ok) throw invalid("not_computable", { code: result.issue.code }, result.issue.message);
  const computed = result.computed;

  const preview = {
    ghg_category: n,
    site_id: body.site_id,
    category_id: categoryId,
    year: body.year,
    year_type: body.year_type,
    basis: body.basis,
    basis_label: label,
    method,
    formula: `${formula} = ${fmt(Number(computed.total_kgco2e))} kgCO₂e`,
    total_kgco2e: computed.total_kgco2e!,
    total_tco2e: computed.total,
    proxy,
    sources: { rows: sources.length, kg: detail.source_kg, site_ids: detail.source_site_ids },
    ...(body.basis === "intensity" ? { production: { source: detail.source_output, missing: detail.output, unit: detail.output_unit, output_site_ids: outputSites } } : {}),
  };
  if (opts.dryRun) return { ...preview, dry_run: true };

  const extra_data = { extrapolation: { ...detail, basis: body.basis, formula: preview.formula } };
  const entry: PreparedEntry = {
    input: { site_id: body.site_id, category_id: categoryId, activity_data, activity_data_unit: unit, period: period.period, extra_data, proxy, is_estimate: true },
    factor,
    computed,
    fera: null,
    tdLoss: null,
    warnings: [],
  };
  // TODO(S3-15·2): refuse with PERIOD_LOCKED when the target site's year is locked
  // (period_lock, contracts §4 and §7). The lock table and its check arrive with
  // S3-15 part 2, which isn't on production; until then no lock is checked here.
  const saved = await AppDataSource.transaction(async (tx) => {
    // Re-check the duplicate inside the transaction (two clicks at once). FOR UPDATE
    // locks nothing when no row exists yet, so serialise on the key first.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`s3-12-proxy:${body.site_id}:${n}:${body.basis}:${start}`]);
    const [again]: any[] = await tx.query(
      `SELECT e.pk_id FROM emission e JOIN category c ON c.category_id = e.category_id
        WHERE e.site_id = $1 AND c.ghg_category = $2 AND e.status = 'pending' AND e.proxy ->> 'basis' = $3
          AND e.date_of_reporting >= $4 AND e.date_of_reporting <= $5 LIMIT 1 FOR UPDATE OF e`,
      [body.site_id, n, body.basis, start, end],
    );
    if (again) throw new ScreeningError("DUPLICATE_EXISTING", { existing_id: Number(again.pk_id) });
    const { emission } = await insertEntry(tx, caller.userId, entry, null, null);
    const reason = `Extrapolated (${label.toLowerCase()}) from ${sources.length} approved row(s)`;
    await tx.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES
         ('emission', $1, 'create', $2, $3, $4),
         ('scope3_proxy', $1, 'extrapolate', $5, $3, $4)`,
      [
        emission.pk_id,
        JSON.stringify({ status: { old: null, new: "pending" }, total_kgco2e: { old: null, new: computed.total_kgco2e } }),
        reason,
        caller.userId || null,
        JSON.stringify({ proxy: { old: null, new: { basis: proxy.basis, coverage_pct: proxy.coverage_pct ?? null, sources: sources.length } }, formula: { old: null, new: preview.formula } }),
      ],
    );
    return emission;
  });
  console.log(`[scope3] Extrapolated ${body.basis} row ${saved.pk_id} for company ${companyId} site ${body.site_id} category ${n} by user ${caller.userId}`);
  return { id: saved.pk_id, status: "pending", ...preview };
}
