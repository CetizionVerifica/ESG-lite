/**
 * S3-9 business travel, hotel stay and commuting factors (kgCO₂e per unit),
 * seeded by migrate:scope3-travel where a site × category has none of that
 * name and year. Names are the ones configs.ts maps the selects to.
 *
 * Source: DEFRA/DESNZ conversion factors, full set ("Business travel- air",
 * "Business travel- land", "Hotel stay"), with and without radiative forcing
 * for flights (the RF uplift is disclosed by the factor name, L4218, L4408),
 * factor_type life_cycle, GWP set AR5 (DEFRA's), geography GB.
 *
 * VALUES NOT YET FILLED: this container could not download the DEFRA 2025
 * full set, so `values` is empty and the seed adds no factor rows; clients
 * keep using their own uploaded factors until the values are transcribed
 * here (one entry per factor year, with the tab and row they were read from,
 * as S3-8's transport/factors.ts does). The forms, units and mappings work
 * without them.
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

/** Every factor name the standard forms map to, once. */
export const TRAVEL_FACTORS: TravelFactor[] = [...new Set([...Object.values(travelMapping()), ...Object.values(COMMUTE_OPTIONS)])].sort().map((name) => {
  const hotel = /^Hotel stay - (.+) \[night\]$/.exec(name)?.[1];
  return {
    name,
    unit: unitOf(name),
    factor_type: "life_cycle",
    gwp_set: "AR5",
    geography: hotel ? (HOTEL_GEOGRAPHY[hotel] ?? "GLO") : "GB",
    dataset: "DEFRA",
    values: {},
  };
});
