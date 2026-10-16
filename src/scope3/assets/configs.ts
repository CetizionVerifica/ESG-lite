/**
 * S3-11 · the standard data-entry forms for Category 8 (upstream leased
 * assets), 13 (downstream leased assets), 14 (franchises) and 15
 * (investments). Pure data, no database access; applied by forms.ts
 * (migrate:scope3-asset-forms and the investments plan).
 *
 * The row's unit picks the fields (per_unit spec, keys from normalizeUnitKey),
 * the activity select picks the factor. Guidance formulas:
 *   litre / kWh / kg   asset-specific 8.1 + non-sub-metered space 8.2:
 *                      quantity × your area ÷ (building area × occupancy);
 *                      enter 1 for both areas and 100 % when sub-metered
 *   kgCO2e             lessor- / lessee-specific 8.3, 13.1: reported Scope 1+2 ×
 *                      leased area ÷ building area; franchise-specific 14.1 and
 *                      the sample extrapolation 14.3: reported × franchises in
 *                      group ÷ franchises sampled (1 and 1 for one franchise)
 *   m2.year            average-data 8.4 / 14.4: floor area × kgCO₂e per m² per year
 *   asset.year         average-data 8.5 / 14.5: number of assets × per-asset factor
 *   tCO2e              investment-specific 15.1: investee Scope 1+2 × share of equity
 *   USD / EUR / INR    average-data 15.2: investee revenue × share of revenue in
 *                      the sector × share of equity, with the sector's EEIO factor
 *
 * Reported partner emissions are activity data, calculated by the engine with
 * the identity factor "Reported emissions" (1 kgCO₂e per kgCO2e, 1,000 per
 * tCO2e; factor_type other, dataset reported; D13).
 */
import type { CalculationSpec, MethodCalculation } from "../../entities/ColumnConfig";
import type { Method } from "../contracts/ghgCategory";

export type AssetCategory = 8 | 13 | 14 | 15;
export const ASSET_CATEGORIES: readonly AssetCategory[] = [8, 13, 14, 15];

/** Written into `calculation.standard` so a later run knows the config is still the standard one. */
export const ASSETS_STANDARD = "scope3-assets@1";
export const CONFIG_NAME_PREFIX = "Scope 3 assets - Standard";

// ── Identity factors (D13) ───────────────────────────────────────────────────
export const REPORTED_KG = "Reported emissions [kgCO2e]";
export const REPORTED_T = "Reported emissions [tCO2e]";
export const IDENTITY_FACTORS = [
  { name: REPORTED_KG, unit: "kgCO2e", value: 1 },
  { name: REPORTED_T, unit: "tCO2e", value: 1000 },
] as const;
export const IDENTITY_META = { factor_type: "other", dataset: "reported", geography: "GLO" } as const;
/** Years the migration seeds the identity factors for (a plan adds its own year when missing). */
export const identityYears = (now = new Date()): number[] => {
  const last = now.getUTCFullYear() + 1;
  return Array.from({ length: last - 2018 + 1 }, (_, i) => 2018 + i);
};

// ── Column names ─────────────────────────────────────────────────────────────
export const COL_LEASE_ACTIVITY = "Leased asset activity";
export const COL_FRANCHISE_ACTIVITY = "Franchise activity";
export const COL_INVESTMENT_ACTIVITY = "Investment activity";
export const COL_QTY = "Building or asset quantity";
export const COL_AREA = "Leased floor area (m²)";
export const COL_BUILDING_AREA = "Building floor area (m²)";
export const COL_OCCUPANCY = "Occupancy rate (%)";
export const COL_REPORTED_KG = "Reported Scope 1+2 (kgCO₂e)";
export const COL_FLOOR_AREA = "Floor area (m²)";
export const COL_ASSETS = "Number of assets";
export const COL_GROUP = "Franchises in group";
export const COL_SAMPLED = "Franchises sampled";
export const COL_INVESTEE_T = "Investee Scope 1+2 (tCO₂e)";
export const COL_EQUITY = "Share of equity (%)";
export const COL_REVENUE = "Investee revenue";
export const COL_SECTOR_SHARE = "Share of revenue in sector (%)";
export const COL_INVESTMENT_REF = "Investment ref";

type Col = { name: string; type: "select" | "text" | "number" };

// ── Specs ────────────────────────────────────────────────────────────────────
const space = (unit: string): MethodCalculation => ({
  multiply: [COL_QTY, COL_AREA],
  divide: [COL_BUILDING_AREA, COL_OCCUPANCY],
  percent: [COL_OCCUPANCY],
  activity_unit: unit,
});

const leaseSpec = (): CalculationSpec & { standard: string } => ({
  mode: "per_unit",
  standard: ASSETS_STANDARD,
  methods: {
    litre: space("litre"),
    kwh: space("kWh"),
    kg: space("kg"),
    kgco2e: { multiply: [COL_REPORTED_KG, COL_AREA], divide: [COL_BUILDING_AREA], activity_unit: "kgCO2e" },
    "m2.year": { multiply: [COL_AREA], activity_unit: "m2.year" },
    "asset.year": { multiply: [COL_ASSETS], activity_unit: "asset.year" },
  },
});

const franchiseSpec = (): CalculationSpec & { standard: string } => ({
  mode: "per_unit",
  standard: ASSETS_STANDARD,
  methods: {
    kgco2e: { multiply: [COL_REPORTED_KG, COL_GROUP], divide: [COL_SAMPLED], activity_unit: "kgCO2e" },
    "m2.year": { multiply: [COL_FLOOR_AREA], activity_unit: "m2.year" },
    "asset.year": { multiply: [COL_ASSETS], activity_unit: "asset.year" },
  },
});

const revenue = (unit: string): MethodCalculation => ({
  multiply: [COL_REVENUE, COL_SECTOR_SHARE, COL_EQUITY],
  percent: [COL_SECTOR_SHARE, COL_EQUITY],
  activity_unit: unit,
});

const investmentSpec = (): CalculationSpec & { standard: string } => ({
  mode: "per_unit",
  standard: ASSETS_STANDARD,
  // Two plan rows for the same investee (sector split) differ by sector, which
  // the activity names; the ref keeps two investees in one sector apart.
  identity_columns: [COL_INVESTMENT_REF],
  methods: {
    tco2e: { multiply: [COL_INVESTEE_T, COL_EQUITY], percent: [COL_EQUITY], activity_unit: "tCO2e" },
    usd: revenue("USD"),
    eur: revenue("EUR"),
    inr: revenue("INR"),
  },
});

// ── Activity options (select label → factor name) ────────────────────────────
// The identity factors are seeded; the others are the client's own factors
// (grid, fuel, refrigerant GWP, kgCO₂e per m² or per asset, EEIO per currency unit).
const LEASE_OPTIONS: Record<string, string> = {
  "Natural gas [kWh]": "Natural gas [kWh]",
  "Electricity [kWh]": "Electricity [kWh]",
  "Diesel [litre]": "Diesel [litre]",
  "Refrigerant leaked [kg]": "Refrigerant [kg]",
  "Reported Scope 1+2 [kgCO2e]": REPORTED_KG,
  "Floor area, average [m2.year]": "Floor area average [m2.year]",
  "Number of assets, average [asset.year]": "Asset average [asset.year]",
};
const FRANCHISE_OPTIONS: Record<string, string> = {
  "Reported Scope 1+2 [kgCO2e]": REPORTED_KG,
  "Floor area, average [m2.year]": "Floor area average [m2.year]",
  "Number of franchises, average [asset.year]": "Asset average [asset.year]",
};
const INVESTMENT_OPTIONS: Record<string, string> = {
  "Reported Scope 1+2 [tCO2e]": REPORTED_T,
};

export interface AssetForm {
  n: AssetCategory;
  config_name: string;
  select: string;
  columns: Col[];
  options: Record<string, string>;
  calculation: CalculationSpec & { standard: string };
  units: string[];
}

const num = (name: string): Col => ({ name, type: "number" });

export function assetForm(n: AssetCategory): AssetForm {
  if (n === 8 || n === 13) {
    return {
      n,
      config_name: `${CONFIG_NAME_PREFIX} - ${n === 8 ? "Upstream leased assets" : "Downstream leased assets"}`,
      select: COL_LEASE_ACTIVITY,
      columns: [
        { name: COL_LEASE_ACTIVITY, type: "select" },
        num(COL_QTY),
        num(COL_REPORTED_KG),
        num(COL_AREA),
        num(COL_BUILDING_AREA),
        num(COL_OCCUPANCY),
        num(COL_ASSETS),
      ],
      options: LEASE_OPTIONS,
      calculation: leaseSpec(),
      units: ["litre", "kWh", "kg", "kgCO2e", "m2.year", "asset.year"],
    };
  }
  if (n === 14) {
    return {
      n,
      config_name: `${CONFIG_NAME_PREFIX} - Franchises`,
      select: COL_FRANCHISE_ACTIVITY,
      columns: [{ name: COL_FRANCHISE_ACTIVITY, type: "select" }, num(COL_REPORTED_KG), num(COL_GROUP), num(COL_SAMPLED), num(COL_FLOOR_AREA), num(COL_ASSETS)],
      options: FRANCHISE_OPTIONS,
      calculation: franchiseSpec(),
      units: ["kgCO2e", "m2.year", "asset.year"],
    };
  }
  return {
    n,
    config_name: `${CONFIG_NAME_PREFIX} - Investments`,
    select: COL_INVESTMENT_ACTIVITY,
    columns: [
      { name: COL_INVESTMENT_ACTIVITY, type: "select" },
      { name: COL_INVESTMENT_REF, type: "text" },
      num(COL_INVESTEE_T),
      num(COL_REVENUE),
      num(COL_SECTOR_SHARE),
      num(COL_EQUITY),
    ],
    options: INVESTMENT_OPTIONS,
    calculation: investmentSpec(),
    units: ["tCO2e", "USD", "EUR", "INR"],
  };
}

const opt = (s: string) => ({ id: s, label: s });

/** The config fields of a form, given the id of its global select column. */
export function formFields(form: AssetForm, selectColumnId: number) {
  return {
    column_options: { [String(selectColumnId)]: Object.keys(form.options).map(opt) },
    column_dependencies: {},
    dependent_options: {},
    emission_category_mapping: { ...form.options },
    calculation: form.calculation,
  };
}

/**
 * A config this module may rewrite: still the standard one by name, or one an
 * earlier run wrote. A client's own form is left alone.
 */
export const isStandardConfig = (config: { config_name?: string | null; calculation?: unknown }): boolean =>
  (config.config_name ?? "").startsWith(CONFIG_NAME_PREFIX) ||
  (typeof config.calculation === "object" && config.calculation !== null && (config.calculation as { standard?: unknown }).standard === ASSETS_STANDARD);

// ── Methods (S3-3 column `method_options`; written once S3-3 is merged) ───────
/** Most specific first (01-contracts.md §1). */
export const METHOD_OPTIONS: Record<AssetCategory, Method[]> = {
  8: ["asset_specific", "lessor_specific", "average_data"],
  13: ["asset_specific", "lessee_specific", "average_data"],
  14: ["franchise_specific", "average_data"],
  15: ["investment_specific", "average_data"],
};
/** The units each method offers (01-contracts.md §6 `method_options` unit lists). */
export const UNITS_BY_METHOD: Record<AssetCategory, Partial<Record<Method, string[]>>> = {
  8: { asset_specific: ["litre", "kWh", "kg"], lessor_specific: ["kgCO2e"], average_data: ["m2.year", "asset.year"] },
  13: { asset_specific: ["litre", "kWh", "kg"], lessee_specific: ["kgCO2e"], average_data: ["m2.year", "asset.year"] },
  14: { franchise_specific: ["kgCO2e"], average_data: ["m2.year", "asset.year"] },
  15: { investment_specific: ["tCO2e"], average_data: ["USD", "EUR", "INR"] },
};
