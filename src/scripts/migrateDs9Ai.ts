// DS-9 · the AI call log (docs/design-studio/modules/DS-9-ai-assistant, 01-contracts §3):
//
//   report_ai_call   company_id, doc_id (null: design from a brief), action, model, tokens_in,
//                    tokens_out, cost_usd numeric(10,5), ok, error_code, user_id
//
//   npm run migrate:ds-9-ai
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Additive. The
// statements are what TypeORM generates for StudioAiCall, so
// ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const DS9_AI_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "report_ai_call" ("id" BIGSERIAL NOT NULL, "company_id" integer NOT NULL, "doc_id" integer, "action" character varying(40) NOT NULL, "model" character varying(120) NOT NULL, "tokens_in" integer NOT NULL DEFAULT '0', "tokens_out" integer NOT NULL DEFAULT '0', "cost_usd" numeric(10,5) NOT NULL DEFAULT '0', "ok" boolean NOT NULL, "error_code" character varying(40), "user_id" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2ab4b284b4527b78301c3df6613" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_ai_call_doc_created" ON "report_ai_call" ("doc_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_ai_call_company_created" ON "report_ai_call" ("company_id", "created_at")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of DS9_AI_STATEMENTS) await AppDataSource.query(sql);
    console.log("DS-9 report_ai_call present.");
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
