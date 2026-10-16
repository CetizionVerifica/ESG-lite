/**
 * S3-9 business travel, hotel stay and commuting factors (kgCO₂e per unit),
 * seeded by migrate:scope3-travel where a site × category has none of that
 * name and year. Names are the ones configs.ts maps the selects to.
 *
 * Source: DEFRA/DESNZ conversion factors ("Business travel- air",
 * "Business travel- land", "Hotel stay", "Fuels"), with and without radiative forcing
 * for flights (the RF uplift is disclosed by the factor name, L4218, L4408),
 * factor_type life_cycle (spec), GWP set AR5 (DEFRA's), geography GB.
 *
 * Values: DEFRA/DESNZ 2025 condensed set, version 1 (uploaded by Shyam on
 * 2026-10-16), kg CO₂e per unit, read cell by cell (`from` = tab!cell).
 * Flights use the "to/from UK" rows; cars the "Average car" row of "Cars (by
 * size)"; fuel the forecourt "average biofuel blend" litres; hotels the
 * country's "Room per night" row. The workbook states AR5 GWPs (Introduction,
 * row 35).
 * A .ts module rather than factors.json: the build (tsc, no resolveJsonModule) does not ship JSON.
 */
import { COMMUTE_OPTIONS, travelMapping } from "./configs";

export interface TravelFactor {
  name: string;
  unit: string;
  factor_type: "life_cycle" | "combustion";
  gwp_set: "AR5" | "AR6";
  /** ISO-3166 alpha-2 or GLO (S3-2 `geography`): DEFRA factors are UK ones; hotel stays are per country. */
  geography: string;
  dataset: string;
  /** Per factor year: the value, the dataset version and where it was read. */
  values: Record<string, { value: number; dataset_version: string; from: string }>;
}

const unitOf = (name: string) => /\[([^\]]+)\]\s*$/.exec(name)?.[1] ?? "";

const HOTEL_GEOGRAPHY: Record<string, string> = {
  "United Kingdom": "GB",
  India: "IN",
  "United States": "US",
  "United Arab Emirates": "AE",
  Germany: "DE",
  France: "FR",
  Singapore: "SG",
  China: "CN",
};

/** DEFRA 2025 values by factor name (kg CO₂e per unit) and the cell each was read from. */
const DEFRA_2025: Record<string, { value: number; from: string }> = {
  "Flights - Domestic - Average passenger - With RF [passenger.km]": { value: 0.22928, from: "Business travel- air!E23" },
  "Flights - Domestic - Average passenger - Without RF [passenger.km]": { value: 0.13552, from: "Business travel- air!I23" },
  "Flights - Short-haul - Economy class - With RF [passenger.km]": { value: 0.12576, from: "Business travel- air!E25" },
  "Flights - Short-haul - Economy class - Without RF [passenger.km]": { value: 0.07435, from: "Business travel- air!I25" },
  "Flights - Short-haul - Business class - With RF [passenger.km]": { value: 0.18863, from: "Business travel- air!E26" },
  "Flights - Short-haul - Business class - Without RF [passenger.km]": { value: 0.11152, from: "Business travel- air!I26" },
  "Flights - Long-haul - Economy class - With RF [passenger.km]": { value: 0.11704, from: "Business travel- air!E28" },
  "Flights - Long-haul - Economy class - Without RF [passenger.km]": { value: 0.06926, from: "Business travel- air!I28" },
  "Flights - Long-haul - Premium economy class - With RF [passenger.km]": { value: 0.18726, from: "Business travel- air!E29" },
  "Flights - Long-haul - Premium economy class - Without RF [passenger.km]": { value: 0.11081, from: "Business travel- air!I29" },
  "Flights - Long-haul - Business class - With RF [passenger.km]": { value: 0.3394, from: "Business travel- air!E30" },
  "Flights - Long-haul - Business class - Without RF [passenger.km]": { value: 0.20083, from: "Business travel- air!I30" },
  "Flights - Long-haul - First class - With RF [passenger.km]": { value: 0.46814, from: "Business travel- air!E31" },
  "Flights - Long-haul - First class - Without RF [passenger.km]": { value: 0.27701, from: "Business travel- air!I31" },
  "Car - Average car - Diesel [vehicle.km]": { value: 0.17304, from: "Business travel- land!D53" },
  "Car - Average car - Petrol [vehicle.km]": { value: 0.16272, from: "Business travel- land!H53" },
  "Car - Average car - Hybrid [vehicle.km]": { value: 0.12825, from: "Business travel- land!L53" },
  "Car - Average car - Unknown fuel [vehicle.km]": { value: 0.16725, from: "Business travel- land!X53" },
  "Car - Average car - Plug-in hybrid [vehicle.km]": { value: 0.10461, from: "Business travel- land!AB53" },
  "Car - Average car - Battery electric [vehicle.km]": { value: 0.04047, from: "Business travel- land!AF53" },
  "Motorbike - Average [vehicle.km]": { value: 0.11367, from: "Business travel- land!D65" },
  "Taxi - Regular taxi [passenger.km]": { value: 0.14861, from: "Business travel- land!D71" },
  "Taxi - Regular taxi [vehicle.km]": { value: 0.20806, from: "Business travel- land!D72" },
  "Bus - Average local bus [passenger.km]": { value: 0.10385, from: "Business travel- land!D81" },
  "Bus - Coach [passenger.km]": { value: 0.02776, from: "Business travel- land!D82" },
  "Rail - National rail [passenger.km]": { value: 0.03546, from: "Business travel- land!D87" },
  "Rail - International rail [passenger.km]": { value: 0.00446, from: "Business travel- land!D88" },
  "Rail - Light rail and tram [passenger.km]": { value: 0.0286, from: "Business travel- land!D89" },
  "Rail - Underground [passenger.km]": { value: 0.0278, from: "Business travel- land!D90" },
  "Fuel - Diesel (average biofuel blend) [litre]": { value: 2.57082, from: "Fuels!D72" },
  "Fuel - Petrol (average biofuel blend) [litre]": { value: 2.06916, from: "Fuels!D96" },
  "Hotel stay - United Kingdom [night]": { value: 10.4, from: "Hotel stay!D22" },
  "Hotel stay - India [night]": { value: 58.9, from: "Hotel stay!D46" },
  "Hotel stay - United States [night]": { value: 16.1, from: "Hotel stay!D79" },
  "Hotel stay - United Arab Emirates [night]": { value: 63.8, from: "Hotel stay!D78" },
  "Hotel stay - Germany [night]": { value: 13.2, from: "Hotel stay!D43" },
  "Hotel stay - France [night]": { value: 6.7, from: "Hotel stay!D42" },
  "Hotel stay - Singapore [night]": { value: 24.5, from: "Hotel stay!D71" },
  "Hotel stay - China [night]": { value: 53.5, from: "Hotel stay!D35" },
};

/** Every factor name the standard forms map to, once. */
export const TRAVEL_FACTORS: TravelFactor[] = [...new Set([...Object.values(travelMapping()), ...Object.values(COMMUTE_OPTIONS)])].sort().map((name) => {
  const hotel = /^Hotel stay - (.+) \[night\]$/.exec(name)?.[1];
  const v2025 = DEFRA_2025[name];
  const values: TravelFactor["values"] = v2025 ? { "2025": { value: v2025.value, dataset_version: "2025 condensed v1", from: v2025.from } } : {};
  return {
    name,
    unit: unitOf(name),
    factor_type: "life_cycle",
    gwp_set: "AR5",
    geography: hotel ? (HOTEL_GEOGRAPHY[hotel] ?? "GLO") : "GB",
    dataset: "DEFRA",
    values,
  };
});
