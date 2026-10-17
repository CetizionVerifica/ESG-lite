// SE-2 · Simple data entry: what a form fixes for the person entering data
// (ESG-lite_FE docs/simple-entry; spec in src/forms/CLAUDE.md).
//
//   npm run migrate:entry-forms
//
// column_config: method_by_choice (a choice field's answers pick the method),
// field_settings (label, help, default, hidden, readonly, required per field),
// units ({fixed}), currency ({fixed}) and version. company: default_currency
// (INR for current clients, decision 4) and entry_detail ("total" by default:
// a User sees their fields and the total, SE-1). method_options is S3-3's
// column (migrate:scope3-row-quality); it is added here too only when missing.
//
// Columns only, listed right after migrate:scope3-row-quality: TypeORM selects
// every column an entity declares, so a later migration that loads ColumnConfig
// or Company would fail on a database without them.
//
// Idempotent (IF NOT EXISTS) and additive: every column is nullable or
// defaulted, so forms and companies keep working as they are. No row of
// emission data is read or written.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(`ALTER TABLE column_config ADD COLUMN IF NOT EXISTS method_options jsonb NULL`);
    await AppDataSource.query(`ALTER TABLE column_config ADD COLUMN IF NOT EXISTS method_by_choice jsonb NULL`);
    await AppDataSource.query(`ALTER TABLE column_config ADD COLUMN IF NOT EXISTS field_settings jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await AppDataSource.query(`ALTER TABLE column_config ADD COLUMN IF NOT EXISTS units jsonb NULL`);
    await AppDataSource.query(`ALTER TABLE column_config ADD COLUMN IF NOT EXISTS currency jsonb NULL`);
    await AppDataSource.query(`ALTER TABLE column_config ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1`);
    await AppDataSource.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS default_currency character varying(3) NOT NULL DEFAULT 'INR'`);
    await AppDataSource.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS entry_detail character varying(8) NOT NULL DEFAULT 'total'`);
    console.log(
      "column_config.method_by_choice, field_settings, units, currency, version and company.default_currency, entry_detail present.",
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
