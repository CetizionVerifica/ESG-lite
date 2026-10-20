// DS-2 (RS-2 R9) materiality scores for the sustainability report's matrix
// chart (docs/design-studio/modules/DS-2-data-sources):
//
//   company_material_topic.impact_score     numeric(3,1) null, 0–10
//   company_material_topic.financial_score  numeric(3,1) null, 0–10
//
//   npm run migrate:ds-2-materiality-scores
//
// The statements match what TypeORM generates for CompanyMaterialTopic, so
// ci/schema-diff.cjs sees nothing left to do. Idempotent (IF NOT EXISTS) and
// additive; nothing is dropped or changed.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const DS2_MATERIALITY_STATEMENTS = [
  `ALTER TABLE "company_material_topic" ADD COLUMN IF NOT EXISTS "impact_score" numeric(3,1)`,
  `ALTER TABLE "company_material_topic" ADD COLUMN IF NOT EXISTS "financial_score" numeric(3,1)`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of DS2_MATERIALITY_STATEMENTS) await AppDataSource.query(sql);
    console.log("company_material_topic.impact_score and financial_score present.");
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
