// DS-13 · collaboration (docs/design-studio/modules/DS-13-collaboration-and-review, 01-contracts §3):
//
//   company               + report_require_review boolean not null default false,
//                         + brand_controls boolean not null default false
//   report_comment        company_id, doc_id, page_id, element_id, x, y (pin, mm), parent_id, body,
//                         author_id, mentions int[], task_assignee_id, task_done_at, task_done_by,
//                         resolved_by, resolved_at, deleted_at
//   report_approval       company_id, doc_id, rev, requested_by, reviewer_id, due_at, state, note,
//                         decision_note, decided_at, decided_by
//   report_data_baseline  doc_id, data_hash, values jsonb (drift "before" figures)
//
//   npm run migrate:ds-13-collab
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Additive. The
// statements are what TypeORM generates for the entities, so ci/schema-diff.cjs
// sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const DS13_COLLAB_STATEMENTS = [
  `ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "report_require_review" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "brand_controls" boolean NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS "report_comment" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "doc_id" integer NOT NULL, "page_id" character varying(120) NOT NULL, "element_id" character varying(120), "x" real, "y" real, "parent_id" integer, "body" text NOT NULL, "author_id" integer NOT NULL, "mentions" integer array NOT NULL DEFAULT '{}', "task_assignee_id" integer, "task_done_at" TIMESTAMP, "task_done_by" integer, "resolved_by" integer, "resolved_at" TIMESTAMP, "deleted_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_8bb2bc4a3d9c55e031bc5d015c5" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_comment_doc" ON "report_comment" ("doc_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_comment_task" ON "report_comment" ("task_assignee_id")`,
  `CREATE TABLE IF NOT EXISTS "report_approval" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "doc_id" integer NOT NULL, "rev" integer NOT NULL, "requested_by" integer NOT NULL, "reviewer_id" integer NOT NULL, "due_at" date, "state" character varying(20) NOT NULL DEFAULT 'requested', "note" text, "decision_note" text, "decided_at" TIMESTAMP, "decided_by" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5c277ac19c5118165a883d0cda4" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_approval_doc" ON "report_approval" ("doc_id", "created_at")`,
  `CREATE TABLE IF NOT EXISTS "report_data_baseline" ("id" SERIAL NOT NULL, "doc_id" integer NOT NULL, "data_hash" character varying(80) NOT NULL, "values" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7c3b293dabd634662c93731bf3b" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_report_data_baseline_doc_hash" ON "report_data_baseline" ("doc_id", "data_hash")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of DS13_COLLAB_STATEMENTS) await AppDataSource.query(sql);
    console.log("DS-13 report_comment, report_approval, report_data_baseline and the company review columns present.");
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
