/**
 * S3-12 · screening (GET /scope3/screening, PUT /scope3/screening/inputs).
 *
 * One row per GHG Protocol category for a company and year: its boundary
 * status (S3-1, the only source of status), what is recorded (approved and
 * pending rows), a rough estimate from the screening inputs (estimate.ts),
 * its share of the screened total and a suggested status (rules.ts). Nothing
 * here writes an emission row or a boundary status: ticks and "Apply" go
 * through PUT /scope3/categories/:n (S3-1).
 */
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import { GHG_CATEGORIES } from "../contracts/ghgCategory";
import { PutScreeningInputsBodySchema, SCREENING_BASES } from "../contracts/schemas";
import { BoundaryError } from "../boundary/errors";
import { getBoundary } from "../boundary/service";
import { isScope3Sql } from "../taxonomy/service";
import { accessibleSiteIds } from "../../utils/companyScope";
import { ESTIMATE_ORDER, Estimator, type Estimate, type InputRow } from "./estimate";
import { suggest, shares, type RuleInput, type SizeBasis } from "./rules";

export type YearType = "CY" | "FY";

/** First and last day of a CY or (April) FY year, as reports and toStoredPeriod use them. */
export const yearRange = (year: number, yearType: YearType): { start: string; end: string } =>
  yearType === "FY" ? { start: `${year - 1}-04-01`, end: `${year}-03-31` } : { start: `${year}-01-01`, end: `${year}-12-31` };

const issuesOf = (issues: z.core.$ZodIssue[]) => issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message }));

const QuerySchema = z.object({
  year: z.coerce.number().int().min(1990).max(2100),
  year_type: z.enum(["CY", "FY"]).default("CY"),
});

/** `?year=&year_type=`, or 400. */
export function parseScreeningQuery(query: unknown): { year: number; year_type: YearType } {
  const parsed = QuerySchema.safeParse(query ?? {});
  if (!parsed.success) throw new BoundaryError("SCOPE3_VALIDATION", { issues: issuesOf(parsed.error.issues) });
  return parsed.data;
}

const kgSql = `COALESCE(e.total_kgco2e, e.total_emission::numeric * 1000)`;

interface Recorded {
  approved_kg: number;
  pending_kg: number;
  proxy_kg: number;
  rows: number;
}

/** Approved and pending Scope 3 kg per GHG category for the company's sites in the year. */
async function recordedByCategory(companyId: number, start: string, end: string): Promise<Map<number, Recorded>> {
  const rows: any[] = await AppDataSource.query(
    `SELECT c.ghg_category AS n,
            SUM(CASE WHEN e.status = 'approved' THEN ${kgSql} ELSE 0 END) AS approved_kg,
            SUM(CASE WHEN e.status = 'pending' THEN ${kgSql} ELSE 0 END) AS pending_kg,
            SUM(CASE WHEN e.proxy IS NOT NULL THEN ${kgSql} ELSE 0 END) AS proxy_kg,
            COUNT(*)::int AS rows
       FROM emission e
       JOIN category c ON c.category_id = e.category_id
       JOIN site s ON s.site_id = e.site_id
      WHERE s.company_id = $1
        AND e.status IN ('approved', 'pending')
        AND e.date_of_reporting >= $2 AND e.date_of_reporting <= $3
        AND c.ghg_category IS NOT NULL
        AND ${isScope3Sql("c")}
      GROUP BY c.ghg_category`,
    [companyId, start, end],
  );
  return new Map(
    rows.map((r) => [Number(r.n), { approved_kg: Number(r.approved_kg) || 0, pending_kg: Number(r.pending_kg) || 0, proxy_kg: Number(r.proxy_kg) || 0, rows: Number(r.rows) }]),
  );
}

/** The company's screening inputs for a year. */
async function inputsFor(companyId: number, year: number) {
  const rows: any[] = await AppDataSource.query(
    `SELECT i.ghg_category, i.basis, i.amount, i.currency, i.eeio_sector, i.note, i.updated_at, i.updated_by, u.name AS updated_by_name
       FROM scope3_screening_input i
       LEFT JOIN "user" u ON u.user_id = i.updated_by
      WHERE i.company_id = $1 AND i.year = $2
      ORDER BY i.ghg_category, i.basis`,
    [companyId, year],
  );
  return rows.map((r) => ({
    ghg_category: Number(r.ghg_category),
    basis: r.basis as (typeof SCREENING_BASES)[number],
    amount: Number(r.amount),
    currency: r.currency ?? null,
    eeio_sector: r.eeio_sector ?? null,
    note: r.note ?? null,
    updated_at: r.updated_at,
    updated_by: r.updated_by ? { user_id: Number(r.updated_by), name: r.updated_by_name ?? null } : null,
  }));
}

const t = (kg: number | null): number | null => (kg === null ? null : Math.round(kg / 10) / 100);

/**
 * The company's sites the caller can access, with the GHG category numbers
 * each carries, for the "Extrapolate…" dialog (target site, sources, sites
 * without data).
 */
async function sitesFor(companyId: number, caller: { userId: number; role: string } | null) {
  const allowed = caller ? await accessibleSiteIds(caller.userId, caller.role) : null;
  const rows: any[] = await AppDataSource.query(
    `SELECT s.site_id, s.name,
            COALESCE(array_agg(DISTINCT c.ghg_category) FILTER (WHERE c.ghg_category IS NOT NULL AND ${isScope3Sql("c")}), '{}') AS ghg_categories
       FROM site s
       LEFT JOIN site_categories sc ON sc.site_id = s.site_id
       LEFT JOIN category c ON c.category_id = sc.category_id
      WHERE s.company_id = $1
      GROUP BY s.site_id, s.name
      ORDER BY s.name, s.site_id`,
    [companyId],
  );
  return rows
    .filter((r) => !allowed || allowed.has(Number(r.site_id)))
    .map((r) => ({ site_id: Number(r.site_id), name: r.name as string, ghg_categories: (r.ghg_categories as unknown[]).map(Number).sort((a, b) => a - b) }));
}

/** GET /scope3/screening: 15 rows plus totals. Estimates are computed here and never saved. */
export async function getScreening(companyId: number, query: unknown, caller: { userId: number; role: string } | null = null) {
  const { year, year_type } = parseScreeningQuery(query);
  const { start, end } = yearRange(year, year_type);
  const boundary = await getBoundary(companyId);
  const recorded = await recordedByCategory(companyId, start, end);
  const inputs = await inputsFor(companyId, year);
  const estimator = new Estimator(AppDataSource.manager, year, year_type);

  const perCategory = await Promise.all(
    GHG_CATEGORIES.map(async (c) => {
      const mine = inputs.filter((i) => i.ghg_category === c.n);
      const estimates: (Estimate & { input_basis: string })[] = [];
      for (const i of mine) estimates.push({ ...(await estimator.estimate(i as InputRow)), input_basis: i.basis });
      const chosen = ESTIMATE_ORDER.map((b) => estimates.find((e) => e.basis === b && e.kg !== null)).find(Boolean) ?? null;
      return { c, mine, estimates, chosen };
    }),
  );

  const ruleInputs: RuleInput[] = perCategory.map(({ c, mine, chosen }) => {
    const rec = recorded.get(c.n);
    const recordedT = rec ? t(rec.approved_kg + rec.pending_kg)! : 0;
    const estimateT = chosen ? t(chosen.kg) : null;
    const b = boundary.categories.find((x) => x.n === c.n);
    let size: number | null = null;
    let sizeBasis: SizeBasis | null = null;
    if (estimateT !== null && estimateT >= recordedT) {
      size = estimateT;
      sizeBasis = chosen!.basis as SizeBasis;
    } else if (rec) {
      size = recordedT;
      sizeBasis = "recorded";
    }
    return {
      n: c.n,
      size_tco2e: size,
      size_basis: sizeBasis,
      has_input: mine.some((i) => i.amount > 0),
      has_rows: !!rec && rec.rows > 0,
      ticks: Object.entries((b?.relevance as Record<string, boolean> | null) ?? {}).filter(([, v]) => v).map(([k]) => k),
    };
  });
  const suggestions = suggest(ruleInputs, year);
  const { share } = shares(ruleInputs);

  const categories = perCategory.map(({ c, mine, estimates, chosen }, idx) => {
    const b = boundary.categories.find((x) => x.n === c.n)!;
    const rec = recorded.get(c.n);
    const r = ruleInputs[idx];
    return {
      n: c.n,
      key: c.key,
      name: c.name,
      direction: c.direction,
      status: b.status,
      reason: b.reason,
      relevance: b.relevance ?? {},
      recorded_tco2e: rec ? t(rec.approved_kg + rec.pending_kg) : 0,
      pending_tco2e: rec ? t(rec.pending_kg) : 0,
      proxy_tco2e: rec ? t(rec.proxy_kg) : 0,
      estimate_tco2e: chosen ? t(chosen.kg) : null,
      basis: chosen?.basis ?? null,
      size_tco2e: r.size_tco2e,
      size_basis: r.size_basis,
      share_pct: share.has(c.n) ? Math.round(share.get(c.n)! * 10) / 10 : 0,
      suggestion: suggestions.get(c.n)!,
      inputs: mine.map((i) => {
        const e = estimates.find((x) => x.input_basis === i.basis);
        return {
          ...i,
          estimate_tco2e: e && e.kg !== null ? t(e.kg) : null,
          estimate_note: e?.note ?? null,
          sector: e?.sector ?? null,
          fx: e?.fx ?? null,
          warnings: e?.warnings ?? [],
        };
      }),
      mapped_categories: b.mapped_categories,
    };
  });

  const sum = (f: (x: (typeof categories)[number]) => number | null) => Math.round(categories.reduce((s, x) => s + (f(x) ?? 0), 0) * 100) / 100;
  return {
    company_id: companyId,
    year,
    year_type,
    period: { start, end },
    sites: await sitesFor(companyId, caller),
    totals: {
      recorded_tco2e: sum((x) => x.recorded_tco2e),
      pending_tco2e: sum((x) => x.pending_tco2e),
      estimate_tco2e: sum((x) => x.estimate_tco2e),
      screened_tco2e: sum((x) => x.size_tco2e),
      included: categories.filter((x) => x.status === "included").length,
      with_reason: categories.filter((x) => x.status === "included" || !!x.reason).length,
    },
    categories,
  };
}

/**
 * PUT /scope3/screening/inputs `{year, inputs: [{ghg_category, basis, amount, currency?, eeio_sector?, note?}]}`:
 * upserts one row per (company, year, category, basis). An amount of 0 clears
 * a figure without deleting its history. Each change writes an audit row
 * (`scope3_screening_input`) with old and new values.
 */
export async function putInputs(companyId: number, raw: unknown, userId: number) {
  const parsed = PutScreeningInputsBodySchema.safeParse(raw ?? {});
  if (!parsed.success) throw new BoundaryError("SCOPE3_VALIDATION", { issues: issuesOf(parsed.error.issues) });
  const { year, inputs } = parsed.data;
  if (inputs.length > 75) throw new BoundaryError("SCOPE3_VALIDATION", { field: "inputs", reason: "at most 75 rows (15 categories × 5 bases)" });
  const keys = inputs.map((i) => `${i.ghg_category}:${i.basis}`);
  if (new Set(keys).size !== keys.length) throw new BoundaryError("SCOPE3_VALIDATION", { field: "inputs", reason: "a category and basis appear twice" });
  for (const [idx, i] of inputs.entries()) {
    if ((i.basis === "spend" || i.basis === "revenue") && i.amount > 0 && !i.currency) {
      throw new BoundaryError("SCOPE3_VALIDATION", { field: `inputs[${idx}].currency`, reason: "an amount spent needs its currency" });
    }
  }

  await AppDataSource.transaction(async (m) => {
    for (const i of inputs) {
      const next = {
        amount: i.amount.toFixed(4),
        currency: i.currency ?? null,
        eeio_sector: i.eeio_sector?.trim() || null,
        note: i.note?.trim() || null,
      };
      const [old]: any[] = await m.query(
        `SELECT id, amount, currency, eeio_sector, note FROM scope3_screening_input
          WHERE company_id = $1 AND year = $2 AND ghg_category = $3 AND basis = $4 FOR UPDATE`,
        [companyId, year, i.ghg_category, i.basis],
      );
      let id: number;
      const changed: Record<string, { old: unknown; new: unknown }> = {};
      if (old) {
        for (const k of ["amount", "currency", "eeio_sector", "note"] as const) {
          const before = k === "amount" ? Number(old.amount).toFixed(4) : old[k] ?? null;
          if (before !== next[k]) changed[k] = { old: before, new: next[k] };
        }
        if (!Object.keys(changed).length) continue;
        await m.query(
          `UPDATE scope3_screening_input SET amount = $1, currency = $2, eeio_sector = $3, note = $4, updated_by = $5, updated_at = now() WHERE id = $6`,
          [next.amount, next.currency, next.eeio_sector, next.note, userId || null, old.id],
        );
        id = Number(old.id);
      } else {
        const [row]: any[] = await m.query(
          `INSERT INTO scope3_screening_input (company_id, year, ghg_category, basis, amount, currency, eeio_sector, note, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [companyId, year, i.ghg_category, i.basis, next.amount, next.currency, next.eeio_sector, next.note, userId || null],
        );
        id = Number(row.id);
        for (const k of ["amount", "currency", "eeio_sector", "note"] as const) if (next[k] !== null) changed[k] = { old: null, new: next[k] };
      }
      await m.query(
        `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('scope3_screening_input', $1, $2, $3, $4, $5)`,
        [id, old ? "update" : "create", JSON.stringify({ year: { old: year, new: year }, ghg_category: { old: i.ghg_category, new: i.ghg_category }, basis: { old: i.basis, new: i.basis }, ...changed }), null, userId || null],
      );
    }
  });
  return { company_id: companyId, year, inputs: await inputsFor(companyId, year) };
}
