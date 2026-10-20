// DS-11 · render jobs and view links (docs/design-studio/modules/DS-11-preview-download-share, 01-contracts §3):
//
//   report_job     company_id, doc_id, version_id, kind (proof|final|thumbnail|png|print), status,
//                  rev, options jsonb, doc jsonb (cleared when done), note, acknowledged_warnings,
//                  error_code, attempts, requested_by, started_at, finished_at, file_key (private),
//                  content_type, bytes, sha256, page_count, measurements, proof_expires_at
//   report_share   company_id, doc_id, version_id | job_id, token_hash (sha256, unique), expires_at,
//                  revoked_at, revoked_by, created_by, views, last_viewed_at
//
//   npm run migrate:ds-11-outputs
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Additive. The
// statements are what TypeORM generates for StudioReportJob and
// StudioReportShare, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const DS11_OUTPUT_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "report_job" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "doc_id" integer NOT NULL, "version_id" integer, "kind" character varying(20) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'queued', "rev" integer NOT NULL, "options" jsonb NOT NULL DEFAULT '{}', "doc" jsonb, "note" text, "acknowledged_warnings" jsonb, "error_code" character varying(40), "attempts" integer NOT NULL DEFAULT '0', "requested_by" integer, "started_at" TIMESTAMP, "finished_at" TIMESTAMP, "file_key" character varying(300), "content_type" character varying(80), "bytes" integer, "sha256" character varying(80), "page_count" integer, "measurements" jsonb, "proof_expires_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_35e715439e5691b45a9e4710aeb" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_job_doc" ON "report_job" ("doc_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_job_status_created" ON "report_job" ("status", "created_at")`,
  `CREATE TABLE IF NOT EXISTS "report_share" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "doc_id" integer NOT NULL, "version_id" integer, "job_id" integer, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP NOT NULL, "revoked_at" TIMESTAMP, "revoked_by" integer, "created_by" integer, "views" integer NOT NULL DEFAULT '0', "last_viewed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_818f8c1397a8942a9cccf32a3d4" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_share_doc" ON "report_share" ("doc_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_report_share_token_hash" ON "report_share" ("token_hash")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of DS11_OUTPUT_STATEMENTS) await AppDataSource.query(sql);
    console.log("DS-11 report_job and report_share present.");
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
