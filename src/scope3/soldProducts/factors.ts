/**
 * S3-10 factors seeded by migrate:scope3-sold-product-forms (and the plan, for
 * its own site), only where a site × category has none of that name and year.
 *
 * Category 12 (EOL_FACTORS): DESNZ/DEFRA "UK Government GHG Conversion Factors
 * for Company Reporting" 2025 (condensed set, version 1), "Waste disposal" tab,
 * per material × treatment, published in kg CO2e per tonne and converted to per
 * kg at seed time (÷ 1,000, noted in `source`). Factor year 2025, so rows dated
 * 2026 use them (targetYearFor); earlier rows fall back to the nearest year.
 * Recycling is DEFRA's closed-loop figure (open-loop where closed-loop is blank):
 * collection and transport only, the cut-off approach. factor_type `process`,
 * GWP set AR5 (DEFRA's), geography GB. Rows DEFRA leaves blank (e.g. composting
 * textiles) and the "Average (treatment unknown)" factors have no value: DEFRA
 * publishes no average across treatments, so those need the client's own factor.
 *
 * Category 11 (REFRIGERANT_AR6): the D7 AR6 rows, seeded where the standard
 * Category 11 form is in place.
 *
 * A .ts module rather than factors.json: the build (tsc, no resolveJsonModule) does not ship JSON.
 */
import { AR6_FACTOR_YEARS, MATERIALS, REFRIGERANT_FACTORS, eolFactorName, treatmentsFor } from "./configs";

export interface SeedFactor {
  name: string;
  unit: string;
  factor_type: "process" | "other";
  gwp_set: "AR4" | "AR5" | "AR6";
  geography: string;
  dataset: string;
  /** Per factor year: the value in kgCO₂e per `unit`, the dataset version and where it was read. */
  values: Record<string, { value: number; dataset_version: string; from: string }>;
}

/** Per tonne → per kg, for DEFRA's waste-disposal figures. */
export const perTonneToPerKg = (perTonne: number): number => Number((perTonne / 1000).toFixed(8));

/** The DEFRA 2025 "Waste disposal" row read for each material (column B, "Waste type"). */
export const DEFRA_WASTE_ROW: Record<(typeof MATERIALS)[number], { row: number; type: string }> = {
  Aluminium: { row: 66, type: "Metal: aluminium cans and foil (excl. forming)" },
  Steel: { row: 69, type: "Metal: steel cans" },
  Copper: { row: 68, type: "Metal: scrap metal" },
  Plastics: { row: 74, type: "Plastics: average plastics" },
  "Paper and board": { row: 88, type: "Paper and board: mixed" },
  Glass: { row: 42, type: "Glass" },
  Wood: { row: 36, type: "Wood" },
  Textiles: { row: 43, type: "Clothing" },
  Mixed: { row: 52, type: "Commercial and industrial waste" },
};

/** kg CO2e per tonne, DEFRA 2025 condensed set v1, "Waste disposal": [recycling (closed-loop, else open-loop), incineration with energy recovery, composting, landfill]; null = blank. */
const DEFRA_2025_PER_TONNE: Record<(typeof MATERIALS)[number], [number | null, number | null, number | null, number | null]> = {
  Aluminium: [4.68568, 4.68568, null, 8.98311],
  Steel: [4.68568, 4.68568, null, 8.98311],
  Copper: [4.68568, 4.68568, null, 8.98311],
  Plastics: [4.68568, 4.68568, null, 8.98311],
  "Paper and board": [4.68568, 4.68568, 8.98311, 1164.4894],
  Glass: [4.68568, 4.68568, null, 8.98311],
  Wood: [4.68568, 4.68568, 8.98311, 925.34348],
  Textiles: [4.68568, 4.68568, null, 496.78228],
  Mixed: [null, 4.68568, null, 520.5327],
};
const COLUMN = { recycling: 0, incineration: 1, composting: 2, landfill: 3 } as const;
const COLUMN_NAME = { recycling: "closed-loop", incineration: "incineration with energy recovery", composting: "composting", landfill: "landfill" } as const;

export const EOL_FACTORS: SeedFactor[] = MATERIALS.flatMap((material) =>
  [...treatmentsFor(material), "average" as const].map((t): SeedFactor => {
    const perTonne = t === "average" ? null : DEFRA_2025_PER_TONNE[material][COLUMN[t]];
    const src = DEFRA_WASTE_ROW[material];
    return {
      name: eolFactorName(material, t),
      unit: "kg",
      factor_type: "process" as const,
      gwp_set: "AR5" as const,
      geography: "GB",
      dataset: "DEFRA",
      values:
        perTonne === null || t === "average"
          ? {}
          : {
              "2025": {
                value: perTonneToPerKg(perTonne),
                dataset_version: "2025 condensed v1",
                from: `Waste disposal row ${src.row} "${src.type}", ${COLUMN_NAME[t]}, ${perTonne} kg/t ÷ 1,000`,
              },
            },
    };
  }),
);

export const REFRIGERANT_AR6: SeedFactor[] = REFRIGERANT_FACTORS.map((f) => ({
  name: f.name,
  unit: "kg",
  factor_type: "other" as const,
  gwp_set: "AR6" as const,
  geography: "GLO",
  dataset: "IPCC",
  values: Object.fromEntries(AR6_FACTOR_YEARS.map((y) => [String(y), { value: f.ar6, dataset_version: "AR6 GWP100", from: "IPCC AR6 WG1 Table 7.SM.7" }])),
}));
