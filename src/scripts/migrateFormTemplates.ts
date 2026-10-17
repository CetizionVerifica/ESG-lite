// SE-6 · Form templates (ESG-lite_FE docs/simple-entry, SE-6 spec):
//   form_template   name, client (null: global), category, the form as a version stores it, by, at
//
//   npm run migrate:form-templates
//
// Listed right after migrate:form-versions. Idempotent (IF NOT EXISTS) and additive. Statements match
// what TypeORM generates for the entity, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const FORM_TEMPLATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "form_template" ("id" SERIAL NOT NULL, "name" character varying(120) NOT NULL, "company_id" integer, "category_id" integer NOT NULL, "category_name" character varying(255) NOT NULL, "config" jsonb NOT NULL, "created_by" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_656844082de48d37a2c8fb7cfdb" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_form_template_category" ON "form_template" ("category_id")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of FORM_TEMPLATE_STATEMENTS) await AppDataSource.query(sql);
    console.log("form_template present.");
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
