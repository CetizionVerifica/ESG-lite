// #209 · KPIs in tonnes of CO₂e show 3 decimals, as every tCO₂e figure in the app does
// (src/services/emissionWrite/round.ts TONNES_DP). data/kpi/definitions.json carries 3 for
// GHG_SCOPE1, GHG_SCOPE2_LB, GHG_SCOPE2_MB and GHG_SCOPE3; this moves the rows already in a
// database:
//
//   kpi_definition.decimals = 3   every row whose canonical unit is tonnes of CO₂e (any spelling:
//                                 values/units.ts normaliseUnit → "tco2e"), library rows and
//                                 company rows alike, that no person ever saved
//
//   npm run migrate:kpi-tonnes-decimals        (after migrate:kpi-library-seed)
//
// Which rows: the rule applySeed uses (src/kpi/library/seed.ts). A row with `edited_at` set was
// saved by a person (a Superadmin's library edit, an Admin's own KPI: both stamp it), so its
// decimals are that person's choice and are never touched. A row with `edited_at` null holds what
// a seed or script wrote, and follows the library. `edited_at` is not stamped here, so a later
// re-seed still refreshes the row. Kilograms, intensities ("tCO2e per INR crore") and every other
// unit are left as they are.
//
// Idempotent: only rows not yet at 3 are read and updated, so a second run changes nothing.
// `decimals` is display precision only: no KPI value, emission row or total is touched.
import "reflect-metadata";
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { normaliseUnit } from "../kpi/values/units";
import { TONNES_DP } from "../services/emissionWrite/round";

/** The units registry key of tonnes of CO₂e (src/kpi/values/units.ts KPI_UNITS). */
export const TONNES_UNIT_KEY = "tco2e";

/** Rows that may move: never saved by a person and not at TONNES_DP yet. The unit is matched in TS (normaliseUnit). */
export const TONNES_DECIMALS_CANDIDATES = `SELECT "id", "canonical_unit" FROM "kpi_definition" WHERE "edited_at" IS NULL AND "decimals" <> $1 AND "canonical_unit" IS NOT NULL ORDER BY "id"`;
/** The update repeats the guard, so a row a person saved after the read keeps its decimals. */
export const SET_TONNES_DECIMALS = `UPDATE "kpi_definition" SET "decimals" = $1 WHERE "id" = ANY($2::int[]) AND "edited_at" IS NULL AND "decimals" <> $1`;

/** Sets TONNES_DP decimals on the unedited tCO₂e KPIs. Returns the rows changed. */
export async function setTonnesDecimals(m: Pick<EntityManager, "query">): Promise<number> {
  const [table] = await m.query(`SELECT to_regclass('kpi_definition') IS NOT NULL AS ok`);
  if (!table?.ok) throw new Error("kpi_definition is missing: run migrate:kpi-library first");
  const rows: Array<{ id: number; canonical_unit: string | null }> = await m.query(TONNES_DECIMALS_CANDIDATES, [TONNES_DP]);
  const ids = rows.filter((r) => normaliseUnit(r.canonical_unit) === TONNES_UNIT_KEY).map((r) => Number(r.id));
  if (!ids.length) return 0;
  const [done] = await m.query(`WITH done AS (${SET_TONNES_DECIMALS} RETURNING "id") SELECT COUNT(*)::int AS n FROM done`, [TONNES_DP, ids]);
  return Number(done?.n ?? 0);
}

async function main() {
  await AppDataSource.initialize();
  try {
    const updated = await AppDataSource.transaction((m) => setTonnesDecimals(m));
    console.log(`#209 kpi_definition: ${updated} tCO2e KPI(s) set to ${TONNES_DP} decimals.`);
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
