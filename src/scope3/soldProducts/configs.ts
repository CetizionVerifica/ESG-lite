/**
 * S3-10 · the standard data-entry forms for Category 10 (processing of sold
 * products), Category 11 (use of sold products) and Category 12 (end-of-life
 * treatment of sold products). Pure data, no database access; applied by
 * forms.ts (migrate:scope3-sold-product-forms and the sold-products plan).
 *
 * Category 10, per_method with method_column "@method" (the row's method picks the fields):
 *   site_specific  Quantity × Share for our product (%)     in the factor's unit (kWh, litre, kg)  formula 10.1
 *   average_data   Mass sold (kg) × processing factor per kg (factor_type process)                 formula 10.2
 *
 * Category 11, per_method on the "Method" select (the form seedUseOfSoldProducts.ts
 * wrote, kept as it is), plus the option "Part of a customer's product" (11.5):
 *   Product that uses energy      Units Sold × Energy per Use (kWh) × Lifetime Uses × grid factor   11.1
 *   Fuel sold to customers        Units Sold (litres) × combustion factor                          11.2
 *   Product containing gas        Units Sold × Gas per Product (kg) × % of Gas Released × GWP      11.3
 *   Part of a customer's product  Units Sold × Lifetime uses of final product × Share of final
 *                                 product (%) × factor per use of the final product               11.5
 *
 * Category 12, per_method "@method":
 *   waste_type_specific  Mass at end of life (kg) × Share treated this way (%) × factor per
 *                        material × treatment (recycling uses the cut-off factor)               formula 12.1
 *   average_data         Mass at end of life (kg) × average disposal factor for the material
 *
 * The selects pick the factor (emission_category_mapping, "label|label" chains).
 * Category 10 and the Category 11 "final product use" factors are the client's
 * own; the Category 12 names are the ones factors.ts carries.
 */
import { createHash } from "crypto";
import type { CalculationSpec, ColumnDependencies, DependentOptionsMap, EmissionCategoryMapping } from "../../entities/ColumnConfig";
import type { Method } from "../contracts/ghgCategory";
import { ROW_METHOD_COLUMN } from "../../services/calculationSpec";
import type { EolTreatment, UseType } from "./schemas";

export type SoldProductCategory = 10 | 11 | 12;
export const SOLD_PRODUCT_CATEGORIES: readonly SoldProductCategory[] = [10, 11, 12];

/** Written into `calculation.standard` so a later run knows the config is still the standard one. */
export const SOLD_PRODUCTS_STANDARD = "scope3-sold-products@1";
export const CONFIG_NAME_PREFIX = "Scope 3 sold products - Standard";

type Col = { name: string; type: "select" | "text" | "number" };
const num = (name: string): Col => ({ name, type: "number" });

// ── Category 10 ──────────────────────────────────────────────────────────────
export const COL_PROCESSING = "Processing activity";
export const COL_PRODUCT = "Product name";
export const COL_QUANTITY = "Quantity";
export const COL_SHARE_OURS = "Share for our product (%)";
export const COL_MASS_SOLD = "Mass sold (kg)";

export const PROCESSING_AVERAGE = "Processing, average [kg]";
/** Option label → factor name. The unit in brackets is the unit the row is entered in. */
export const PROCESSING_OPTIONS: Record<string, string> = {
  "Natural gas [kWh]": "Natural gas [kWh]",
  "Electricity [kWh]": "Electricity [kWh]",
  "Diesel [litre]": "Diesel [litre]",
  "Refrigerant leaked [kg]": "Refrigerant [kg]",
  "Waste [kg]": "Waste - Average [kg]",
  [PROCESSING_AVERAGE]: "Processing of sold products [kg]",
};

export const processingSpec = (): CalculationSpec & { standard: string } => ({
  mode: "per_method",
  method_column: ROW_METHOD_COLUMN,
  standard: SOLD_PRODUCTS_STANDARD,
  // Two products processed by customers in one year are two rows.
  identity_columns: [COL_PRODUCT],
  methods: {
    site_specific: { multiply: [COL_QUANTITY, COL_SHARE_OURS], percent: [COL_SHARE_OURS] },
    average_data: { multiply: [COL_MASS_SOLD], activity_unit: "kg" },
  },
});

// ── Category 11 ──────────────────────────────────────────────────────────────
// The form src/scripts/seedUseOfSoldProducts.ts writes (its exact content, so a
// config still in that state can be upgraded and a changed one is left alone).
export const LEGACY_USE_CONFIG_NAME = "Use of Sold Products - Standard";
export const COL_METHOD = "Method";
export const COL_PRODUCT_NAME = "Product Name";
export const COL_USE_OPTION = "Country / Fuel / Gas";
export const COL_UNITS_SOLD = "Units Sold";
export const COL_ENERGY_PER_USE = "Energy per Use (kWh)";
export const COL_LIFETIME_USES = "Lifetime Uses";
export const COL_GAS_PER_PRODUCT = "Gas per Product (kg)";
export const COL_GAS_RELEASED = "% of Gas Released";
// S3-10 additions (11.5).
export const COL_FINAL_USES = "Lifetime uses of final product";
export const COL_FINAL_SHARE = "Share of final product (%)";

export const METHOD_ENERGY = "Product that uses energy";
export const METHOD_FUEL = "Fuel sold to customers";
export const METHOD_GAS = "Product containing gas";
export const METHOD_PART = "Part of a customer's product";
export const FINAL_PRODUCT_USE = "Final product use";

export const LEGACY_USE_COLUMNS: Col[] = [
  { name: COL_METHOD, type: "select" },
  { name: COL_PRODUCT_NAME, type: "text" },
  { name: COL_USE_OPTION, type: "select" },
  num(COL_UNITS_SOLD),
  num(COL_ENERGY_PER_USE),
  num(COL_LIFETIME_USES),
  num(COL_GAS_PER_PRODUCT),
  num(COL_GAS_RELEASED),
];

const LEGACY_USE_OPTIONS: Record<string, string[]> = {
  [METHOD_ENERGY]: ["Germany", "Denmark", "Netherlands", "India"],
  [METHOD_FUEL]: ["Petrol", "Diesel"],
  [METHOD_GAS]: ["R134a", "R410A"],
};

export const LEGACY_USE_MAPPING: Record<string, string> = {
  [`${METHOD_ENERGY}|Germany`]: "Grid Mix Germany",
  [`${METHOD_ENERGY}|Denmark`]: "Grid Mix Denmark",
  [`${METHOD_ENERGY}|Netherlands`]: "Grid Mix Netherlands",
  [`${METHOD_ENERGY}|India`]: "Grid Mix India",
  [`${METHOD_FUEL}|Petrol`]: "Petrol - Combustion",
  [`${METHOD_FUEL}|Diesel`]: "Diesel - Combustion",
  [`${METHOD_GAS}|R134a`]: "R134a - GWP",
  [`${METHOD_GAS}|R410A`]: "R410A - GWP",
};

export const LEGACY_USE_CALCULATION: CalculationSpec = {
  mode: "per_method",
  method_column: COL_METHOD,
  identity_columns: [COL_PRODUCT_NAME],
  methods: {
    [METHOD_ENERGY]: { multiply: [COL_UNITS_SOLD, COL_ENERGY_PER_USE, COL_LIFETIME_USES], activity_unit: "kWh" },
    [METHOD_FUEL]: { multiply: [COL_UNITS_SOLD], activity_unit: "litre" },
    [METHOD_GAS]: { multiply: [COL_UNITS_SOLD, COL_GAS_PER_PRODUCT, COL_GAS_RELEASED], percent: [COL_GAS_RELEASED], activity_unit: "kg" },
  },
};

/** The factor the 11.5 option maps to: kgCO₂e per use of the customer's final product (e.g. per km driven). */
export const FINAL_PRODUCT_FACTOR = "Use of final product [use]";

/** Use type (the product's use profile) → the form's method option and its factor choices. */
export const USE_METHODS: Record<UseType, string> = {
  energy: METHOD_ENERGY,
  fuel: METHOD_FUEL,
  gas: METHOD_GAS,
  intermediate: METHOD_PART,
};
export const USE_OPTIONS: Record<string, string[]> = { ...LEGACY_USE_OPTIONS, [METHOD_PART]: [FINAL_PRODUCT_USE] };
export const useMapping = (): Record<string, string> => ({ ...LEGACY_USE_MAPPING, [`${METHOD_PART}|${FINAL_PRODUCT_USE}`]: FINAL_PRODUCT_FACTOR });

export const useSpec = (): CalculationSpec & { standard: string } => ({
  ...LEGACY_USE_CALCULATION,
  standard: SOLD_PRODUCTS_STANDARD,
  methods: {
    ...LEGACY_USE_CALCULATION.methods,
    [METHOD_PART]: { multiply: [COL_UNITS_SOLD, COL_FINAL_USES, COL_FINAL_SHARE], percent: [COL_FINAL_SHARE], activity_unit: "use" },
  },
});

/**
 * D7: refrigerant GWPs at AR6 as new 2026 factor rows (GWP100, IPCC AR6 WG1
 * Table 7.SM.7); the older rows the seed wrote at AR4 (1430, 2088) keep their
 * value and get `gwp_set` AR4.
 */
export const AR6_FROM_YEAR = 2026;
export const REFRIGERANT_FACTORS = [
  { name: "R134a - GWP", ar4: 1430, ar6: 1530 },
  { name: "R410A - GWP", ar4: 2088, ar6: 2256 },
] as const;

// ── Category 12 ──────────────────────────────────────────────────────────────
export const COL_MATERIAL = "Material";
export const COL_TREATMENT = "Treatment";
export const COL_EOL_MASS = "Mass at end of life (kg)";
export const COL_TREATMENT_SHARE = "Share treated this way (%)";

/** The materials the end-of-life form offers; BOM lines are sorted into them (bom.ts). */
export const MATERIALS = ["Aluminium", "Steel", "Copper", "Plastics", "Paper and board", "Glass", "Wood", "Textiles", "Mixed"] as const;
export type Material = (typeof MATERIALS)[number];

export const TREATMENT_LABELS: Record<EolTreatment, string> = {
  landfill: "Landfill",
  incineration: "Incineration",
  recycling: "Recycling",
  composting: "Composting",
};
export const AVERAGE_TREATMENT = "Average (treatment unknown)";

/** Composting only applies to organic materials. */
export const treatmentsFor = (material: string): EolTreatment[] =>
  material === "Paper and board" || material === "Wood" || material === "Textiles" || material === "Mixed"
    ? ["landfill", "incineration", "recycling", "composting"]
    : ["landfill", "incineration", "recycling"];

/** Factor names: recycling is the cut-off factor (the collection and sorting only). */
export const eolFactorName = (material: string, treatment: EolTreatment | "average"): string =>
  treatment === "average"
    ? `End of life - ${material} - Average [kg]`
    : `End of life - ${material} - ${treatment === "recycling" ? "Recycling (cut-off)" : TREATMENT_LABELS[treatment]} [kg]`;

/** "Material|Treatment" label chain → factor name. */
export function eolMapping(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const material of MATERIALS) {
    for (const t of treatmentsFor(material)) m[`${material}|${TREATMENT_LABELS[t]}`] = eolFactorName(material, t);
    m[`${material}|${AVERAGE_TREATMENT}`] = eolFactorName(material, "average");
  }
  return m;
}

export const eolSpec = (): CalculationSpec & { standard: string } => ({
  mode: "per_method",
  method_column: ROW_METHOD_COLUMN,
  standard: SOLD_PRODUCTS_STANDARD,
  identity_columns: [COL_PRODUCT],
  methods: {
    waste_type_specific: { multiply: [COL_EOL_MASS, COL_TREATMENT_SHARE], percent: [COL_TREATMENT_SHARE], activity_unit: "kg" },
    average_data: { multiply: [COL_EOL_MASS], activity_unit: "kg" },
  },
});

// ── Forms ────────────────────────────────────────────────────────────────────
export interface SoldProductForm {
  n: SoldProductCategory;
  config_name: string;
  columns: Col[];
  calculation: CalculationSpec & { standard: string };
  units: string[];
}

export function soldProductForm(n: SoldProductCategory): SoldProductForm {
  if (n === 10) {
    return {
      n,
      config_name: `${CONFIG_NAME_PREFIX} - Processing of sold products`,
      columns: [{ name: COL_PROCESSING, type: "select" }, { name: COL_PRODUCT, type: "text" }, num(COL_QUANTITY), num(COL_SHARE_OURS), num(COL_MASS_SOLD)],
      calculation: processingSpec(),
      units: ["kWh", "litre", "kg"],
    };
  }
  if (n === 11) {
    return {
      n,
      // The name the existing form already carries, so the app keeps reading the same config.
      config_name: LEGACY_USE_CONFIG_NAME,
      columns: [...LEGACY_USE_COLUMNS, num(COL_FINAL_USES), num(COL_FINAL_SHARE)],
      calculation: useSpec(),
      units: ["kWh", "litre", "kg", "use"],
    };
  }
  return {
    n,
    config_name: `${CONFIG_NAME_PREFIX} - End-of-life treatment`,
    columns: [
      { name: COL_MATERIAL, type: "select" },
      { name: COL_TREATMENT, type: "select" },
      { name: COL_PRODUCT, type: "text" },
      num(COL_EOL_MASS),
      num(COL_TREATMENT_SHARE),
    ],
    calculation: eolSpec(),
    units: ["kg"],
  };
}

const opt = (s: string) => ({ id: s, label: s });

export interface SoldProductFormFields {
  column_options: Record<string, Array<{ id: string; label: string }>>;
  column_dependencies: ColumnDependencies;
  dependent_options: DependentOptionsMap;
  emission_category_mapping: EmissionCategoryMapping;
  calculation: CalculationSpec & { standard: string };
}

/** The config fields of a form, given the ids of its global select columns (by column name). */
export function formFields(form: SoldProductForm, selectIds: Record<string, number>): SoldProductFormFields {
  if (form.n === 10) {
    return {
      column_options: { [String(selectIds[COL_PROCESSING])]: Object.keys(PROCESSING_OPTIONS).map(opt) },
      column_dependencies: {},
      dependent_options: {},
      emission_category_mapping: { ...PROCESSING_OPTIONS },
      calculation: form.calculation,
    };
  }
  if (form.n === 11) {
    return {
      column_options: { [String(selectIds[COL_METHOD])]: Object.keys(USE_OPTIONS).map(opt) },
      column_dependencies: { [COL_USE_OPTION]: COL_METHOD },
      dependent_options: { [COL_USE_OPTION]: Object.fromEntries(Object.entries(USE_OPTIONS).map(([method, opts]) => [method, opts.map(opt)])) },
      emission_category_mapping: useMapping(),
      calculation: form.calculation,
    };
  }
  return {
    column_options: {
      [String(selectIds[COL_MATERIAL])]: MATERIALS.map(opt),
      [String(selectIds[COL_TREATMENT])]: [...Object.values(TREATMENT_LABELS), AVERAGE_TREATMENT].map(opt),
    },
    column_dependencies: { [COL_TREATMENT]: COL_MATERIAL },
    dependent_options: {
      [COL_TREATMENT]: Object.fromEntries(MATERIALS.map((m) => [m, [...treatmentsFor(m).map((t) => TREATMENT_LABELS[t]), AVERAGE_TREATMENT].map(opt)])),
    },
    emission_category_mapping: eolMapping(),
    calculation: form.calculation,
  };
}

// ── Standard-form detection ──────────────────────────────────────────────────
/** What the standard-form hash covers: everything a Superadmin can edit on the form. */
export interface StandardContent {
  config_name?: string | null;
  columns?: Array<{ pk_id: number; column_name?: string }> | null;
  column_options?: unknown;
  column_dependencies?: unknown;
  dependent_options?: unknown;
  emission_category_mapping?: unknown;
  extra_fields?: unknown;
  calculation?: unknown;
}

/** JSON with object keys sorted: jsonb reads back with its own key order. */
export const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : v;
export const same = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

export function standardHash(c: StandardContent): string {
  const { standard_hash: _h, ...calculation } = (c.calculation ?? {}) as Record<string, unknown>;
  const content = {
    columns: (c.columns ?? []).map((x) => x.pk_id).sort((a, b) => a - b),
    column_options: c.column_options ?? null,
    column_dependencies: c.column_dependencies ?? null,
    dependent_options: c.dependent_options ?? null,
    emission_category_mapping: c.emission_category_mapping ?? null,
    extra_fields: Array.isArray(c.extra_fields) && c.extra_fields.length ? c.extra_fields : null,
    calculation,
  };
  return createHash("sha256").update(JSON.stringify(canon(content))).digest("hex").slice(0, 32);
}

/**
 * A config this module may rewrite: one an earlier run wrote (the `standard`
 * marker) whose content still matches the hash that run stored. Any edit since
 * makes the form customised. A client's own form has no marker.
 */
export const isStandardConfig = (config: StandardContent): boolean => {
  const calc = config.calculation as { standard?: unknown; standard_hash?: unknown } | null | undefined;
  return !!calc && calc.standard === SOLD_PRODUCTS_STANDARD && typeof calc.standard_hash === "string" && calc.standard_hash === standardHash(config);
};

/**
 * The Category 11 form exactly as seedUseOfSoldProducts.ts wrote it: same name,
 * columns (by name), method options, mapping and formula. Such a form is
 * upgraded in place (its options and formulas stay; 11.5 is added).
 */
export const isLegacyUseConfig = (config: StandardContent): boolean => {
  if (config.config_name !== LEGACY_USE_CONFIG_NAME) return false;
  const names = (config.columns ?? []).map((c) => c.column_name ?? "").sort();
  if (!same(names, LEGACY_USE_COLUMNS.map((c) => c.name).sort())) return false;
  if (!same(config.emission_category_mapping, LEGACY_USE_MAPPING)) return false;
  if (!same(config.calculation, LEGACY_USE_CALCULATION)) return false;
  const deps = config.dependent_options as Record<string, Record<string, Array<{ id: string }>>> | null | undefined;
  const legacyDeps = Object.fromEntries(Object.entries(LEGACY_USE_OPTIONS).map(([k, v]) => [k, v.map(opt)]));
  return same(deps?.[COL_USE_OPTION], legacyDeps);
};

// ── Methods (S3-3 column `method_options`; written once S3-3 is merged) ───────
/** Most specific first (01-contracts.md §1). */
export const METHOD_OPTIONS: Record<SoldProductCategory, Method[]> = {
  10: ["site_specific", "average_data"],
  11: ["direct_use"],
  12: ["waste_type_specific", "average_data"],
};
/** The units each method offers (01-contracts.md §6 `method_options` unit lists). */
export const UNITS_BY_METHOD: Record<SoldProductCategory, Partial<Record<Method, string[]>>> = {
  10: { site_specific: ["kWh", "litre", "kg"], average_data: ["kg"] },
  11: { direct_use: ["kWh", "litre", "kg", "use"] },
  12: { waste_type_specific: ["kg"], average_data: ["kg"] },
};
