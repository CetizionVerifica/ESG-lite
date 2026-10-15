/**
 * S3-9 · the standard data-entry forms for Category 6 (business travel) and
 * Category 7 (employee commuting). Pure data, no database access; applied by
 * forms.ts (migrate:scope3-travel and the commuting survey plan).
 *
 * Category 6, per_unit (the row's unit picks the fields), formula 6.1:
 *   passenger.km   Travellers × Distance (km)                       (air, rail, bus, taxi)
 *   vehicle.km     Travellers × Distance (km) ÷ Travellers per vehicle  (car or taxi, by occupancy)
 *   night          Rooms × Nights                                   (hotel stays, optional in Cat 6)
 *   litre          Fuel used (litres)                               (fuel_based, as Cat 4)
 *   Spend comes with S3-5's spend.ts.
 *
 * Category 7, per_method with method_column "@method" (the row's method picks the fields):
 *   distance_based Total distance (km) × Total employees ÷ Employees surveyed  (formula 7.1, survey scaled to staff)
 *   average_data   Total employees × Share using this mode (%) × One-way distance (km)
 *                  × Trips per day × Working days per year         (formula 7.2)
 *   fuel_based     Fuel used (litres)
 *
 * The selects pick the factor: Category 6 "Trip mode" → "Trip class" →
 * "Radiative forcing" (air only; With RF is listed first), Category 7 one
 * "Commuting mode" select. Factor names follow DEFRA's business-travel and
 * hotel-stay tabs; their values come from factors.ts (seeded where missing)
 * or the client's own factors.
 */
import type { CalculationSpec, ColumnDependencies, DependentOptionsMap, EmissionCategoryMapping } from "../../entities/ColumnConfig";
import type { Method } from "../contracts/ghgCategory";
import { ROW_METHOD_COLUMN } from "../../services/calculationSpec";

export type TravelCategory = 6 | 7;
export const TRAVEL_CATEGORIES: readonly TravelCategory[] = [6, 7];

/** Written into `calculation.standard` so a later run knows the config is still the standard one. */
export const TRAVEL_STANDARD = "scope3-travel@1";
export const CONFIG_NAME_PREFIX = "Scope 3 travel - Standard";

// ── Column names ─────────────────────────────────────────────────────────────
export const COL_TRIP_MODE = "Trip mode";
export const COL_TRIP_CLASS = "Trip class";
export const COL_RF = "Radiative forcing";
export const COL_TRIP_REF = "Trip ref";
export const COL_TRAVELLERS = "Travellers";
export const COL_DISTANCE = "Distance (km)";
export const COL_PER_VEHICLE = "Travellers per vehicle";
export const COL_ROOMS = "Rooms";
export const COL_NIGHTS = "Nights";
export const COL_FUEL = "Fuel used (litres)";

export const COL_COMMUTE_MODE = "Commuting mode";
export const COL_TOTAL_DISTANCE = "Total distance (km)";
export const COL_TOTAL_EMPLOYEES = "Total employees";
export const COL_SURVEYED = "Employees surveyed";
export const COL_MODE_SHARE = "Share using this mode (%)";
export const COL_ONE_WAY = "One-way distance (km)";
export const COL_TRIPS_PER_DAY = "Trips per day";
export const COL_WORKING_DAYS = "Working days per year";

type Col = { name: string; type: "select" | "text" | "number" };
const num = (name: string): Col => ({ name, type: "number" });

// ── Category 6 option chains ─────────────────────────────────────────────────
export const RF_WITH = "With RF";
export const RF_WITHOUT = "Without RF";
export const RF_OPTIONS = [RF_WITH, RF_WITHOUT];

/** DEFRA's air classes (cabins DEFRA publishes per haul). */
const AIR_CLASSES: Array<{ label: string; haul: string; cabin: string }> = [
  { label: "Domestic, average passenger", haul: "Domestic", cabin: "Average passenger" },
  { label: "Short haul, economy", haul: "Short-haul", cabin: "Economy class" },
  { label: "Short haul, business", haul: "Short-haul", cabin: "Business class" },
  { label: "Long haul, economy", haul: "Long-haul", cabin: "Economy class" },
  { label: "Long haul, premium economy", haul: "Long-haul", cabin: "Premium economy class" },
  { label: "Long haul, business", haul: "Long-haul", cabin: "Business class" },
  { label: "Long haul, first", haul: "Long-haul", cabin: "First class" },
];

const airFactor = (haul: string, cabin: string, rf: string) => `Flights - ${haul} - ${cabin} - ${rf} [passenger.km]`;

/** Non-air classes: label → factor name. The unit in brackets is the unit the row is entered in. */
const LAND_CLASSES: Record<string, Record<string, string>> = {
  Rail: {
    "National rail [passenger.km]": "Rail - National rail [passenger.km]",
    "International rail [passenger.km]": "Rail - International rail [passenger.km]",
    "Light rail and tram [passenger.km]": "Rail - Light rail and tram [passenger.km]",
    "Underground or metro [passenger.km]": "Rail - Underground [passenger.km]",
  },
  Bus: {
    "Local bus [passenger.km]": "Bus - Average local bus [passenger.km]",
    "Coach [passenger.km]": "Bus - Coach [passenger.km]",
  },
  Taxi: {
    "Regular taxi [passenger.km]": "Taxi - Regular taxi [passenger.km]",
    "Regular taxi [vehicle.km]": "Taxi - Regular taxi [vehicle.km]",
  },
  "Rental or own car": {
    "Average car, unknown fuel [vehicle.km]": "Car - Average car - Unknown fuel [vehicle.km]",
    "Petrol car [vehicle.km]": "Car - Average car - Petrol [vehicle.km]",
    "Diesel car [vehicle.km]": "Car - Average car - Diesel [vehicle.km]",
    "Hybrid car [vehicle.km]": "Car - Average car - Hybrid [vehicle.km]",
    "Plug-in hybrid car [vehicle.km]": "Car - Average car - Plug-in hybrid [vehicle.km]",
    "Battery electric car [vehicle.km]": "Car - Average car - Battery electric [vehicle.km]",
    "Petrol used [litre]": "Fuel - Petrol (average biofuel blend) [litre]",
    "Diesel used [litre]": "Fuel - Diesel (average biofuel blend) [litre]",
  },
};

/** Hotel stays per room per night, by country (DEFRA "Hotel stay" tab). */
export const HOTEL_COUNTRIES = [
  "United Kingdom",
  "India",
  "United States",
  "United Arab Emirates",
  "Germany",
  "France",
  "Singapore",
  "China",
] as const;
const hotelFactor = (country: string) => `Hotel stay - ${country} [night]`;

export const MODE_AIR = "Air";
export const MODE_HOTEL = "Hotel";
export const TRIP_MODES = [MODE_AIR, "Rail", "Bus", "Taxi", "Rental or own car", MODE_HOTEL];

export const CLASSES_BY_MODE: Record<string, string[]> = {
  [MODE_AIR]: AIR_CLASSES.map((c) => c.label),
  ...Object.fromEntries(Object.entries(LAND_CLASSES).map(([mode, m]) => [mode, Object.keys(m)])),
  [MODE_HOTEL]: [...HOTEL_COUNTRIES],
};

/**
 * Label chain → factor name, in the form's key format (labels root to leaf
 * joined by "|"). Air chains carry the radiative-forcing choice
 * ("Air|Long haul, economy|With RF"); the other modes stop at the class,
 * since "Radiative forcing" has no options for them.
 */
export function travelMapping(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const c of AIR_CLASSES) for (const rf of RF_OPTIONS) m[`${MODE_AIR}|${c.label}|${rf}`] = airFactor(c.haul, c.cabin, rf);
  for (const [mode, classes] of Object.entries(LAND_CLASSES)) for (const [label, factor] of Object.entries(classes)) m[`${mode}|${label}`] = factor;
  for (const country of HOTEL_COUNTRIES) m[`${MODE_HOTEL}|${country}`] = hotelFactor(country);
  return m;
}

// ── Category 7 options ───────────────────────────────────────────────────────
/** Commuting mode label → factor name. Walking and cycling have factor 0 and are left out (L4542-4581). */
export const COMMUTE_OPTIONS: Record<string, string> = {
  "Rail [passenger.km]": "Rail - National rail [passenger.km]",
  "Underground or metro [passenger.km]": "Rail - Underground [passenger.km]",
  "Light rail and tram [passenger.km]": "Rail - Light rail and tram [passenger.km]",
  "Bus [passenger.km]": "Bus - Average local bus [passenger.km]",
  "Coach [passenger.km]": "Bus - Coach [passenger.km]",
  "Car, unknown fuel [vehicle.km]": "Car - Average car - Unknown fuel [vehicle.km]",
  "Car, petrol [vehicle.km]": "Car - Average car - Petrol [vehicle.km]",
  "Car, diesel [vehicle.km]": "Car - Average car - Diesel [vehicle.km]",
  "Car, hybrid [vehicle.km]": "Car - Average car - Hybrid [vehicle.km]",
  "Car, battery electric [vehicle.km]": "Car - Average car - Battery electric [vehicle.km]",
  "Motorbike [vehicle.km]": "Motorbike - Average [vehicle.km]",
  "Taxi [passenger.km]": "Taxi - Regular taxi [passenger.km]",
  "Petrol used [litre]": "Fuel - Petrol (average biofuel blend) [litre]",
  "Diesel used [litre]": "Fuel - Diesel (average biofuel blend) [litre]",
};

/** The unit a commuting option is entered in (the bracket in its label). */
export const unitOfOption = (label: string): string | null => /\[([^\]]+)\]\s*$/.exec(label)?.[1] ?? null;

// ── Specs ────────────────────────────────────────────────────────────────────
export const travelSpec = (): CalculationSpec & { standard: string } => ({
  mode: "per_unit",
  standard: TRAVEL_STANDARD,
  // Two trips on the same route in one month are two trips, told apart by their ref.
  identity_columns: [COL_TRIP_REF],
  // Rows saved before the standard form held count × distance in one number.
  legacy_field: COL_DISTANCE,
  methods: {
    "passenger.km": { multiply: [COL_TRAVELLERS, COL_DISTANCE], activity_unit: "passenger.km" },
    "vehicle.km": { multiply: [COL_TRAVELLERS, COL_DISTANCE], divide: [COL_PER_VEHICLE], activity_unit: "vehicle.km" },
    night: { multiply: [COL_ROOMS, COL_NIGHTS], activity_unit: "night" },
    litre: { multiply: [COL_FUEL], activity_unit: "litre" },
  },
});

export const commutingSpec = (): CalculationSpec & { standard: string } => ({
  mode: "per_method",
  method_column: ROW_METHOD_COLUMN,
  standard: TRAVEL_STANDARD,
  methods: {
    distance_based: { multiply: [COL_TOTAL_DISTANCE, COL_TOTAL_EMPLOYEES], divide: [COL_SURVEYED] },
    average_data: {
      multiply: [COL_TOTAL_EMPLOYEES, COL_MODE_SHARE, COL_ONE_WAY, COL_TRIPS_PER_DAY, COL_WORKING_DAYS],
      percent: [COL_MODE_SHARE],
    },
    fuel_based: { multiply: [COL_FUEL], activity_unit: "litre" },
  },
});

// ── Forms ────────────────────────────────────────────────────────────────────
export interface TravelForm {
  n: TravelCategory;
  config_name: string;
  columns: Col[];
  calculation: CalculationSpec & { standard: string };
  units: string[];
}

export function travelForm(n: TravelCategory): TravelForm {
  if (n === 6) {
    return {
      n,
      config_name: `${CONFIG_NAME_PREFIX} - Business travel`,
      columns: [
        { name: COL_TRIP_MODE, type: "select" },
        { name: COL_TRIP_CLASS, type: "select" },
        { name: COL_RF, type: "select" },
        { name: COL_TRIP_REF, type: "text" },
        num(COL_TRAVELLERS),
        num(COL_DISTANCE),
        num(COL_PER_VEHICLE),
        num(COL_ROOMS),
        num(COL_NIGHTS),
        num(COL_FUEL),
      ],
      calculation: travelSpec(),
      units: ["passenger.km", "vehicle.km", "night", "litre"],
    };
  }
  return {
    n,
    config_name: `${CONFIG_NAME_PREFIX} - Employee commuting`,
    columns: [
      { name: COL_COMMUTE_MODE, type: "select" },
      num(COL_TOTAL_DISTANCE),
      num(COL_TOTAL_EMPLOYEES),
      num(COL_SURVEYED),
      num(COL_MODE_SHARE),
      num(COL_ONE_WAY),
      num(COL_TRIPS_PER_DAY),
      num(COL_WORKING_DAYS),
      num(COL_FUEL),
    ],
    calculation: commutingSpec(),
    units: ["passenger.km", "vehicle.km", "litre"],
  };
}

const opt = (s: string) => ({ id: s, label: s });

/** The config fields of a form, given the ids of its global select columns (by column name). */
export interface TravelFormFields {
  column_options: Record<string, Array<{ id: string; label: string }>>;
  column_dependencies: ColumnDependencies;
  dependent_options: DependentOptionsMap;
  emission_category_mapping: EmissionCategoryMapping;
  calculation: CalculationSpec & { standard: string };
}

export function formFields(form: TravelForm, selectIds: Record<string, number>): TravelFormFields {
  if (form.n === 6) {
    const airRf = Object.fromEntries(CLASSES_BY_MODE[MODE_AIR].map((c) => [c, RF_OPTIONS.map(opt)]));
    return {
      column_options: {
        [String(selectIds[COL_TRIP_MODE])]: TRIP_MODES.map(opt),
        [String(selectIds[COL_TRIP_CLASS])]: [...new Set(Object.values(CLASSES_BY_MODE).flat())].map(opt),
        // No fallback list: a rail, bus, taxi, car or hotel class has no RF choice, and the form hides the select.
        [String(selectIds[COL_RF])]: [],
      },
      column_dependencies: { [COL_TRIP_CLASS]: COL_TRIP_MODE, [COL_RF]: COL_TRIP_CLASS },
      dependent_options: {
        [COL_TRIP_CLASS]: Object.fromEntries(Object.entries(CLASSES_BY_MODE).map(([mode, c]) => [mode, c.map(opt)])),
        // Only air classes offer the radiative-forcing choice.
        [COL_RF]: airRf,
      },
      emission_category_mapping: travelMapping(),
      calculation: form.calculation,
    };
  }
  return {
    column_options: { [String(selectIds[COL_COMMUTE_MODE])]: Object.keys(COMMUTE_OPTIONS).map(opt) },
    column_dependencies: {},
    dependent_options: {},
    emission_category_mapping: { ...COMMUTE_OPTIONS },
    calculation: form.calculation,
  };
}

/**
 * A config this module may rewrite: still the standard one by name, or one an
 * earlier run wrote. A client's own form (or one a Superadmin customised) is left alone.
 */
export const isStandardConfig = (config: { config_name?: string | null; calculation?: unknown }): boolean =>
  (config.config_name ?? "").startsWith(CONFIG_NAME_PREFIX) ||
  (typeof config.calculation === "object" && config.calculation !== null && (config.calculation as { standard?: unknown }).standard === TRAVEL_STANDARD);

// ── Methods (S3-3 column `method_options`; written once S3-3 is merged) ───────
/** Most specific first (01-contracts.md §1). */
export const METHOD_OPTIONS: Record<TravelCategory, Method[]> = {
  6: ["distance_based", "fuel_based", "spend_based"],
  7: ["distance_based", "average_data", "fuel_based"],
};
/** The units each method offers (01-contracts.md §6 `method_options` unit lists). Spend is S3-5's. */
export const UNITS_BY_METHOD: Record<TravelCategory, Partial<Record<Method, string[]>>> = {
  6: { distance_based: ["passenger.km", "vehicle.km", "night"], fuel_based: ["litre"] },
  7: { distance_based: ["passenger.km", "vehicle.km"], average_data: ["passenger.km", "vehicle.km"], fuel_based: ["litre"] },
};
