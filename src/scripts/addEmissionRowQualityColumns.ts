// S3-3 · Adds the "how it was calculated and how good the data is" columns:
// emission.method, emission.dq, emission.data_type, emission.is_estimate and
// column_config.method_options (docs/scope3/01-contracts.md §4).
//
//   npm run migrate:scope3-row-quality
//
// Columns only. It is listed early in package.json, before every Scope 3
// migration that loads the ColumnConfig or Emission entity (taxonomy, asset
// forms, travel, spend, sold-product forms): TypeORM selects every column an
// entity declares, so on a database that already has data those scripts fail
// with "column ColumnConfig.method_options does not exist" until this has run.
// It also lets S3-5's spend-form flip (migrate:scope3-spend) find the column
// on the first start. The backfill needs the taxonomy's ghg_category, so it
// is a separate, last step: migrate:scope3-row-quality-backfill.
//
// Idempotent (IF NOT EXISTS) and additive: every column is nullable or
// defaulted, so rows written before Scope 3 keep working (00-plan §2.4).
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(`ALTER TABLE emission ADD COLUMN IF NOT EXISTS method character varying(40) NULL`);
    await AppDataSource.query(`ALTER TABLE emission ADD COLUMN IF NOT EXISTS dq jsonb NULL`);
    await AppDataSource.query(`ALTER TABLE emission ADD COLUMN IF NOT EXISTS data_type character varying(16) NULL`);
    await AppDataSource.query(
      `ALTER TABLE emission ADD COLUMN IF NOT EXISTS is_estimate boolean NOT NULL DEFAULT false`,
    );
    await AppDataSource.query(`ALTER TABLE column_config ADD COLUMN IF NOT EXISTS method_options jsonb NULL`);
    console.log("emission.method, dq, data_type, is_estimate and column_config.method_options present.");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
