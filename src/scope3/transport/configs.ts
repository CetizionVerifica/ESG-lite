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
import type { CalculationSpec, DependentOptionsMap, ExtraFieldDefinition } from "../../entities/ColumnConfig";

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

// ── Method options (S3-3 column `method_options`; written once S3-3 is merged) ─
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

/**
 * A config this module may rewrite: still the standard set by name, or one an
 * earlier run of this module wrote. A client's own form is left alone.
 */
export const isStandardConfig = (config: { config_name?: string | null; calculation?: unknown }): boolean =>
  (config.config_name ?? "").startsWith(CONFIG_NAME_PREFIX) ||
  (typeof config.calculation === "object" && config.calculation !== null && (config.calculation as { standard?: unknown }).standard === TRANSPORT_STANDARD);
