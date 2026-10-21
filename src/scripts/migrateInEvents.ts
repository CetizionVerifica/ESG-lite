// IN-4 · Insights events (docs/insights/01-contracts.md §5):
//
//   insight_event   id, company_id, site_id (null: company level), date, label varchar(60),
//                   kind varchar(20), created_by, created_at, updated_at; index (company_id, date)
//
//   npm run migrate:in-events
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Additive. The
// statements are what TypeORM generates for InsightEvent, so
// ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const IN4_EVENTS_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "insight_event" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "site_id" integer, "date" date NOT NULL, "label" character varying(60) NOT NULL, "kind" character varying(20) NOT NULL, "created_by" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1011cbb20829692017d6adfd087" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_insight_event_company_date" ON "insight_event" ("company_id", "date")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of IN4_EVENTS_STATEMENTS) await AppDataSource.query(sql);
    console.log("IN-4 insight_event present.");
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
