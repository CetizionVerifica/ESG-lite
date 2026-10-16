// S3-4 (contracts §4): adds emission.gas_kg jsonb (kg of CO2, CH4 and N2O)
// and emission.biogenic_kg numeric(18,4) beside total_kgco2e. emissionWrite
// fills them from the factor's gas parts on every insert and edit. Existing
// rows stay null ("Not tracked" in the report): nothing is backfilled.
//
//   npm run migrate:scope3-gas-kg
//
// npm start runs it (scripts/migrate-all.cjs) before the API starts.
// Idempotent: both columns are added IF NOT EXISTS, so a second run changes nothing.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(`ALTER TABLE emission ADD COLUMN IF NOT EXISTS gas_kg jsonb NULL`);
    await AppDataSource.query(`ALTER TABLE emission ADD COLUMN IF NOT EXISTS biogenic_kg numeric(18,4) NULL`);
    console.log("emission.gas_kg and emission.biogenic_kg present.");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
