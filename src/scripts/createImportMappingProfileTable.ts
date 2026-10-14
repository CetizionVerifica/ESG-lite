// Creates the mapping-memory table of the smart Excel import (XI3,
// docs/excel-import/modules/XI3-mapping-memory/CLAUDE.md, contracts §3):
// import_mapping_profile, one confirmed sheet mapping per company × header
// fingerprint × site × category.
//
//   npm run migrate:mapping-profiles
//
// The statements are exactly what TypeORM generates for
// src/entities/ImportMappingProfile.ts (same constraint and index names), so
// ci/schema-diff.cjs finds nothing left to do. Idempotent (IF NOT EXISTS,
// constraints added only when missing) and additive: no existing table or
// column is touched. The uuid-ossp extension backs the id default, as for
// import_plan.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

const EXTENSIONS = [`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`];

const TABLES = [
  `CREATE TABLE IF NOT EXISTS "import_mapping_profile" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_id" integer NOT NULL, "site_id" integer NOT NULL, "category_id" integer, "fingerprint" character varying(64) NOT NULL, "sheet_proposal" jsonb NOT NULL, "confirmed_by" integer, "confirmed_at" TIMESTAMP, "uses" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_9ca2bd4b0278e83f19b22671cd2" UNIQUE ("company_id", "fingerprint", "site_id", "category_id"), CONSTRAINT "PK_779c009a7ba593bfdafeafcfa2d" PRIMARY KEY ("id"))`,
];

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS "IDX_8cd81d6854910c3cf120e207a4" ON "import_mapping_profile" ("company_id")`,
  `CREATE INDEX IF NOT EXISTS "IDX_49523f1105095e095ad8db7d67" ON "import_mapping_profile" ("fingerprint")`,
];

// [constraint name, statement]
const FOREIGN_KEYS: [string, string][] = [
  [`FK_8cd81d6854910c3cf120e207a45`, `ALTER TABLE "import_mapping_profile" ADD CONSTRAINT "FK_8cd81d6854910c3cf120e207a45" FOREIGN KEY ("company_id") REFERENCES "company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_4c5ab71bfef9929a396b0ffd187`, `ALTER TABLE "import_mapping_profile" ADD CONSTRAINT "FK_4c5ab71bfef9929a396b0ffd187" FOREIGN KEY ("site_id") REFERENCES "site"("site_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_90bf2a73a773aa9c0295590ab49`, `ALTER TABLE "import_mapping_profile" ADD CONSTRAINT "FK_90bf2a73a773aa9c0295590ab49" FOREIGN KEY ("category_id") REFERENCES "category"("category_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_b930752a5d9b30c90f8752cbcc9`, `ALTER TABLE "import_mapping_profile" ADD CONSTRAINT "FK_b930752a5d9b30c90f8752cbcc9" FOREIGN KEY ("confirmed_by") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION`],
];

async function main() {
  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    for (const q of [...EXTENSIONS, ...TABLES, ...INDEXES]) await qr.query(q);
    for (const [name, q] of FOREIGN_KEYS) {
      const found = await qr.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [name]);
      if (found.length === 0) await qr.query(q);
    }
    await qr.commitTransaction();
    console.log("import_mapping_profile present.");
  } catch (err) {
    await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error("migrate:mapping-profiles failed:", err);
  process.exit(1);
});
