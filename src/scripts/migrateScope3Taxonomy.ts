// S3-1 · category taxonomy and Scope 3 boundary (docs/scope3/01-contracts.md §4):
//
//   category.ghg_category (smallint, 1–15), company.consolidation_approach,
//   tables company_scope3_category and category_ghg_map_proposal; then the
//   D1 backfill: a proposal per company × Scope 3 category in use, and the
//   company's 15 boundary rows.
//
//   npm run migrate:scope3-taxonomy
//
// Idempotent: everything is IF NOT EXISTS / ON CONFLICT DO NOTHING, so a
// re-run adds no duplicates and never changes a proposal, a confirmed number
// or a boundary row someone edited. category.ghg_category is written only for
// an exact GHG Protocol name (confidence 100). Statements match what TypeORM
// generates for the entities, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { ensureBoundaryRows, refreshProposals } from "../scope3/taxonomy/service";

export const TAXONOMY_SCHEMA = [
  `ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "ghg_category" smallint`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_category_ghg_category') THEN
       ALTER TABLE "category" ADD CONSTRAINT "CHK_category_ghg_category" CHECK ("ghg_category" IS NULL OR ("ghg_category" >= 1 AND "ghg_category" <= 15));
     END IF;
   END $$`,
  `ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "consolidation_approach" character varying(30) NOT NULL DEFAULT 'operational_control'`,
  `CREATE TABLE IF NOT EXISTS "company_scope3_category" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "ghg_category" smallint NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'screening', "reason" text, "method_note" text, "relevance" jsonb, "updated_by" integer, "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "CHK_company_scope3_category_n" CHECK ("ghg_category" >= 1 AND "ghg_category" <= 15), CONSTRAINT "PK_6a5de60b0937dec6be72a1ecccc" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_company_scope3_category_company_n" ON "company_scope3_category" ("company_id", "ghg_category")`,
  `CREATE TABLE IF NOT EXISTS "category_ghg_map_proposal" ("id" SERIAL NOT NULL, "category_id" integer NOT NULL, "company_id" integer NOT NULL, "ghg_category" smallint, "confidence" smallint NOT NULL DEFAULT '0', "basis" character varying(20) NOT NULL DEFAULT 'none', "confirmed_by" integer, "confirmed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "CHK_category_ghg_map_proposal_n" CHECK ("ghg_category" IS NULL OR ("ghg_category" >= 1 AND "ghg_category" <= 15)), CONSTRAINT "PK_3bfa210b17f6531b35496277a8c" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_category_ghg_map_proposal_company_category" ON "category_ghg_map_proposal" ("company_id", "category_id")`,
];

const BATCH = 1000;

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of TAXONOMY_SCHEMA) await AppDataSource.query(sql);
    console.log("S3-1 taxonomy columns and tables present.");

    let companies = 0;
    let proposed = 0;
    let applied = 0;
    let seeded = 0;
    let lastId = 0;
    for (;;) {
      const rows: { company_id: number }[] = await AppDataSource.query(
        `SELECT company_id FROM company WHERE company_id > $1 ORDER BY company_id LIMIT ${BATCH}`,
        [lastId],
      );
      if (!rows.length) break;
      lastId = rows[rows.length - 1].company_id;
      for (const { company_id } of rows) {
        // One company at a time, in its own transaction.
        await AppDataSource.transaction(async (m) => {
          const p = await refreshProposals(company_id, m);
          proposed += p.proposed;
          applied += p.applied;
          seeded += await ensureBoundaryRows(company_id, m);
        });
        companies++;
      }
    }
    console.log(
      `S3-1 backfill: ${companies} compan(ies), ${proposed} new proposal(s), ${applied} exact name(s) numbered, ${seeded} boundary row(s) seeded.`,
    );
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
