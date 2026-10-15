/**
 * S3-8 transport and warehousing factors (kgCO₂e per unit), seeded by
 * migrate:scope3-transport where a site × category has none of that name and year.
 *
 * Fuel factors are life cycle (guidance L1220-1238): DEFRA "Fuels" (combustion) +
 * "WTT- fuels" (well-to-tank), transcribed from the DEFRA 2024 and 2025 full sets
 * (data/emission-factor-sources). Refrigerants are AR6 GWP100 per D7.
 * Not seeded: grid electricity (DEFRA 2025 has a UK factor only; overseas factors
 * are sold by the IEA) and the per-day storage factors. The client adds those.
 * The factor table stores 4 decimal places.
 * A .ts module rather than factors.json: the build (tsc, no resolveJsonModule) does not ship JSON.
 */
export interface TransportFactor {
  name: string;
  unit: string;
  factor_type: "life_cycle" | "other";
  gwp_set: "AR5" | "AR6";
  dataset: string;
  /** Per factor year: the value, the dataset version and where it was read. */
  values: Record<string, { value: number; dataset_version: string; from: string }>;
}

export const TRANSPORT_FACTORS: TransportFactor[] = [
  {
    name: "Fuel - Diesel (average biofuel blend) [litre]",
    unit: "litre",
    factor_type: "life_cycle",
    gwp_set: "AR5",
    dataset: "DEFRA",
    values: {
      2024: { value: 3.1238, dataset_version: "2024", from: "Fuels row 71 litres 2.51279 + WTT- fuels row 70 litres 0.61101" },
      2025: { value: 3.18183, dataset_version: "2025", from: "Fuels row 71 litres 2.57082 + WTT- fuels row 70 litres 0.61101" },
    },
  },
  {
    name: "Fuel - Petrol (average biofuel blend) [litre]",
    unit: "litre",
    factor_type: "life_cycle",
    gwp_set: "AR5",
    dataset: "DEFRA",
    values: {
      2024: { value: 2.66534, dataset_version: "2024", from: "Fuels row 95 litres 2.0844 + WTT- fuels row 94 litres 0.58094" },
      2025: { value: 2.6501, dataset_version: "2025", from: "Fuels row 95 litres 2.06916 + WTT- fuels row 94 litres 0.58094" },
    },
  },
  {
    name: "Fuel - LPG [litre]",
    unit: "litre",
    factor_type: "life_cycle",
    gwp_set: "AR5",
    dataset: "DEFRA",
    values: {
      2024: { value: 1.74264, dataset_version: "2024", from: "Fuels row 35 litres 1.55713 + WTT- fuels row 34 litres 0.18551" },
      2025: { value: 1.74264, dataset_version: "2025", from: "Fuels row 35 litres 1.55713 + WTT- fuels row 34 litres 0.18551" },
    },
  },
  {
    name: "Fuel - Natural gas [kWh]",
    unit: "kWh",
    factor_type: "life_cycle",
    gwp_set: "AR5",
    dataset: "DEFRA",
    values: {
      2024: { value: 0.21311, dataset_version: "2024", from: "Fuels row 41 kWh (Gross CV) 0.1829 + WTT- fuels row 40 kWh (Gross CV) 0.03021" },
      2025: { value: 0.21317, dataset_version: "2025", from: "Fuels row 41 kWh (Gross CV) 0.18296 + WTT- fuels row 40 kWh (Gross CV) 0.03021" },
    },
  },
  {
    name: "Refrigerant - R134a [kg]",
    unit: "kg",
    factor_type: "other",
    gwp_set: "AR6",
    dataset: "IPCC AR6",
    values: {
      2024: { value: 1530, dataset_version: "AR6 WG1 Table 7.SM.7", from: "D7: R134a 1530" },
      2025: { value: 1530, dataset_version: "AR6 WG1 Table 7.SM.7", from: "D7: R134a 1530" },
    },
  },
  {
    name: "Refrigerant - R410A [kg]",
    unit: "kg",
    factor_type: "other",
    gwp_set: "AR6",
    dataset: "IPCC AR6",
    values: {
      2024: { value: 2256, dataset_version: "AR6 WG1 Table 7.SM.7", from: "D7: R410A 2256 (50 % R32, 50 % R125)" },
      2025: { value: 2256, dataset_version: "AR6 WG1 Table 7.SM.7", from: "D7: R410A 2256 (50 % R32, 50 % R125)" },
    },
  },
];
