// DS-5 · designs and their versions (docs/design-studio/modules/DS-5-reports-home-and-new, 01-contracts §3):
//
//   report_doc           company_id, year, year_type, title, status, draft jsonb (ReportDoc v2), rev,
//                        kind, purpose, format, inputs jsonb, source_doc_id, template_id, data_hash,
//                        build jsonb (auto-build progress), created_by, updated_by, deleted_at
//   report_doc_version   doc_id, n (unique per doc), kind (snapshot|review|final|autosave), rev, doc jsonb,
//                        data_snapshot, data_hash, design_version, renderer_hash, pdf_r2_key, pdf_sha256,
//                        page_count, note, created_by
//
//   npm run migrate:ds-5-docs
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Additive; no
// existing row changes. Statements match what TypeORM generates for
// StudioReportDoc and StudioReportDocVersion, so ci/schema-diff.cjs sees
// nothing left to do. A database where an earlier test made `report_doc`
// the 01-contracts §3 way gets the DS-5 columns added.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const DS5_DOCS_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "report_doc" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "year" integer NOT NULL, "year_type" character varying(2) NOT NULL, "title" character varying(200) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'draft', "draft" jsonb NOT NULL, "rev" integer NOT NULL DEFAULT '1', "kind" character varying(20) NOT NULL, "purpose" character varying(20) NOT NULL DEFAULT 'report', "format" character varying(20) NOT NULL DEFAULT 'a4', "inputs" jsonb NOT NULL DEFAULT '{}', "source_doc_id" integer, "template_id" integer, "data_hash" character varying(80), "build" jsonb, "created_by" integer, "updated_by" integer, "deleted_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_30a34fb3491c951b1ab472dc7fc" PRIMARY KEY ("id"))`,
  `ALTER TABLE "report_doc" ADD COLUMN IF NOT EXISTS "template_id" integer`,
  `ALTER TABLE "report_doc" ADD COLUMN IF NOT EXISTS "data_hash" character varying(80)`,
  `ALTER TABLE "report_doc" ADD COLUMN IF NOT EXISTS "build" jsonb`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_doc_company_year" ON "report_doc" ("company_id", "year")`,
  `CREATE TABLE IF NOT EXISTS "report_doc_version" ("id" SERIAL NOT NULL, "doc_id" integer NOT NULL, "n" integer NOT NULL, "kind" character varying(20) NOT NULL, "rev" integer, "doc" jsonb NOT NULL, "data_snapshot" jsonb, "data_hash" character varying(80), "design_version" integer, "renderer_hash" character varying(80), "pdf_r2_key" character varying(300), "pdf_sha256" character varying(80), "page_count" integer, "note" text, "created_by" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7b060d249ca6ec460b289a36b42" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_report_doc_version_doc_n" ON "report_doc_version" ("doc_id", "n")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of DS5_DOCS_STATEMENTS) await AppDataSource.query(sql);
    console.log("DS-5 report_doc and report_doc_version present.");
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
