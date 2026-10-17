// SE-4 · Form versions (ESG-lite_FE docs/simple-entry, SE-4 spec):
//   column_config_version   one row per publish: the form as it went live, by, at, note
//   emission.form_version    the form version a row was saved with (null: before SE-4)
//
//   npm run migrate:form-versions
//
// Listed right after migrate:entry-forms, before any migration that loads the
// Emission entity. Idempotent (IF NOT EXISTS) and additive: no existing row is
// read or written. Statements match what TypeORM generates for the entities,
// so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const FORM_VERSION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "column_config_version" ("id" SERIAL NOT NULL, "column_config_id" integer NOT NULL, "version" integer NOT NULL, "config" jsonb NOT NULL, "note" text, "published_by" integer, "published_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_578ebd72e1c3841f3337b61a0b2" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_column_config_version_config_version" ON "column_config_version" ("column_config_id", "version")`,
  `ALTER TABLE "emission" ADD COLUMN IF NOT EXISTS "form_version" integer`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of FORM_VERSION_STATEMENTS) await AppDataSource.query(sql);
    console.log("column_config_version and emission.form_version present.");
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
