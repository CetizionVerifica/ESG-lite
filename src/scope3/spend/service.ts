/**
 * S3-5 · the read endpoints for rates and deflators, the Superadmin deflator
 * upload, and the USEEIO library (list and copy to a site). The calculation
 * itself stays in emissionWrite/methods/spend.ts.
 */
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import type { EmissionFactor } from "../../entities/EmissionFactor";
import { UserRole } from "../../types/type";
import { accessibleSiteIds } from "../../utils/companyScope";
import { BoundaryError } from "../boundary/errors";
import { Scope3Error } from "../contracts/errors";
import { PriceDeflatorSchema } from "../contracts/schemas";
import { CURRENCY_NAMES, SUPPORTED_CURRENCIES, supportedCurrency } from "./currencies";
import { isoDay } from "./inputs";
import { SpendRateSource } from "./rates";

export interface TokenUser {
  userId: number;
  role: string;
}

const issuesOf = (issues: Array<{ path: PropertyKey[]; message: string; code: string }>) =>
  issues.slice(0, 20).map((i) => ({ field: i.path.map(String).join("."), code: i.code, message: i.message }));

/** GET /fx-rates/currencies: what the Currency select offers. */
export const listCurrencies = () => ({ currencies: SUPPORTED_CURRENCIES.map((code) => ({ code, name: CURRENCY_NAMES[code] })) });

const RateQuerySchema = z.object({
  currency: z.string(),
  date: z.string(),
  to: z.string().optional(),
  price_year: z.coerce.number().int().min(1990).max(2100).optional(),
});

/**
 * GET /fx-rates?currency=INR&date=2026-09-03[&to=USD&price_year=2022]: the
 * rate a spend row of that currency and day would use, and the deflator to
 * `price_year` prices, as the engine looks them up. Read only.
 */
export async function rateFor(query: unknown) {
  const parsed = RateQuerySchema.safeParse(query ?? {});
  if (!parsed.success) throw new BoundaryError("SCOPE3_VALIDATION", { issues: issuesOf(parsed.error.issues) });
  const date = isoDay(parsed.data.date);
  if (!date) throw new BoundaryError("SCOPE3_VALIDATION", { field: "date", message: "date must be YYYY-MM-DD" });
  const currency = supportedCurrency(parsed.data.currency);
  const to = supportedCurrency(parsed.data.to ?? "USD");
  if (!currency || !to) throw new Scope3Error("CURRENCY_NOT_SUPPORTED", { field: !currency ? "currency" : "to", supported: SUPPORTED_CURRENCIES });
  const factor = { factor_type: "eeio_spend", price_currency: to, denominator_unit: to, price_base_year: parsed.data.price_year ?? null, emission_category_name: to } as unknown as EmissionFactor;
  const quoted = await new SpendRateSource(AppDataSource.manager).quote({ amount: 1, currency, spend_date: date, amount_from: "spent_value" }, factor);
  if (!quoted.ok) throw new Scope3Error("CURRENCY_NOT_SUPPORTED", { field: quoted.field }, quoted.message);
  const { fx, fallback, deflator, noDeflator } = quoted.quote;
  return {
    currency: fx.currency,
    to: fx.to,
    date,
    rate: fx.rate,
    as_of: fx.as_of,
    source: fx.source,
    fallback,
    deflator,
    no_deflator: noDeflator,
  };
}

/** GET /scope3/deflators[?country=US]: the stored series. */
export async function listDeflators(query: { country?: unknown }) {
  const country = typeof query.country === "string" && query.country.trim() ? query.country.trim().toUpperCase() : null;
  const rows: Array<{ country: string; year: number; index: string; source: string }> = await AppDataSource.query(
    `SELECT country, year, "index", source FROM price_deflator ${country ? "WHERE country = $1" : ""} ORDER BY country, year`,
    country ? [country] : [],
  );
  return { deflators: rows.map((r) => ({ country: r.country, year: Number(r.year), index: Number(r.index), source: r.source })) };
}

const DeflatorUploadSchema = z.object({
  country: z.string().transform((v) => v.trim().toUpperCase()),
  source: z.string().trim().min(1).max(100),
  values: z.array(z.object({ year: z.number().int(), index: z.number() })).min(1).max(200),
});

/** POST /scope3/deflators (Superadmin): adds or corrects one country's yearly series. */
export async function uploadDeflators(user: TokenUser, raw: unknown) {
  if (user.role !== UserRole.SUPERADMIN) throw new BoundaryError("SCOPE3_FORBIDDEN");
  const parsed = DeflatorUploadSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new BoundaryError("SCOPE3_VALIDATION", { issues: issuesOf(parsed.error.issues) });
  const { country, source, values } = parsed.data;
  for (const [i, v] of values.entries()) {
    const row = PriceDeflatorSchema.safeParse({ country, year: v.year, index: v.index, source });
    if (!row.success) throw new BoundaryError("SCOPE3_VALIDATION", { issues: issuesOf(row.error.issues).map((x) => ({ ...x, field: `values.${i}.${x.field}` })) });
  }
  if (new Set(values.map((v) => v.year)).size !== values.length) throw new BoundaryError("SCOPE3_VALIDATION", { field: "values", message: "Each year once." });
  await AppDataSource.transaction(async (m) => {
    for (const v of values) {
      await m.query(
        `INSERT INTO price_deflator (country, year, "index", source) VALUES ($1, $2, $3, $4)
         ON CONFLICT (country, year) DO UPDATE SET "index" = EXCLUDED."index", source = EXCLUDED.source`,
        [country, v.year, v.index, source],
      );
    }
  });
  console.log(`[spend] Deflators saved: ${values.length} year(s) for ${country} by user ${user.userId}`);
  return listDeflators({ country });
}

// ── USEEIO library (D3) ──────────────────────────────────────────────────────

/** Library rows: spend factors with no site (seeded by seed:scope3-useeio). */
export async function listLibrary(query: { q?: unknown; limit?: unknown }) {
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const rows: any[] = await AppDataSource.query(
    `SELECT emission_factor_id, emission_category_name, factor_value, denominator_unit, year, price_base_year, price_currency, dataset, dataset_version, geography, source
       FROM emission_factors
      WHERE site_id IS NULL AND factor_type = 'eeio_spend' ${q ? "AND emission_category_name ILIKE $2" : ""}
      ORDER BY emission_category_name
      LIMIT $1`,
    q ? [limit, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`] : [limit],
  );
  return {
    factors: rows.map((r) => ({
      emission_factor_id: Number(r.emission_factor_id),
      name: r.emission_category_name,
      factor_value: String(r.factor_value),
      unit: r.denominator_unit,
      price_base_year: r.price_base_year == null ? null : Number(r.price_base_year),
      price_currency: r.price_currency,
      dataset: r.dataset,
      dataset_version: r.dataset_version,
      geography: r.geography,
      source: r.source,
    })),
  };
}

const CopySchema = z.object({
  site_id: z.number().int().positive(),
  category_id: z.number().int().positive(),
  factor_ids: z.array(z.number().int().positive()).min(1).max(500),
  /** The factor year the copies get; defaults to last year, the factor year this year's rows look up first (targetYearFor). Prices stay at the base year. */
  year: z.number().int().min(2000).max(2100).optional(),
});

const COPY_ROLES = new Set<string>([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN]);

/**
 * POST /scope3/spend/library/copy: copies library sectors to one of the
 * caller's site × category pairs (the engine reads a site's own factors
 * only). Existing names for that year are left alone. Manager and above, own sites.
 */
export async function copyLibrary(companyId: number, user: TokenUser, raw: unknown) {
  if (!COPY_ROLES.has(user.role)) throw new BoundaryError("SCOPE3_FORBIDDEN");
  const parsed = CopySchema.safeParse(raw ?? {});
  if (!parsed.success) throw new BoundaryError("SCOPE3_VALIDATION", { issues: issuesOf(parsed.error.issues) });
  const { site_id, category_id, factor_ids } = parsed.data;
  // The factor year this year's rows look up first (reporting year − 1, targetYearFor).
  const year = parsed.data.year ?? new Date().getUTCFullYear() - 1;

  const site: any[] = await AppDataSource.query(`SELECT 1 FROM site WHERE site_id = $1 AND company_id = $2`, [site_id, companyId]);
  if (!site.length) throw new BoundaryError("SCOPE3_NOT_FOUND");
  const allowed = await accessibleSiteIds(user.userId, user.role);
  if (allowed && !allowed.has(site_id)) throw new BoundaryError("SCOPE3_NOT_FOUND");
  const assigned: any[] = await AppDataSource.query(
    `SELECT 1 FROM site_categories sc JOIN category c ON c.category_id = sc.category_id WHERE sc.site_id = $1 AND sc.category_id = $2 AND c.scope = 'Scope 3'`,
    [site_id, category_id],
  );
  if (!assigned.length) throw new BoundaryError("SCOPE3_VALIDATION", { field: "category_id", reason: "SCOPE3_CATEGORY_NOT_ASSIGNED" });

  const inserted: any[] = await AppDataSource.query(
    `INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name,
                                   factor_type, gwp_set, geography, dataset, dataset_version, co2_kg, ch4_kg, n2o_kg, other_kgco2e, biogenic_co2_kg,
                                   includes_wtt, price_base_year, price_currency)
     SELECT $1, $2, $3, f.factor_value, f.denominator_unit, f.source, f.emission_category_name, f.global_category_name,
            f.factor_type, f.gwp_set, f.geography, f.dataset, f.dataset_version, f.co2_kg, f.ch4_kg, f.n2o_kg, f.other_kgco2e, f.biogenic_co2_kg,
            f.includes_wtt, f.price_base_year, f.price_currency
       FROM emission_factors f
      WHERE f.site_id IS NULL AND f.factor_type = 'eeio_spend' AND f.emission_factor_id = ANY($4::int[])
        AND NOT EXISTS (SELECT 1 FROM emission_factors e
                         WHERE e.site_id = $1 AND e.category_id = $2 AND e.year = $3 AND e.emission_category_name = f.emission_category_name)
     RETURNING emission_factor_id`,
    [site_id, category_id, year, factor_ids],
  );
  console.log(`[spend] Library copy: ${inserted.length} of ${factor_ids.length} factor(s) to site ${site_id} category ${category_id} by user ${user.userId}`);
  return { copied: inserted.length, skipped: factor_ids.length - inserted.length, year };
}
