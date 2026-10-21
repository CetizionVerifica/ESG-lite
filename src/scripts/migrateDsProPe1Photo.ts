// PE-1 · photo edit: background-remover jobs and derived assets (docs/design-studio/pro/PE-1.md):
//
//   report_image_job   company_id, kind (remove_background), asset_id (the source, kept), status,
//                      result_asset_id, error_code, error_reason, engine, attempts, requested_by,
//                      started_at, finished_at
//   report_asset       + derived_from (the source asset id), + derived_op (remove_background)
//
//   npm run migrate:ds-pro-pe-1-photo
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Additive. The
// statements are what TypeORM generates for StudioImageJob and the two new
// StudioAsset columns, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const DS_PRO_PE1_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "report_image_job" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "kind" character varying(30) NOT NULL, "asset_id" uuid NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'queued', "result_asset_id" uuid, "error_code" character varying(40), "error_reason" character varying(40), "engine" character varying(80), "attempts" integer NOT NULL DEFAULT '0', "requested_by" integer, "started_at" TIMESTAMP, "finished_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ae4fc6cec77317b2cfbb54ca9de" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_image_job_status" ON "report_image_job" ("status", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_image_job_company" ON "report_image_job" ("company_id", "created_at")`,
  `ALTER TABLE "report_asset" ADD COLUMN IF NOT EXISTS "derived_from" uuid`,
  `ALTER TABLE "report_asset" ADD COLUMN IF NOT EXISTS "derived_op" character varying(30)`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of DS_PRO_PE1_STATEMENTS) await AppDataSource.query(sql);
    console.log("PE-1 report_image_job and report_asset.derived_from present.");
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
