/**
 * S3-10 factors seeded by migrate:scope3-sold-product-forms (and the plan, for
 * its own site), only where a site × category has none of that name and year.
 *
 * Category 12 (EOL_FACTORS): DEFRA/DESNZ conversion factors, "Waste disposal"
 * tab, per material × treatment, published per tonne and converted to per kg
 * at seed time (÷ 1,000, written into `source`); recycling is DEFRA's
 * closed-loop/open-loop collection figure (the cut-off approach), factor_type
 * `process`, GWP set AR5 (DEFRA's), geography GB.
 * VALUES NOT YET FILLED: this container could not download the DEFRA 2025 full
 * set (gov.uk is not reachable from it), so `values` is empty and no Category 12
 * factor rows are seeded; clients keep using their own uploaded factors under
 * these names until the values are transcribed here (one entry per factor
 * year, with the tab and row they were read from). The form, units and
 * mappings work without them. Same state as S3-9's commuting/factors.ts.
 *
 * Category 11 (REFRIGERANT_AR6): the D7 AR6 rows, seeded where the standard
 * Category 11 form is in place.
 *
 * A .ts module rather than factors.json: the build (tsc, no resolveJsonModule) does not ship JSON.
 */
import { AR6_FROM_YEAR, MATERIALS, REFRIGERANT_FACTORS, eolFactorName, treatmentsFor } from "./configs";

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

export const EOL_FACTORS: SeedFactor[] = MATERIALS.flatMap((material) =>
  [...treatmentsFor(material), "average" as const].map((t) => ({
    name: eolFactorName(material, t),
    unit: "kg",
    factor_type: "process" as const,
    gwp_set: "AR5" as const,
    geography: "GB",
    dataset: "DEFRA",
    values: {},
  })),
);

export const REFRIGERANT_AR6: SeedFactor[] = REFRIGERANT_FACTORS.map((f) => ({
  name: f.name,
  unit: "kg",
  factor_type: "other" as const,
  gwp_set: "AR6" as const,
  geography: "GLO",
  dataset: "IPCC",
  values: { [String(AR6_FROM_YEAR)]: { value: f.ar6, dataset_version: "AR6 GWP100", from: "IPCC AR6 WG1 Table 7.SM.7" } },
}));
