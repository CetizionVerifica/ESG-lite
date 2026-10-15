/**
 * S3-2 · factor metadata: validation on create/update/bulk upload, the
 * FACTOR_TYPE_MISMATCH warning, and the snapshot fields new emission rows
 * store. Spec: src/scope3/contracts/factor.CLAUDE.md.
 */
import { z } from "zod";
import { ALLOWED_FACTOR_TYPES, DEFAULT_GWP_SET, FACTOR_TYPES, GWP_SETS, type FactorType } from "../contracts/factor";
import type { EmissionFactor } from "../../entities/EmissionFactor";

/** §7 codes this module raises (S3-0 lists them in contracts/errors.ts). */
export const UNIT_REQUIRED = "UNIT_REQUIRED";
export const FACTOR_TYPE_MISMATCH = "FACTOR_TYPE_MISMATCH";

// A decimal that fits numeric(18,8): up to 10 integer digits and 8 decimals,
// zero or more. Sent as a string to keep every digit; a number is accepted too.
const DECIMAL = /^\d{1,10}(\.\d{1,8})?$/;
const decimal = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? numberText(v) : v.trim()))
  .refine((v) => v !== null && DECIMAL.test(v), "must be a number of 0 or more with at most 8 decimals")
  .transform((v) => v as string);

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

/** The metadata fields a factor body may carry. Each is optional; null clears it. */
export const factorMetaSchema = z.object({
  factor_type: z.enum(FACTOR_TYPES).nullable().optional(),
  gwp_set: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.enum(GWP_SETS))
    .nullable()
    .optional(),
  // ISO-3166 alpha-2, GLO, or a region code ("EU27", "US-CA").
  geography: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,15}$/, "must be a country code, GLO or a region code"))
    .nullable()
    .optional(),
  dataset: text(60).nullable().optional(),
  dataset_version: text(40).nullable().optional(),
  co2_kg: decimal.nullable().optional(),
  ch4_kg: decimal.nullable().optional(),
  n2o_kg: decimal.nullable().optional(),
  other_kgco2e: decimal.nullable().optional(),
  biogenic_co2_kg: decimal.nullable().optional(),
  includes_wtt: z.boolean().optional(),
  price_base_year: z.number().int().min(1990).max(2100).nullable().optional(),
  price_currency: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{3}$/, "must be a 3-letter currency code"))
    .nullable()
    .optional(),
});
export type FactorMeta = z.output<typeof factorMetaSchema>;
export const FACTOR_META_FIELDS = Object.keys(factorMetaSchema.shape) as (keyof FactorMeta)[];

export type MetaResult = { ok: true; meta: FactorMeta } | { ok: false; message: string; field: string };

/** Reads the metadata fields of a request body; unknown keys are ignored. */
export function parseFactorMeta(body: unknown): MetaResult {
  const picked: Record<string, unknown> = {};
  if (body && typeof body === "object") {
    for (const k of FACTOR_META_FIELDS) if (k in body) picked[k] = (body as Record<string, unknown>)[k];
  }
  const parsed = factorMetaSchema.safeParse(picked);
  if (parsed.success) return { ok: true, meta: parsed.data };
  const issue = parsed.error.issues[0];
  const field = String(issue.path[0] ?? "body");
  return { ok: false, field, message: `${field} ${issue.message}`.trim() };
}

/** D7: a new factor (create or bulk) with no GWP set given starts on AR6. Update leaves it alone. */
export function withNewFactorDefaults(meta: FactorMeta): FactorMeta {
  return meta.gwp_set === undefined ? { ...meta, gwp_set: DEFAULT_GWP_SET } : meta;
}

/**
 * S3-0's rule (FactorMetadataSchema): a spend (EEIO) factor needs its price
 * base year and currency. Checked on the factor as it will be stored.
 */
export function eeioPriceProblem(f: { factor_type?: string | null; price_base_year?: number | null; price_currency?: string | null }): MetaResult | null {
  if (f.factor_type !== "eeio_spend" || (f.price_base_year != null && f.price_currency != null)) return null;
  return { ok: false, field: "price_base_year", message: "A spend (EEIO) factor needs its price base year and currency." };
}

/** True when a denominator unit is missing or blank (UNIT_REQUIRED). */
export const unitMissing = (unit: unknown) => typeof unit !== "string" || unit.trim() === "";

/**
 * The category's GHG Protocol Scope 3 number. `category.ghg_category` arrives
 * with S3-1; until then every category reads as unnumbered and no
 * FACTOR_TYPE_MISMATCH is raised.
 */
export function ghgCategoryOf(category: object | null | undefined): number | null {
  const n = (category as { ghg_category?: number | null } | null | undefined)?.ghg_category;
  return typeof n === "number" ? n : null;
}

export type FactorWarning = { code: typeof FACTOR_TYPE_MISMATCH; message: string; details: { ghg_category: number; factor_type: FactorType; allowed: readonly FactorType[] } };

/** FACTOR_TYPE_MISMATCH when the type is outside the list for its category's number. Never blocks. */
export function factorTypeWarning(ghgCategory: number | null, factorType: FactorType | null | undefined): FactorWarning | null {
  if (ghgCategory === null || !factorType) return null;
  const allowed = ALLOWED_FACTOR_TYPES[ghgCategory as keyof typeof ALLOWED_FACTOR_TYPES];
  if (!allowed || allowed.includes(factorType)) return null;
  return {
    code: FACTOR_TYPE_MISMATCH,
    message: `A ${factorType} factor is unusual for Category ${ghgCategory}; expected ${allowed.join(", ")}.`,
    details: { ghg_category: ghgCategory, factor_type: factorType, allowed },
  };
}

/**
 * A stored decimal as text with at least 4 decimals and no trailing zeros
 * beyond them: "2680.00000000" → "2680.0000" (what numeric(10,4) gave, so
 * existing snapshots and the golden suite read the same), "0.00012345" kept.
 */
export function factorValueText(v: unknown): unknown {
  if (typeof v !== "string" || !/^-?\d+\.\d+$/.test(v)) return v;
  const [int, frac] = v.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return `${int}.${trimmed.padEnd(4, "0")}`;
}

/** A JS number as a plain decimal string (no exponent), or null when it can't be one. */
function numberText(n: number): string | null {
  if (!Number.isFinite(n) || n < 0) return null;
  const s = n.toFixed(8).replace(/\.?0+$/, "");
  return s === "" ? "0" : s;
}

/** The S3-2 fields of a factor snapshot (01-contracts §6). Absent values are left out. */
export function metaSnapshot(f: EmissionFactor) {
  const gases: Record<string, unknown> = {};
  for (const k of ["co2_kg", "ch4_kg", "n2o_kg", "other_kgco2e", "biogenic_co2_kg"] as const) {
    if (f[k] !== null && f[k] !== undefined) gases[k] = factorValueText(f[k]);
  }
  return {
    ...(f.factor_type ? { factor_type: f.factor_type } : {}),
    ...(f.gwp_set ? { gwp_set: f.gwp_set } : {}),
    ...(f.geography ? { geography: f.geography } : {}),
    ...(f.dataset ? { dataset: f.dataset } : {}),
    ...(f.dataset_version ? { dataset_version: f.dataset_version } : {}),
    ...(f.includes_wtt ? { includes_wtt: true } : {}),
    ...(Object.keys(gases).length ? { gases } : {}),
  };
}
