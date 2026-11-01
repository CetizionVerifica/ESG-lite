// AS-1 · the help assistant (docs/assistant/README.md):
//
//   company.assistant_enabled   boolean, default false (per-client switch, Superadmin only)
//   company.assistant_files_enabled  boolean, default false (attaching files, Superadmin only)
//   assistant_call              one row per model call: who, page, articles, model,
//                               tokens, cost, ok; never the question or the answer;
//                               indexes (company_id, created_at) and (user_id, created_at)
//                               for the budget; file_type, helpful and purpose added later
//
//   npm run migrate:as-1-assistant
//
// The statements match what TypeORM generates for Company.assistant_enabled and
// AssistantCall, so ci/schema-diff.cjs sees nothing left to do. Idempotent
// (IF NOT EXISTS) and additive; nothing is dropped or changed.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const AS1_STATEMENTS = [
  `ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "assistant_enabled" boolean NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS "assistant_call" ("id" BIGSERIAL NOT NULL, "company_id" integer, "user_id" integer, "role" character varying(20), "page_path" character varying(200), "article_ids" character varying(300), "sources" character varying(300), "answered" boolean, "model" character varying(80), "tokens_in" integer, "tokens_out" integer, "cost_usd" numeric(8,4), "ok" boolean, "error_code" character varying(40), "prompt_version" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_71092c06ff27f2d85f95b365a29" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_assistant_call_company_created" ON "assistant_call" ("company_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "IDX_assistant_call_user_created" ON "assistant_call" ("user_id", "created_at")`,
  `ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "assistant_files_enabled" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "assistant_call" ADD COLUMN IF NOT EXISTS "file_type" character varying(20)`,
  `ALTER TABLE "assistant_call" ADD COLUMN IF NOT EXISTS "helpful" boolean`,
  `ALTER TABLE "assistant_call" ADD COLUMN IF NOT EXISTS "purpose" character varying(20)`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of AS1_STATEMENTS) await AppDataSource.query(sql);
    console.log("AS-1 company.assistant_enabled, assistant_files_enabled and assistant_call present.");
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
