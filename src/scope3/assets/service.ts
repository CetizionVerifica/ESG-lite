/**
 * S3-11 · leased sites, franchises and the investments register.
 *
 *   - lease fields on a site (lease_role, lease_type, floor_area_m2) and the
 *     lease boundary note per site (boundary.ts);
 *   - the investments register (table `investment`), company-scoped;
 *   - the Category 15 plan: one yearly row per investment, as an import plan
 *     (channel bulk_upload). The engine calculates every row; nothing here
 *     multiplies a quantity by a factor.
 *
 * Every query filters by the company id access.ts resolved. Create and update
 * write audit_log rows (entity_type scope3_investment, scope3_site_lease).
 * Logs carry ids only.
 */
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import { Investment } from "../../entities/Investment";
import { InvestmentSchema, SiteLeaseSchema } from "../contracts/schemas";
import { BoundaryError } from "../boundary/errors";
import type { Queryable } from "../taxonomy/service";
import { createPlan } from "../../imports/plans/service";
import type { TokenUser } from "../../imports/plans/scope";
import type { ImportRow } from "../../imports/contracts";
import { targetYearFor } from "../../services/emissionWrite/resolve";
import { toStoredPeriod } from "../../services/emissionWrite/period";
import { leaseBoundary, leaseBoundaryNote } from "./boundary";
import { ensureAssetForm } from "./forms";
import { COL_EQUITY, COL_INVESTEE_T, COL_INVESTMENT_REF, COL_REVENUE, COL_SECTOR_SHARE, REPORTED_T } from "./configs";

async function audit(q: Queryable, entityType: string, entityId: number, action: string, changed: Record<string, { old: any; new: any }>, userId: number) {
  if (!Object.keys(changed).length) return;
  await q.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ($1, $2, $3, $4, NULL, $5)`,
    [entityType, entityId, action, JSON.stringify(changed), userId || null],
  );
}

const invalid = (err: z.ZodError) =>
  new BoundaryError("SCOPE3_VALIDATION", { issues: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------------------
// Leased sites
// ---------------------------------------------------------------------------

async function approachOf(companyId: number, q: Queryable = AppDataSource): Promise<string> {
  const [row]: any[] = await q.query(`SELECT consolidation_approach FROM company WHERE company_id = $1`, [companyId]);
  return row?.consolidation_approach ?? "operational_control";
}

const siteView = (r: any, approach: string) => ({
  site_id: Number(r.site_id),
  name: r.name,
  lease_role: r.lease_role ?? null,
  lease_type: r.lease_type ?? null,
  floor_area_m2: numOrNull(r.floor_area_m2),
  boundary: leaseBoundary(r.lease_role, r.lease_type, approach),
  note: leaseBoundaryNote(r.lease_role, r.lease_type, approach),
});

/** Every site of the company with its lease fields and boundary note. */
export async function listLeaseSites(companyId: number, q: Queryable = AppDataSource) {
  const approach = await approachOf(companyId, q);
  const rows: any[] = await q.query(
    `SELECT site_id, name, lease_role, lease_type, floor_area_m2 FROM site WHERE company_id = $1 ORDER BY name, site_id`,
    [companyId],
  );
  return { company_id: companyId, consolidation_approach: approach, sites: rows.map((r) => siteView(r, approach)) };
}

/** The leased or franchised sites only: the per-site note GET /scope3/categories carries. */
export async function leaseNotes(companyId: number, q: Queryable = AppDataSource) {
  const { sites } = await listLeaseSites(companyId, q);
  return sites.filter((s) => s.lease_role !== null);
}

export async function updateSiteLease(companyId: number, siteId: number, body: unknown, userId: number) {
  if (!Number.isInteger(siteId) || siteId <= 0) throw new BoundaryError("SCOPE3_NOT_FOUND");
  const parsed = SiteLeaseSchema.strict().safeParse(body ?? {});
  if (!parsed.success) throw invalid(parsed.error);
  const next = parsed.data;
  return AppDataSource.transaction(async (m) => {
    const [row]: any[] = await m.query(
      `SELECT site_id, name, lease_role, lease_type, floor_area_m2 FROM site WHERE site_id = $1 AND company_id = $2 FOR UPDATE`,
      [siteId, companyId],
    );
    if (!row) throw new BoundaryError("SCOPE3_NOT_FOUND");
    const merged = {
      lease_role: next.lease_role === undefined ? row.lease_role : next.lease_role,
      lease_type: next.lease_type === undefined ? row.lease_type : next.lease_type,
      floor_area_m2: next.floor_area_m2 === undefined ? numOrNull(row.floor_area_m2) : next.floor_area_m2,
    };
    // No lease role means no lease: the type goes with it.
    if (merged.lease_role === null) merged.lease_type = null;
    const before = { lease_role: row.lease_role ?? null, lease_type: row.lease_type ?? null, floor_area_m2: numOrNull(row.floor_area_m2) };
    const changed: Record<string, { old: any; new: any }> = {};
    for (const k of ["lease_role", "lease_type", "floor_area_m2"] as const) {
      if ((before[k] ?? null) !== (merged[k] ?? null)) changed[k] = { old: before[k] ?? null, new: merged[k] ?? null };
    }
    if (Object.keys(changed).length) {
      await m.query(`UPDATE site SET lease_role = $1, lease_type = $2, floor_area_m2 = $3 WHERE site_id = $4`, [
        merged.lease_role ?? null,
        merged.lease_type ?? null,
        merged.floor_area_m2 ?? null,
        siteId,
      ]);
      await audit(m, "scope3_site_lease", siteId, "update", changed, userId);
    }
    const approach = await approachOf(companyId, m);
    return siteView({ ...row, ...merged }, approach);
  });
}

// ---------------------------------------------------------------------------
// Investments register
// ---------------------------------------------------------------------------

const InvestmentBody = InvestmentSchema.omit({ id: true, company_id: true }).strict();
const InvestmentPatch = InvestmentBody.partial().strict();

const FIELDS = ["investee", "type", "share_pct", "investee_scope12_tco2e", "year", "source", "revenue", "currency", "eeio_sector", "sector_split"] as const;

export const investmentView = (r: Investment | any) => ({
  id: Number(r.id),
  company_id: Number(r.company_id),
  investee: r.investee,
  type: r.type,
  share_pct: Number(r.share_pct),
  investee_scope12_tco2e: numOrNull(r.investee_scope12_tco2e),
  year: Number(r.year),
  source: r.source ?? null,
  revenue: numOrNull(r.revenue),
  currency: r.currency ?? null,
  eeio_sector: r.eeio_sector ?? null,
  sector_split: r.sector_split ?? null,
  updated_at: r.updated_at ?? null,
});
type InvestmentView = ReturnType<typeof investmentView>;

const splitOk = (split: Record<string, number> | null | undefined) =>
  !split || (Object.keys(split).length > 0 && Math.abs(Object.values(split).reduce((s, v) => s + v, 0) - 1) <= 0.001);

const checkSplit = (split: Record<string, number> | null | undefined) => {
  if (!splitOk(split)) throw new BoundaryError("SCOPE3_VALIDATION", { issues: [{ field: "sector_split", message: "Sector shares must add up to 1." }] });
};

export async function listInvestments(companyId: number, year?: number) {
  const repo = AppDataSource.getRepository(Investment);
  const rows = await repo.find({
    where: year ? { company_id: companyId, year } : { company_id: companyId },
    order: { year: "DESC", investee: "ASC", id: "ASC" },
  });
  return rows.map(investmentView);
}

export async function createInvestment(companyId: number, body: unknown, userId: number) {
  const parsed = InvestmentBody.safeParse(body ?? {});
  if (!parsed.success) throw invalid(parsed.error);
  checkSplit(parsed.data.sector_split);
  return AppDataSource.transaction(async (m) => {
    const repo = m.getRepository(Investment);
    const d = parsed.data;
    const saved = await repo.save(
      repo.create({
        company_id: companyId,
        investee: d.investee,
        type: d.type,
        share_pct: String(d.share_pct),
        investee_scope12_tco2e: d.investee_scope12_tco2e == null ? null : String(d.investee_scope12_tco2e),
        year: d.year,
        source: d.source ?? null,
        revenue: d.revenue == null ? null : String(d.revenue),
        currency: d.currency ?? null,
        eeio_sector: d.eeio_sector ?? null,
        sector_split: d.sector_split ?? null,
        created_by: userId || null,
        updated_by: userId || null,
      }),
    );
    const view = investmentView(saved);
    const changed: Record<string, { old: any; new: any }> = {};
    for (const k of FIELDS) if (view[k] !== null) changed[k] = { old: null, new: view[k] };
    await audit(m, "scope3_investment", view.id, "create", changed, userId);
    return view;
  });
}

export async function updateInvestment(companyId: number, id: number, body: unknown, userId: number) {
  if (!Number.isInteger(id) || id <= 0) throw new BoundaryError("SCOPE3_NOT_FOUND");
  const parsed = InvestmentPatch.safeParse(body ?? {});
  if (!parsed.success) throw invalid(parsed.error);
  return AppDataSource.transaction(async (m) => {
    const repo = m.getRepository(Investment);
    const row = await repo.findOne({ where: { id, company_id: companyId }, lock: { mode: "pessimistic_write" } });
    if (!row) throw new BoundaryError("SCOPE3_NOT_FOUND");
    const before = investmentView(row);
    const d = parsed.data;
    const next = { ...before, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) } as InvestmentView;
    checkSplit(next.sector_split);
    row.investee = next.investee;
    row.type = next.type;
    row.share_pct = String(next.share_pct);
    row.investee_scope12_tco2e = next.investee_scope12_tco2e == null ? null : String(next.investee_scope12_tco2e);
    row.year = next.year;
    row.source = next.source ?? null;
    row.revenue = next.revenue == null ? null : String(next.revenue);
    row.currency = next.currency ?? null;
    row.eeio_sector = next.eeio_sector ?? null;
    row.sector_split = next.sector_split ?? null;
    row.updated_by = userId || null;
    const changed: Record<string, { old: any; new: any }> = {};
    for (const k of FIELDS) if (JSON.stringify(before[k] ?? null) !== JSON.stringify(next[k] ?? null)) changed[k] = { old: before[k] ?? null, new: next[k] ?? null };
    if (!Object.keys(changed).length) return before;
    const saved = await repo.save(row);
    await audit(m, "scope3_investment", id, "update", changed, userId);
    return investmentView(saved);
  });
}

// ---------------------------------------------------------------------------
// Category 15 plan
// ---------------------------------------------------------------------------

export const PlanBodySchema = z
  .object({
    company_id: z.number().int().positive().optional(),
    site_id: z.number().int().positive(),
    year: z.number().int().min(2000).max(2100),
    year_type: z.enum(["CY", "FY"]),
    /** The company's disclosed threshold: investments with a smaller share are listed, not planned (L6174-6190). */
    threshold_pct: z.number().min(0).max(100).optional(),
  })
  .strict();

export type SkipReason = "below_threshold" | "out_of_scope" | "missing_data";

export interface PlannedInvestment {
  investment_id: number;
  row_refs: string[];
  method: "investment_specific" | "average_data";
}

const fmt = (n: number) => String(Number(n.toFixed(6)));

/**
 * The plan rows for one year's investments: investment-specific when the
 * investee's Scope 1+2 is known, else average-data from revenue and the EEIO
 * sector (one row per sector of the split). Debt and project finance are out
 * of scope (15.3–15.5); smaller stakes than the threshold are listed only.
 */
export function investmentRows(
  investments: InvestmentView[],
  site_id: number,
  category_id: number,
  period: ImportRow["period"],
  threshold = 0,
): { rows: ImportRow[]; planned: PlannedInvestment[]; skipped: Array<{ investment_id: number; investee: string; reason: SkipReason }> } {
  const rows: ImportRow[] = [];
  const planned: PlannedInvestment[] = [];
  const skipped: Array<{ investment_id: number; investee: string; reason: SkipReason }> = [];
  for (const inv of investments) {
    const ref = `#${inv.id}`;
    if (inv.type !== "equity") {
      skipped.push({ investment_id: inv.id, investee: inv.investee, reason: "out_of_scope" });
      continue;
    }
    if (inv.share_pct < threshold) {
      skipped.push({ investment_id: inv.id, investee: inv.investee, reason: "below_threshold" });
      continue;
    }
    const base = { site_id, category_id, period };
    if (inv.investee_scope12_tco2e !== null) {
      const row_ref = `investment-${inv.id}`;
      rows.push({
        ...base,
        row_ref,
        activity_name: REPORTED_T,
        activity_unit: "tCO2e",
        fields: { [COL_INVESTEE_T]: inv.investee_scope12_tco2e, [COL_EQUITY]: inv.share_pct, [COL_INVESTMENT_REF]: ref },
      });
      planned.push({ investment_id: inv.id, row_refs: [row_ref], method: "investment_specific" });
      continue;
    }
    const split: Record<string, number> | null = inv.sector_split ?? (inv.eeio_sector ? { [inv.eeio_sector]: 1 } : null);
    if (inv.revenue === null || !split) {
      skipped.push({ investment_id: inv.id, investee: inv.investee, reason: "missing_data" });
      continue;
    }
    const refs: string[] = [];
    Object.entries(split).forEach(([sector, share], i) => {
      const row_ref = `investment-${inv.id}-${i + 1}`;
      refs.push(row_ref);
      rows.push({
        ...base,
        row_ref,
        activity_name: sector,
        activity_unit: inv.currency ?? "USD",
        fields: { [COL_REVENUE]: inv.revenue as number, [COL_SECTOR_SHARE]: fmt(share * 100), [COL_EQUITY]: inv.share_pct, [COL_INVESTMENT_REF]: ref },
      });
    });
    planned.push({ investment_id: inv.id, row_refs: refs, method: "average_data" });
  }
  return { rows, planned, skipped };
}

/** The site's Category 15 category (lowest id when it has several). */
async function category15Of(siteId: number): Promise<number | null> {
  const rows: any[] = await AppDataSource.query(
    `SELECT c.category_id FROM category c JOIN site_categories sc ON sc.category_id = c.category_id
      WHERE sc.site_id = $1 AND c.ghg_category = 15 ORDER BY c.category_id LIMIT 1`,
    [siteId],
  );
  return rows.length ? Number(rows[0].category_id) : null;
}

export async function planInvestments(companyId: number, user: TokenUser, body: unknown) {
  const parsed = PlanBodySchema.safeParse(body ?? {});
  if (!parsed.success) throw invalid(parsed.error);
  const { site_id, year, year_type, threshold_pct } = parsed.data;
  const site: any[] = await AppDataSource.query(`SELECT site_id FROM site WHERE site_id = $1 AND company_id = $2`, [site_id, companyId]);
  if (!site.length) throw new BoundaryError("SCOPE3_NOT_FOUND");
  const category_id = await category15Of(site_id);
  if (category_id === null) {
    throw new BoundaryError("SCOPE3_VALIDATION", { field: "site_id", reason: "CATEGORY_15_NOT_ASSIGNED" });
  }
  const period = { kind: "yearly" as const, year_type, year };
  const stored = toStoredPeriod(period, category_id);
  if (!stored.ok) throw new BoundaryError("SCOPE3_VALIDATION", { field: "year", message: stored.message });

  // The form and this year's identity factor (factor year = reporting year − 1).
  await ensureAssetForm(AppDataSource.manager, site_id, category_id, 15, [targetYearFor(stored.period.date_of_reporting)]);

  const investments = await listInvestments(companyId, year);
  const { rows, planned, skipped } = investmentRows(investments, site_id, category_id, period, threshold_pct ?? 0);
  if (!rows.length) return { plan: null, planned, skipped, threshold_pct: threshold_pct ?? 0 };

  const plan = await createPlan(
    user,
    { source_name: `Category 15 investments ${year_type} ${year}`, channel: "bulk_upload", company_id: companyId, rows },
    new Set(),
  );
  return { plan, planned, skipped, threshold_pct: threshold_pct ?? 0 };
}
