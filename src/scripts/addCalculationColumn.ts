// Adds column_config.calculation — the nullable jsonb that carries a category's
// multi-field calculation spec (see services/calculationSpec.ts).
//
//   npx ts-node src/scripts/addCalculationColumn.ts
//
// This repo has no migration runner and TypeORM synchronize is opt-in only
// (TYPEORM_SYNC), so nothing else creates the column. It must run BEFORE the
// backend that ships the ColumnConfig entity starts: TypeORM selects every
// mapped column, so without it *every* column_config read throws and the whole
// data-entry page fails — for all categories, not just the ones using a spec.
//
// Idempotent (IF NOT EXISTS) and additive: existing rows get NULL, which is
// exactly "normal one-value × factor category".
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    const [{ exists }] = await AppDataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'column_config' AND column_name = 'calculation'
       ) AS exists`,
    );

    if (exists) {
      console.log("column_config.calculation already present — nothing to do.");
      return;
    }

    await AppDataSource.query(
      `ALTER TABLE column_config ADD COLUMN IF NOT EXISTS calculation jsonb NULL`,
    );
    console.log("column_config.calculation added.");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
