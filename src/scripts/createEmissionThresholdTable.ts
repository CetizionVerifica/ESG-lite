// Creates the emission_threshold table — the per-company variation threshold
// (see entities/Threshold.ts) that data entry compares an emission category's
// period total against.
//
//   npx ts-node src/scripts/createEmissionThresholdTable.ts
//
// This repo has no migration runner and TypeORM synchronize is opt-in only
// (TYPEORM_SYNC), so nothing else creates the table. It must run BEFORE the
// backend that ships the EmissionThreshold entity starts, or every
// /admin/thresholds read throws.
//
// The table name must stay `emission_threshold`: TypeORM snake_cases the
// EmissionThreshold class name and the entity sets no explicit table name.
//
// Idempotent (IF NOT EXISTS) and additive — no existing table is touched.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    const [{ exists }] = await AppDataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_name = 'emission_threshold'
       ) AS exists`,
    );

    if (exists) {
      console.log("emission_threshold already present — nothing to do.");
      return;
    }

    await AppDataSource.query(
      `CREATE TABLE IF NOT EXISTS emission_threshold (
         threshold_id         SERIAL PRIMARY KEY,
         company_id           INTEGER      NOT NULL,
         threshold_percentage DECIMAL(5,2) NOT NULL DEFAULT 5.00,
         created_at           TIMESTAMP    NOT NULL DEFAULT now(),
         updated_at           TIMESTAMP    NOT NULL DEFAULT now(),
         CONSTRAINT uq_emission_threshold_company UNIQUE (company_id),
         CONSTRAINT fk_emission_threshold_company FOREIGN KEY (company_id)
           REFERENCES company (company_id) ON DELETE CASCADE
       )`,
    );
    console.log("emission_threshold created.");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
