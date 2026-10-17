/**
 * S3-8 · Transport and distribution (Cat 4 upstream, Cat 9 downstream): the one
 * standard form both categories use. Pure data, no database access; applied by
 * `src/scripts/seedScope3Transport.ts` (migrate:scope3-transport) and by the
 * older `repairTransportConfigs.ts`.
 *
 * The columns, options and mapping of the pre-S3-8 standard set are kept as
 * they were, so rows saved before still resolve to the same factor. S3-8 adds:
 *   • fuel-based (guidance formula 4.1 + 4.4): litres × your share of the load;
 *   • site-specific warehouse energy (4.8): kWh × your share of its volume;
 *   • refrigerant leaked (4.1/4.8): kg × your share, refrigerated HGV and warehouse only;
 *   • average-data storage (4.9): volume × days, per m³, pallet or TEU per day;
 *   • "Who paid for this transport?" (extra_data.paid_by).
 * The row's unit picks the method (per_unit spec, keys from normalizeUnitKey).
 */
import { createHash } from "crypto";
import type { CalculationSpec, DependentOptionsMap, ExtraFieldDefinition } from "../../entities/ColumnConfig";
import type { MethodOptions } from "../contracts/schemas";
import { SUPPORTED_CURRENCIES } from "../spend/currencies";

/** Written into `calculation.standard` so a later run knows the config is still the standard one. */
export const TRANSPORT_STANDARD = "scope3-transport@1";
export const CONFIG_NAME_PREFIX = "Transport - Standard";

// Column names. The select names reuse the existing global column entities.
export const COL_MODE = "Travel Mode";
export const COL_VEHICLE = "Vehicle Type";
export const COL_CLASS = "Fuel Type/Class";
export const COL_REF = "Shipment Ref";
export const COL_WEIGHT = "Weight (tonne)";
export const COL_DISTANCE = "Distance travelled";
export const COL_FUEL = "Fuel used (litres)";
export const COL_ENERGY = "Energy used (kWh)";
export const COL_REFRIGERANT = "Refrigerant leaked (kg)";
export const COL_LOAD_SHARE = "Your share of the load (%)";
export const COL_SHARE = "Your share (%)";
export const COL_VOLUME = "Volume stored";
export const COL_DAYS = "Days stored";

export const COLUMNS: Array<{ name: string; type: "select" | "text" | "number" }> = [
  { name: COL_MODE, type: "select" },
  { name: COL_VEHICLE, type: "select" },
  { name: COL_CLASS, type: "select" },
  { name: COL_REF, type: "text" },
  { name: COL_WEIGHT, type: "number" },
  { name: COL_DISTANCE, type: "number" },
  { name: COL_FUEL, type: "number" },
  { name: COL_ENERGY, type: "number" },
  { name: COL_REFRIGERANT, type: "number" },
  { name: COL_LOAD_SHARE, type: "number" },
  { name: COL_SHARE, type: "number" },
  { name: COL_VOLUME, type: "number" },
  { name: COL_DAYS, type: "number" },
];

// ── Option chains: Mode → Vehicle → Class ─────────────────────────────────────
const VAN_FUELS = ["Battery electric vehicle", "CNG", "Diesel", "LPG", "Petrol", "Plug in Hybrid electric vehicle", "Unknown"];
const BOTH = (base: string) => [`${base} [tonne.km]`, `${base} [km]`];

// Fuel-based and warehouse classes carry the unit they are entered in.
const FUEL_DIESEL = "Diesel used [litre]";
const FUEL_PETROL = "Petrol used [litre]";
const FUEL_LPG = "LPG used [litre]";
const ELECTRICITY = "Electricity used [kWh]";
const NATURAL_GAS = "Natural gas used [kWh]";
const R134A = "Refrigerant R134a leaked [kg]";
const R410A = "Refrigerant R410A leaked [kg]";
const STORE_M3 = "Ambient storage [m3.day]";
const STORE_PALLET = "Ambient storage [pallet.day]";
const STORE_PALLET_CHILLED = "Chilled storage [pallet.day]";
const STORE_TEU = "Container storage [teu.day]";

export const WAREHOUSE_MODE = "Warehouse";
export const VEHICLES_BY_MODE: Record<string, string[]> = {
  Road: ["HGV (all diesel)", "HGV refrigerated (all diesel)", "Van"],
  Rail: ["Freight train"],
  Air: ["Flight"],
  Sea: ["Cargo ship"],
  [WAREHOUSE_MODE]: ["Warehouse energy (site-specific)", "Average storage"],
};

export const CLASSES_BY_VEHICLE: Record<string, string[]> = {
  "HGV (all diesel)": [...BOTH("All rigids"), FUEL_DIESEL],
  "HGV refrigerated (all diesel)": [...BOTH("All rigids"), FUEL_DIESEL, R134A, R410A],
  Van: [...VAN_FUELS.flatMap(BOTH), FUEL_DIESEL, FUEL_PETROL, FUEL_LPG, ELECTRICITY],
  "Freight train": ["Rail freight [tonne.km]", FUEL_DIESEL, ELECTRICITY],
  Flight: ["Domestic", "International"],
  "Cargo ship": ["General Cargo"],
  "Warehouse energy (site-specific)": [ELECTRICITY, NATURAL_GAS, R134A, R410A],
  "Average storage": [STORE_M3, STORE_PALLET, STORE_PALLET_CHILLED, STORE_TEU],
};

/**
 * Factor names the S3-8 classes map to. Fuel and refrigerant factors are
 * seeded from factors.json; the grid and storage factors are the client's own
 * (DEFRA 2025 has no non-UK grid factor and no per-day storage factor).
 */
export const FACTOR_FOR_CLASS: Record<string, string> = {
  [FUEL_DIESEL]: "Fuel - Diesel (average biofuel blend) [litre]",
  [FUEL_PETROL]: "Fuel - Petrol (average biofuel blend) [litre]",
  [FUEL_LPG]: "Fuel - LPG [litre]",
  [ELECTRICITY]: "Electricity - Grid [kWh]",
  [NATURAL_GAS]: "Fuel - Natural gas [kWh]",
  [R134A]: "Refrigerant - R134a [kg]",
  [R410A]: "Refrigerant - R410A [kg]",
  [STORE_M3]: "Warehouse - Ambient storage [m3.day]",
  [STORE_PALLET]: "Warehouse - Ambient storage [pallet.day]",
  [STORE_PALLET_CHILLED]: "Warehouse - Chilled storage [pallet.day]",
  [STORE_TEU]: "Warehouse - Container storage [teu.day]",
};

/** Label chain "Mode|Vehicle|Class" → factor emission_category_name. The pre-S3-8 chains are unchanged. */
export function buildMapping(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const [mode, vehicles] of Object.entries(VEHICLES_BY_MODE)) {
    for (const vehicle of vehicles) {
      for (const cls of CLASSES_BY_VEHICLE[vehicle]) {
        const key = `${mode}|${vehicle}|${cls}`;
        if (FACTOR_FOR_CLASS[cls]) m[key] = FACTOR_FOR_CLASS[cls];
        else if (mode === "Rail") m[key] = "Road - Rail"; // existing 2-part factor
        else if (mode === "Air") m[key] = `Air - flight - ${cls}`; // factor keeps lowercase "flight"
        else m[key] = `${mode} - ${vehicle} - ${cls}`;
      }
    }
  }
  return m;
}

// ── Calculation: the unit picks the fields ───────────────────────────────────
export const CALCULATION: CalculationSpec & { standard: string } = {
  mode: "per_unit",
  identity_columns: [COL_REF],
  legacy_field: COL_DISTANCE,
  standard: TRANSPORT_STANDARD,
  methods: {
    // distance_based, formula 4.6 (unchanged)
    "tonne.km": { multiply: [COL_WEIGHT, COL_DISTANCE], activity_unit: "tonne.km" },
    km: { multiply: [COL_DISTANCE], activity_unit: "km" },
    // fuel_based 4.1 with the shared-vehicle allocation 4.4
    litre: { multiply: [COL_FUEL, COL_LOAD_SHARE], percent: [COL_LOAD_SHARE], activity_unit: "litre" },
    // site_specific 4.8 (warehouse energy) and electric vehicles under 4.1
    kwh: { multiply: [COL_ENERGY, COL_SHARE], percent: [COL_SHARE], activity_unit: "kWh" },
    // refrigerant leakage under 4.1 / 4.8
    kg: { multiply: [COL_REFRIGERANT, COL_SHARE], percent: [COL_SHARE], activity_unit: "kg" },
    // average_data 4.9
    "m3.day": { multiply: [COL_VOLUME, COL_DAYS], activity_unit: "m3.day" },
    "pallet.day": { multiply: [COL_VOLUME, COL_DAYS], activity_unit: "pallet.day" },
    "teu.day": { multiply: [COL_VOLUME, COL_DAYS], activity_unit: "teu.day" },
  },
};

/** Unit rows the form offers (site × category). */
export const UNITS = ["km", "tonne.km", "litre", "kWh", "kg", "m3.day", "pallet.day", "teu.day"];
/** Units the pre-S3-8 repair removed as strays; `kg` is a real unit now (refrigerant). */
export const STRAY_UNITS = ["g.km", "kg.km"];

// ── Method options (S3-3 column `method_options`) ────────────────────────────
export type TransportMethod = "fuel_based" | "distance_based" | "site_specific" | "average_data" | "spend_based";
export const METHOD_OPTIONS: Record<4 | 9, TransportMethod[]> = {
  4: ["fuel_based", "distance_based", "site_specific", "average_data", "spend_based"],
  9: ["distance_based", "fuel_based", "average_data", "site_specific", "spend_based"],
};
/** The units each method offers (S3-0 follow-up: `method_options` carries a unit list per method). Spend is S3-5's. */
export const UNITS_BY_METHOD: Record<Exclude<TransportMethod, "spend_based">, string[]> = {
  fuel_based: ["litre", "kWh", "kg"],
  distance_based: ["tonne.km", "km"],
  site_specific: ["kWh", "kg"],
  average_data: ["m3.day", "pallet.day", "teu.day"],
};

/** Spend rows are entered as an amount in a currency (S3-5's fields); the currencies S3-5 converts. */
export const SPEND_UNITS: string[] = [...SUPPORTED_CURRENCIES];

/** `column_config.method_options` for the category: `{method, units}`, most specific first (01-contracts §6). */
export const methodOptionsFor = (ghg: 4 | 9): MethodOptions =>
  METHOD_OPTIONS[ghg].map((method) => ({ method, units: method === "spend_based" ? SPEND_UNITS : UNITS_BY_METHOD[method] }));

// ── Extra field ──────────────────────────────────────────────────────────────
export const PAID_BY_KEY = "paid_by";
export const PAID_BY_OPTIONS = ["We paid", "Customer or other"];
export const PAID_BY_FIELD: ExtraFieldDefinition = {
  key: PAID_BY_KEY,
  label: "Who paid for this transport?",
  type: "select",
  required: false,
  options: PAID_BY_OPTIONS,
};

/** The form's extra fields: the existing ones kept as they are, plus "Who paid?" once. */
export const withPaidBy = (fields: ExtraFieldDefinition[] | null | undefined): ExtraFieldDefinition[] => {
  const list = fields ?? [];
  return list.some((f) => f.key === PAID_BY_KEY) ? list : [...list, PAID_BY_FIELD];
};

const opt = (s: string) => ({ id: s, label: s });

/** Everything a config row needs, given the ids of the global select columns. */
export function transportForm(ids: { mode: number; vehicle: number; cls: number }) {
  const allVehicles = Object.values(VEHICLES_BY_MODE).flat();
  const allClasses = Array.from(new Set(Object.values(CLASSES_BY_VEHICLE).flat()));
  const dependentOptions: DependentOptionsMap = {
    [COL_VEHICLE]: Object.fromEntries(Object.entries(VEHICLES_BY_MODE).map(([mode, v]) => [mode, v.map(opt)])),
    [COL_CLASS]: Object.fromEntries(Object.entries(CLASSES_BY_VEHICLE).map(([veh, c]) => [veh, c.map(opt)])),
  };
  return {
    column_options: {
      [String(ids.mode)]: Object.keys(VEHICLES_BY_MODE).map(opt),
      [String(ids.vehicle)]: allVehicles.map(opt),
      [String(ids.cls)]: allClasses.map(opt),
    },
    column_dependencies: { [COL_VEHICLE]: COL_MODE, [COL_CLASS]: COL_VEHICLE },
    dependent_options: dependentOptions,
    emission_category_mapping: buildMapping(),
    calculation: CALCULATION,
  };
}

/** The spec the pre-S3-8 standard set (repairTransportConfigs.ts) wrote: distance only. */
export const LEGACY_CALCULATION: CalculationSpec = {
  mode: "per_unit",
  identity_columns: [COL_REF],
  legacy_field: COL_DISTANCE,
  methods: {
    "tonne.km": { multiply: [COL_WEIGHT, COL_DISTANCE], activity_unit: "tonne.km" },
    km: { multiply: [COL_DISTANCE], activity_unit: "km" },
  },
};

/** JSON with object keys sorted: jsonb reads back with its own key order. */
export const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : v;
export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

/** What the standard-form hash covers: everything a Superadmin can edit on the form (as S3-9's travel forms). */
export interface StandardContent {
  columns?: Array<{ pk_id: number }> | null;
  column_options?: unknown;
  column_dependencies?: unknown;
  dependent_options?: unknown;
  emission_category_mapping?: unknown;
  extra_fields?: unknown;
  calculation?: unknown;
}

/** Hash of the form as this module wrote it, stored in `calculation.standard_hash`. */
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

/** The form's `calculation` with the hash of the whole form in it. */
export const withStandardHash = <T extends StandardContent>(c: T): T => {
  const calculation = { ...((c.calculation ?? {}) as Record<string, unknown>) };
  delete calculation.standard_hash;
  const next = { ...c, calculation };
  return { ...next, calculation: { ...calculation, standard_hash: standardHash(next) } };
};

/**
 * A config this module may rewrite, so a Superadmin's edit is never undone on
 * the next start:
 *   • one this module wrote and nobody edited since (marker and matching hash;
 *     a marker without a hash is from an S3-8 build before hashes);
 *   • the pre-S3-8 standard set, by name, with its distance-only spec unchanged.
 * Anything else is a client's own form and is left alone.
 */
export const isStandardConfig = (config: StandardContent & { config_name?: string | null }): boolean => {
  const calc = config.calculation as { standard?: unknown; standard_hash?: unknown } | null | undefined;
  if (calc && typeof calc === "object" && calc.standard === TRANSPORT_STANDARD) {
    return typeof calc.standard_hash !== "string" || calc.standard_hash === standardHash(config);
  }
  return (config.config_name ?? "").startsWith(CONFIG_NAME_PREFIX) && (calc == null || sameJson(calc, LEGACY_CALCULATION));
};
