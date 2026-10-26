// Adds column_config.column_order (integer[], null): the order of a form's
// fields as column ids. The form ↔ field join (column_config_columns) has no
// position, so the builder's order was lost on save. Forms saved before this
// keep null and read their fields as before (src/forms/columnOrder.ts).
//
//   npm run migrate:form-field-order
//
// Listed right before migrate:entry-forms, ahead of every migration that loads
// ColumnConfig: TypeORM selects every declared column. Idempotent (IF NOT EXISTS) and additive.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(`ALTER TABLE column_config ADD COLUMN IF NOT EXISTS column_order integer[]`);
    console.log("column_config.column_order present.");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
