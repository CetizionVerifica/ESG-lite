/**
 * S3-10 · product sales, use profiles and the Category 10 / 11 / 12 plans.
 *
 *   - sales (`product_sale`): what was sold per product and month, entered or
 *     imported from CSV (≤ 5,000 rows; a row for the same product, month, unit
 *     and region replaces the earlier quantity);
 *   - the use profile on `product`: lifetime uses, end-of-life mix, and the
 *     stand-in `use_profile` (packaging per unit, how the product is used);
 *   - the plan: one import plan per site, year and category (channel
 *     bulk_upload), rows from rows.ts. The engine calculates every row;
 *     nothing here multiplies a quantity by a factor.
 *
 * Roles: Manager and above, for the products on their own sites (Admin and
 * Superadmin: every site of the company); a User gets 403. Every query filters
 * by the company id access.ts resolved; a product or site of another company,
 * or outside the caller's sites, is 404. Use-profile changes write audit_log
 * rows (entity_type scope3_use_profile). Logs carry ids only.
 */
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import { accessibleSiteIds } from "../../utils/companyScope";
import { createPlan } from "../../imports/plans/service";
import type { TokenUser } from "../../imports/plans/scope";
import { type StoredPeriod, toStoredPeriod } from "../../services/emissionWrite/period";
import type { ImportRow } from "../../imports/contracts";
import type { CalculationSpec } from "../../entities/ColumnConfig";
import { specIdentityMatches } from "../../services/calculationSpec";
import type { Queryable } from "../taxonomy/service";
import { BoundaryError } from "../boundary/errors";
import { bomsFor, massKg } from "./bom";
import { SOLD_PRODUCT_CATEGORIES, type SoldProductCategory, USE_METHODS, USE_OPTIONS } from "./configs";
import { ensureSoldProductForm } from "./forms";
import { type SoldProduct, monthOf, soldProductRows, withoutImported, yearWindow } from "./rows";
import {
  EOL_TREATMENTS,
  PostSalesBodySchema,
  PutSaleBodySchema,
  PutUseProfileBodySchema,
  SoldProductsPlanBodySchema,
  type UseProfileExtra,
} from "./schemas";

const ROLES = new Set<string>([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN]);

export function assertRole(user: TokenUser) {
  if (!ROLES.has(user.role)) throw new BoundaryError("SCOPE3_FORBIDDEN");
}

/** Validation issues without input values (product names and quantities stay out of responses' details and logs). */
const invalid = (err: z.ZodError) =>
  new BoundaryError("SCOPE3_VALIDATION", { issues: err.issues.slice(0, 20).map((i) => ({ field: i.path.map(String).join("."), code: i.code, message: i.message })) });

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The caller's sites of the company: every site for Admin and Superadmin, their own for a Manager. */
async function allowedSites(companyId: number, user: TokenUser, q: Queryable = AppDataSource): Promise<Array<{ site_id: number; name: string }>> {
  const rows: any[] = await q.query(`SELECT site_id, name FROM site WHERE company_id = $1 ORDER BY name, site_id`, [companyId]);
  const allowed = await accessibleSiteIds(user.userId, user.role);
  return rows.filter((r) => !allowed || allowed.has(Number(r.site_id))).map((r) => ({ site_id: Number(r.site_id), name: String(r.name) }));
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductView extends SoldProduct {
  site_id: number;
  site_name: string;
  unit: string;
  declared_unit: string | null;
}

const productView = (r: any): ProductView => ({
  product_id: Number(r.product_id),
  name: String(r.name),
  unit: String(r.unit ?? ""),
  declared_unit: r.declared_unit ?? null,
  site_id: Number(r.site_id),
  site_name: String(r.site_name ?? ""),
  mass_per_unit_kg: numOrNull(r.mass_per_unit_kg),
  lifetime_uses: numOrNull(r.lifetime_uses),
  eol_mix: r.eol_mix ?? null,
  use_profile: r.use_profile ?? null,
});

async function productsFor(companyId: number, siteIds: number[], q: Queryable = AppDataSource): Promise<ProductView[]> {
  if (!siteIds.length) return [];
  const rows: any[] = await q.query(
    `SELECT p.product_id, p.name, p.unit, p.declared_unit, p.mass_per_unit_kg, p.lifetime_uses, p.eol_mix, p.use_profile, p.site_id, s.name AS site_name
       FROM product p JOIN site s ON s.site_id = p.site_id
      WHERE s.company_id = $1 AND p.site_id = ANY($2::int[])
      ORDER BY p.name, p.product_id`,
    [companyId, siteIds],
  );
  return rows.map(productView);
}

/** One product of the company on one of the caller's sites, or 404. */
async function productOf(companyId: number, user: TokenUser, productId: number, q: Queryable = AppDataSource, lock = false): Promise<ProductView> {
  if (!Number.isInteger(productId) || productId <= 0) throw new BoundaryError("SCOPE3_NOT_FOUND");
  const rows: any[] = await q.query(
    `SELECT p.product_id, p.name, p.unit, p.declared_unit, p.mass_per_unit_kg, p.lifetime_uses, p.eol_mix, p.use_profile, p.site_id, s.name AS site_name
       FROM product p JOIN site s ON s.site_id = p.site_id
      WHERE p.product_id = $1 AND s.company_id = $2${lock ? " FOR UPDATE OF p" : ""}`,
    [productId, companyId],
  );
  if (!rows.length) throw new BoundaryError("SCOPE3_NOT_FOUND");
  const allowed = await accessibleSiteIds(user.userId, user.role);
  if (allowed && !allowed.has(Number(rows[0].site_id))) throw new BoundaryError("SCOPE3_NOT_FOUND");
  return productView(rows[0]);
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

const dateText = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export interface SaleView {
  id: number;
  product_id: number;
  product: string;
  site_id: number;
  period: string;
  quantity: number;
  unit: string;
  region: string | null;
  /** kg sold: the quantity in a mass unit, or quantity × mass per unit; null when unknown. Packaging excluded. */
  mass_kg: number | null;
}

const saleView = (r: any): SaleView => {
  const quantity = Number(r.quantity);
  const perUnit = numOrNull(r.mass_per_unit_kg);
  const kg = massKg(quantity, r.unit);
  return {
    id: Number(r.id),
    product_id: Number(r.product_id),
    product: String(r.product_name ?? ""),
    site_id: Number(r.site_id),
    period: dateText(r.period),
    quantity,
    unit: String(r.unit),
    region: r.region ?? null,
    mass_kg: kg !== null ? kg : perUnit !== null ? Number((quantity * perUnit).toFixed(4)) : null,
  };
};

const SALE_SELECT = `SELECT ps.id, ps.product_id, ps.period, ps.quantity, ps.unit, ps.region, p.name AS product_name, p.site_id, p.mass_per_unit_kg
       FROM product_sale ps JOIN product p ON p.product_id = ps.product_id JOIN site s ON s.site_id = p.site_id`;

async function salesIn(companyId: number, siteIds: number[], window: { from: string; to: string }, q: Queryable = AppDataSource): Promise<SaleView[]> {
  if (!siteIds.length) return [];
  const rows: any[] = await q.query(
    `${SALE_SELECT}
      WHERE ps.company_id = $1 AND s.company_id = $1 AND p.site_id = ANY($2::int[]) AND ps.period >= $3 AND ps.period <= $4
      ORDER BY p.name, ps.period, ps.id`,
    [companyId, siteIds, window.from, window.to],
  );
  return rows.map(saleView);
}

export interface ListQuery {
  year?: unknown;
  year_type?: unknown;
  site_id?: unknown;
}

/**
 * GET /scope3/product-sales?year=&year_type=&site_id=: the year's sales, the
 * products they can be entered for (with their use profile and mass), and the
 * caller's sites with their Category 10, 11 and 12 categories (for the plan).
 */
export async function listSales(companyId: number, user: TokenUser, query: ListQuery) {
  assertRole(user);
  const year = query.year === undefined || query.year === "" ? new Date().getUTCFullYear() : Number(query.year);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) throw new BoundaryError("SCOPE3_VALIDATION", { field: "year" });
  const yearType = query.year_type === "FY" ? "FY" : "CY";
  const sites = await allowedSites(companyId, user);
  let siteIds = sites.map((s) => s.site_id);
  if (query.site_id !== undefined && query.site_id !== "") {
    const id = Number(query.site_id);
    if (!siteIds.includes(id)) throw new BoundaryError("SCOPE3_NOT_FOUND");
    siteIds = [id];
  }
  const cats: any[] = siteIds.length
    ? await AppDataSource.query(
        `SELECT sc.site_id, c.ghg_category AS n, MIN(c.category_id) AS category_id
           FROM site_categories sc JOIN category c ON c.category_id = sc.category_id
          WHERE sc.site_id = ANY($1::int[]) AND c.ghg_category IN (10, 11, 12)
          GROUP BY sc.site_id, c.ghg_category`,
        [sites.map((s) => s.site_id)],
      )
    : [];
  const categoriesOf = (site_id: number) =>
    Object.fromEntries(SOLD_PRODUCT_CATEGORIES.map((n) => [n, Number(cats.find((c) => Number(c.site_id) === site_id && Number(c.n) === n)?.category_id) || null]));
  return {
    company_id: companyId,
    year,
    year_type: yearType,
    sites: sites.map((s) => ({ ...s, categories: categoriesOf(s.site_id) })),
    products: await productsFor(companyId, siteIds),
    sales: await salesIn(companyId, siteIds, yearWindow(year, yearType)),
  };
}

/** POST /scope3/product-sales `{sales: [...]}` (or one sale): upsert by product, month, unit and region. */
export async function createSales(companyId: number, user: TokenUser, raw: unknown) {
  assertRole(user);
  const body = raw && typeof raw === "object" && !Array.isArray(raw) && !("sales" in raw) ? { sales: [raw] } : raw;
  const parsed = PostSalesBodySchema.safeParse(body ?? {});
  if (!parsed.success) throw invalid(parsed.error);
  const sales = parsed.data.sales.map((s, i) => {
    const period = monthOf(s.period);
    if (!period) throw new BoundaryError("SCOPE3_VALIDATION", { issues: [{ field: `sales.${i}.period`, code: "invalid_date", message: "Not a real month." }] });
    return { ...s, period, unit: s.unit.trim(), region: s.region?.trim() || null };
  });

  // Every product must be the company's, on one of the caller's sites (else 404, as for one product).
  const productIds = [...new Set(sales.map((s) => s.product_id))];
  const siteIds = (await allowedSites(companyId, user)).map((s) => s.site_id);
  const found: any[] = siteIds.length
    ? await AppDataSource.query(
        `SELECT p.product_id FROM product p JOIN site s ON s.site_id = p.site_id WHERE s.company_id = $1 AND p.product_id = ANY($2::int[]) AND p.site_id = ANY($3::int[])`,
        [companyId, productIds, siteIds],
      )
    : [];
  if (found.length !== productIds.length) throw new BoundaryError("SCOPE3_NOT_FOUND");

  const key = (s: { product_id: number; period: string; unit: string; region: string | null }) =>
    `${s.product_id}|${s.period}|${s.unit.toLowerCase()}|${(s.region ?? "").toLowerCase()}`;
  return AppDataSource.transaction(async (m) => {
    await m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`s3-10-sales:${companyId}`]);
    const existing: any[] = await m.query(
      `SELECT id, product_id, period, unit, region, quantity FROM product_sale WHERE company_id = $1 AND product_id = ANY($2::int[])`,
      [companyId, productIds],
    );
    const byKey = new Map(existing.map((r) => [key({ product_id: Number(r.product_id), period: dateText(r.period), unit: String(r.unit), region: r.region ?? null }), r]));
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const s of sales) {
      const hit = byKey.get(key(s));
      if (hit) {
        if (Number(hit.quantity) === s.quantity) {
          unchanged++;
          continue;
        }
        await m.query(`UPDATE product_sale SET quantity = $1, updated_by = $2, updated_at = now() WHERE id = $3 AND company_id = $4`, [s.quantity, user.userId || null, hit.id, companyId]);
        hit.quantity = s.quantity;
        updated++;
        continue;
      }
      const [row]: any[] = await m.query(
        `INSERT INTO product_sale (company_id, product_id, period, quantity, unit, region, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id, product_id, period, unit, region, quantity`,
        [companyId, s.product_id, s.period, s.quantity, s.unit, s.region, user.userId || null],
      );
      byKey.set(key(s), row);
      created++;
    }
    return { created, updated, unchanged };
  });
}

/** PUT /scope3/product-sales/:id `{period?, quantity?, unit?, region?}`. */
export async function updateSale(companyId: number, user: TokenUser, id: number, raw: unknown) {
  assertRole(user);
  if (!Number.isInteger(id) || id <= 0) throw new BoundaryError("SCOPE3_NOT_FOUND");
  const parsed = PutSaleBodySchema.safeParse(raw ?? {});
  if (!parsed.success) throw invalid(parsed.error);
  const d = parsed.data;
  const period = d.period === undefined ? undefined : monthOf(d.period);
  if (period === null) throw new BoundaryError("SCOPE3_VALIDATION", { issues: [{ field: "period", code: "invalid_date", message: "Not a real month." }] });
  return AppDataSource.transaction(async (m) => {
    const rows: any[] = await m.query(`${SALE_SELECT} WHERE ps.id = $1 AND ps.company_id = $2 AND s.company_id = $2 FOR UPDATE OF ps`, [id, companyId]);
    if (!rows.length) throw new BoundaryError("SCOPE3_NOT_FOUND");
    const allowed = await accessibleSiteIds(user.userId, user.role);
    if (allowed && !allowed.has(Number(rows[0].site_id))) throw new BoundaryError("SCOPE3_NOT_FOUND");
    const r = rows[0];
    const next = {
      period: period ?? dateText(r.period),
      quantity: d.quantity ?? Number(r.quantity),
      unit: d.unit?.trim() ?? r.unit,
      region: d.region === undefined ? r.region : d.region?.trim() || null,
    };
    await m.query(`UPDATE product_sale SET period = $1, quantity = $2, unit = $3, region = $4, updated_by = $5, updated_at = now() WHERE id = $6 AND company_id = $7`, [
      next.period,
      next.quantity,
      next.unit,
      next.region,
      user.userId || null,
      id,
      companyId,
    ]);
    return saleView({ ...r, ...next });
  });
}

// ---------------------------------------------------------------------------
// Use profile
// ---------------------------------------------------------------------------

const SHARE_EPS = 1e-6;

function checkProfile(body: z.infer<typeof PutUseProfileBodySchema>) {
  const issues: Array<{ field: string; code: string; message: string }> = [];
  const mix = body.eol_mix;
  if (mix) {
    const seen = new Set<string>();
    mix.forEach((x, i) => {
      if (!(EOL_TREATMENTS as readonly string[]).includes(x.treatment)) issues.push({ field: `eol_mix.${i}.treatment`, code: "invalid_value", message: `Use one of ${EOL_TREATMENTS.join(", ")}.` });
      if (seen.has(x.treatment)) issues.push({ field: `eol_mix.${i}.treatment`, code: "duplicate", message: "Each treatment once." });
      seen.add(x.treatment);
    });
    if (Math.abs(mix.reduce((s, x) => s + x.share, 0) - 1) > SHARE_EPS) issues.push({ field: "eol_mix", code: "custom", message: "Treatment shares must add up to 100 %." });
  }
  const u = body.use_profile;
  if (u?.use_type && u.use_type !== "intermediate" && u.use_option && !USE_OPTIONS[USE_METHODS[u.use_type]].includes(u.use_option)) {
    issues.push({ field: "use_profile.use_option", code: "invalid_value", message: `Use one of ${USE_OPTIONS[USE_METHODS[u.use_type]].join(", ")}.` });
  }
  if (issues.length) throw new BoundaryError("SCOPE3_VALIDATION", { issues });
}

/** PUT /scope3/products/:id/use-profile `{lifetime_uses?, eol_mix?, use_profile?}`: given keys replace, others stay. */
export async function putUseProfile(companyId: number, user: TokenUser, productId: number, raw: unknown) {
  assertRole(user);
  const parsed = PutUseProfileBodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    // The contract's "shares add up to 1" refinement reads as the same 100 % message.
    throw invalid(parsed.error);
  }
  checkProfile(parsed.data);
  return AppDataSource.transaction(async (m) => {
    const before = await productOf(companyId, user, productId, m, true);
    const d = parsed.data;
    const next = {
      lifetime_uses: d.lifetime_uses === undefined ? before.lifetime_uses : d.lifetime_uses,
      eol_mix: d.eol_mix === undefined ? before.eol_mix : d.eol_mix,
      use_profile: d.use_profile === undefined ? before.use_profile : (d.use_profile as UseProfileExtra | null),
    };
    const changed: Record<string, { old: unknown; new: unknown }> = {};
    for (const k of ["lifetime_uses", "eol_mix", "use_profile"] as const) {
      if (JSON.stringify(before[k] ?? null) !== JSON.stringify(next[k] ?? null)) changed[k] = { old: before[k] ?? null, new: next[k] ?? null };
    }
    if (Object.keys(changed).length) {
      await m.query(`UPDATE product SET lifetime_uses = $1, eol_mix = $2, use_profile = $3 WHERE product_id = $4`, [
        next.lifetime_uses,
        next.eol_mix === null ? null : JSON.stringify(next.eol_mix),
        next.use_profile === null ? null : JSON.stringify(next.use_profile),
        productId,
      ]);
      await m.query(
        `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('scope3_use_profile', $1, 'update', $2, NULL, $3)`,
        [productId, JSON.stringify(changed), user.userId || null],
      );
    }
    return { ...before, ...next };
  });
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/** The site's Category n category (lowest id when it has several). */
async function categoryOf(siteId: number, n: SoldProductCategory): Promise<number | null> {
  const rows: any[] = await AppDataSource.query(
    `SELECT c.category_id FROM category c JOIN site_categories sc ON sc.category_id = c.category_id
      WHERE sc.site_id = $1 AND c.ghg_category = $2 ORDER BY c.category_id LIMIT 1`,
    [siteId, n],
  );
  return rows.length ? Number(rows[0].category_id) : null;
}

/**
 * The year's saved rows on the site's standard form, as a test for plan rows:
 * same activity (the form's mapping of the row's label chain) and same identity
 * (product name). Any status counts, as emissionWrite's monthly duplicate check.
 */
async function importedRows(site_id: number, category_id: number, period: StoredPeriod): Promise<(row: ImportRow) => boolean> {
  const saved: Array<{ activity_data: Record<string, unknown> | null }> = await AppDataSource.query(
    `SELECT activity_data FROM emission WHERE site_id = $1 AND category_id = $2 AND reporting_period = 'yearly' AND date_of_reporting = $3`,
    [site_id, category_id, period.date_of_reporting],
  );
  if (!saved.length) return () => false;
  const [config]: Array<{ emission_category_mapping: Record<string, string> | null; calculation: CalculationSpec | null }> = await AppDataSource.query(
    `SELECT emission_category_mapping, calculation FROM column_config WHERE site_id = $1 AND category_id = $2 ORDER BY config_name LIMIT 1`,
    [site_id, category_id],
  );
  const mapping = config?.emission_category_mapping ?? {};
  const spec = config?.calculation ?? null;
  return (row) => {
    const data = { ...row.fields, emission_category: mapping[row.activity_name ?? ""] ?? row.activity_name };
    return saved.some((e) => e.activity_data?.emission_category === data.emission_category && (!spec || specIdentityMatches(spec, data, e.activity_data)));
  };
}

/** POST /scope3/sold-products/plan `{site_id, year, year_type, ghg_category}` → an import plan. */
export async function planSoldProducts(companyId: number, user: TokenUser, raw: unknown) {
  assertRole(user);
  const parsed = SoldProductsPlanBodySchema.safeParse(raw ?? {});
  if (!parsed.success) throw invalid(parsed.error);
  const { site_id, year, year_type, ghg_category: n } = parsed.data;

  const site: any[] = await AppDataSource.query(`SELECT site_id FROM site WHERE site_id = $1 AND company_id = $2`, [site_id, companyId]);
  if (!site.length) throw new BoundaryError("SCOPE3_NOT_FOUND");
  const allowed = await accessibleSiteIds(user.userId, user.role);
  if (allowed && !allowed.has(site_id)) throw new BoundaryError("SCOPE3_NOT_FOUND");

  const category_id = await categoryOf(site_id, n);
  if (category_id === null) throw new BoundaryError("SCOPE3_VALIDATION", { field: "site_id", reason: `CATEGORY_${n}_NOT_ASSIGNED` });
  const period = { kind: "yearly" as const, year_type, year };
  const stored = toStoredPeriod(period, category_id);
  if (!stored.ok) throw new BoundaryError("SCOPE3_VALIDATION", { field: "year", message: stored.message });

  // The standard form must be the site's form: the plan rows use its fields.
  const form = await AppDataSource.transaction((m) => ensureSoldProductForm(m, site_id, category_id, n));
  if (form.config === "customised") throw new BoundaryError("SCOPE3_VALIDATION", { field: "site_id", reason: "SOLD_PRODUCTS_FORM_CUSTOMISED" });
  if (form.config === "has_entries") throw new BoundaryError("SCOPE3_VALIDATION", { field: "site_id", reason: "SOLD_PRODUCTS_HAS_ENTRIES" });

  const products = await productsFor(companyId, [site_id]);
  const sales = await salesIn(companyId, [site_id], yearWindow(year, year_type));
  const boms = n === 12 ? await bomsFor(companyId, [...new Set(sales.map((s) => s.product_id))]) : new Map();
  const built = soldProductRows(n, products, sales, boms, { site_id, category_id, period });
  const { rows, planned, skipped } = withoutImported(built, await importedRows(site_id, category_id, stored.period));
  const sold = new Set(sales.map((s) => s.product_id)).size;
  if (!rows.length) return { plan: null, planned, skipped, products_sold: sold };

  const plan = await createPlan(
    user,
    { source_name: `Category ${n} sold products ${year_type} ${year}`, channel: "bulk_upload", company_id: companyId, rows },
    new Set(),
  );
  return { plan, planned, skipped, products_sold: sold };
}

