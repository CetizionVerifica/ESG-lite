// Creates the import plan tables (IM2 in docs/mcp-import/backend/IM2-import-plans-api/CLAUDE.md):
// import_plan, import_plan_row and import_plan_match.
//
//   npm run migrate:import-plans
//
// The statements are exactly what TypeORM generates for the entities in
// src/entities/ImportPlan.ts (same constraint and index names), so
// ci/schema-diff.cjs finds nothing left to do. Idempotent (IF NOT EXISTS,
// constraints added only when missing) and additive: no existing table or
// column is changed, except that a database created by an earlier run of this
// script (created_by NOT NULL, ON DELETE CASCADE) is brought to the current
// shape: created_by nullable with ON DELETE SET NULL, so a plan and its
// source_name outlive the account that made it. The uuid-ossp extension backs the plan_id default, as
// TypeORM would create it itself on a synchronised database.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

const EXTENSIONS = [`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`];

const TABLES = [
  `CREATE TABLE IF NOT EXISTS "import_plan" ("plan_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_id" integer NOT NULL, "created_by" integer, "channel" character varying(20) NOT NULL, "source_name" character varying(200) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'draft', "version" integer NOT NULL DEFAULT '1', "counts" jsonb NOT NULL DEFAULT '{}', "totals" jsonb NOT NULL DEFAULT '{}', "issues_summary" jsonb NOT NULL DEFAULT '[]', "upload_batch_id" character varying, "idempotency_key" character varying(200), "committed" jsonb, "expires_at" TIMESTAMP NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_b9e18ffa0e77d70ecb792bcc4cf" UNIQUE ("idempotency_key"), CONSTRAINT "PK_0fdd2e6a2cf03bd805faf09c2f1" PRIMARY KEY ("plan_id"))`,
  `CREATE TABLE IF NOT EXISTS "import_plan_row" ("id" BIGSERIAL NOT NULL, "plan_id" uuid NOT NULL, "row_ref" character varying(200) NOT NULL, "position" integer NOT NULL, "input" jsonb NOT NULL, "state" character varying(10) NOT NULL DEFAULT 'issue', "issues" jsonb NOT NULL DEFAULT '[]', "result" jsonb, CONSTRAINT "UQ_d727849ef6275645d7783f7f05b" UNIQUE ("plan_id", "row_ref"), CONSTRAINT "PK_272e7f9a57652641a0c2fd56014" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "import_plan_match" ("id" BIGSERIAL NOT NULL, "plan_id" uuid NOT NULL, "site_id" integer NOT NULL, "category_id" integer NOT NULL, "sheet_name" character varying(300) NOT NULL, "factor_name" character varying(300) NOT NULL, CONSTRAINT "UQ_4943a23f76e589ac498ab03a5de" UNIQUE ("plan_id", "site_id", "category_id", "sheet_name"), CONSTRAINT "PK_0b3e75e28304c7ad5cf745e515c" PRIMARY KEY ("id"))`,
];

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS "IDX_065302344a2474ed1380dee1b0" ON "import_plan" ("company_id")`,
  `CREATE INDEX IF NOT EXISTS "IDX_87cdd8b12f65fbaa358e068c75" ON "import_plan" ("created_by")`,
  `CREATE INDEX IF NOT EXISTS "IDX_d6becef7eaaa7c0f68021593e8" ON "import_plan" ("status")`,
  // XI5: the Review rows attention filter and the uploader rule join on it.
  `CREATE INDEX IF NOT EXISTS "IDX_1980e1c19b18e5d90431b69500" ON "import_plan" ("upload_batch_id")`,
  `CREATE INDEX IF NOT EXISTS "IDX_3347f77eed3ad92e74b8b284c1" ON "import_plan_row" ("plan_id")`,
  `CREATE INDEX IF NOT EXISTS "IDX_2a9dd484ed3fb071bd83ad7110" ON "import_plan_match" ("plan_id")`,
];

const CREATED_BY_FK = "FK_87cdd8b12f65fbaa358e068c75d";

// [constraint name, statement]
const FOREIGN_KEYS: [string, string][] = [
  [`FK_065302344a2474ed1380dee1b03`, `ALTER TABLE "import_plan" ADD CONSTRAINT "FK_065302344a2474ed1380dee1b03" FOREIGN KEY ("company_id") REFERENCES "company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_87cdd8b12f65fbaa358e068c75d`, `ALTER TABLE "import_plan" ADD CONSTRAINT "FK_87cdd8b12f65fbaa358e068c75d" FOREIGN KEY ("created_by") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION`],
  [`FK_3347f77eed3ad92e74b8b284c15`, `ALTER TABLE "import_plan_row" ADD CONSTRAINT "FK_3347f77eed3ad92e74b8b284c15" FOREIGN KEY ("plan_id") REFERENCES "import_plan"("plan_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_2a9dd484ed3fb071bd83ad71105`, `ALTER TABLE "import_plan_match" ADD CONSTRAINT "FK_2a9dd484ed3fb071bd83ad71105" FOREIGN KEY ("plan_id") REFERENCES "import_plan"("plan_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
];

async function main() {
  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    for (const q of [...EXTENSIONS, ...TABLES, ...INDEXES]) await qr.query(q);
    // Earlier shape of this branch: created_by NOT NULL with ON DELETE CASCADE.
    await qr.query(`ALTER TABLE "import_plan" ALTER COLUMN "created_by" DROP NOT NULL`);
    const cascading = await qr.query(`SELECT 1 FROM pg_constraint WHERE conname = $1 AND confdeltype = 'c'`, [CREATED_BY_FK]);
    if (cascading.length > 0) await qr.query(`ALTER TABLE "import_plan" DROP CONSTRAINT "${CREATED_BY_FK}"`);
    for (const [name, q] of FOREIGN_KEYS) {
      const found = await qr.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [name]);
      if (found.length === 0) await qr.query(q);
    }
    await qr.commitTransaction();
    console.log("Import plan tables present.");
  } catch (err) {
    await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error("migrate:import-plans failed:", err);
  process.exit(1);
});
