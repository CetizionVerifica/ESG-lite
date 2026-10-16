// S3-4 (D5): adds emission.total_kgco2e numeric(18,4) beside total_emission
// (tCO₂e, 2 dp) and backfills it for existing rows as total_emission × 1000.
// emissionWrite writes it on every insert and edit from then on.
//
//   npm run migrate:scope3-total-kgco2e
//
// npm start runs it (scripts/migrate-all.cjs) before the API starts.
// Idempotent: the column is added IF NOT EXISTS and only rows still null are
// backfilled, so a second run changes nothing.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(`ALTER TABLE emission ADD COLUMN IF NOT EXISTS total_kgco2e numeric(18,4) NULL`);
    const [, filled] = await AppDataSource.query(
      `UPDATE emission SET total_kgco2e = ROUND(total_emission::numeric * 1000, 4) WHERE total_kgco2e IS NULL AND total_emission IS NOT NULL`,
    );
    console.log(`emission.total_kgco2e present; ${filled ?? 0} rows backfilled.`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
