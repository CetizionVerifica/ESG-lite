// Smart Excel import (XI0, docs/excel-import/01-contracts.md):
//
//   company.ai_import_enabled   boolean, default false  (per-client switch)
//   import_plan.mapping         jsonb, nullable         (confirmed MappingProposal)
//
//   npm run migrate:ai-import
//
// Statements match what TypeORM generates for Company.ai_import_enabled and
// ImportPlan.mapping, so ci/schema-diff.cjs sees nothing left to do.
// Idempotent (IF NOT EXISTS) and additive; nothing is dropped or changed.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const AI_IMPORT_STATEMENTS = [
  `ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "ai_import_enabled" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "import_plan" ADD COLUMN IF NOT EXISTS "mapping" jsonb`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of AI_IMPORT_STATEMENTS) await AppDataSource.query(sql);
    console.log("company.ai_import_enabled and import_plan.mapping present.");
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
