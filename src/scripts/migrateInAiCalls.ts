// IN-9 · the AI wording log (docs/insights/01-contracts.md §5):
//
//   insight_ai_call   id, company_id, user_id, card_rule varchar(40), model varchar(80),
//                     tokens_in, tokens_out, cost_usd numeric(8,4), ok, created_at;
//                     index (company_id, created_at) for the monthly budget (I14)
//
//   npm run migrate:in-ai-calls
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Additive. The
// statements are what TypeORM generates for InsightAiCall, so
// ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const IN9_AI_CALL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "insight_ai_call" ("id" SERIAL NOT NULL, "company_id" integer, "user_id" integer, "card_rule" character varying(40), "model" character varying(80), "tokens_in" integer, "tokens_out" integer, "cost_usd" numeric(8,4), "ok" boolean, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6b47cf7333afe5ec343e6ca45b2" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_insight_ai_call_company_created" ON "insight_ai_call" ("company_id", "created_at")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of IN9_AI_CALL_STATEMENTS) await AppDataSource.query(sql);
    console.log("IN-9 insight_ai_call present.");
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
