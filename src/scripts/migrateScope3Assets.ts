// S3-11 · leased assets, franchises, investments (docs/scope3/01-contracts.md §4):
//
//   site.lease_role, site.lease_type, site.floor_area_m2 and the `investment`
//   table; the global categories 8, 13, 14 and 15 (scope 'Scope 3',
//   ghg_category set) when none carries that number yet; then the D10
//   backfill through the S3-1 boundary service: every company gets its 15
//   boundary rows, and a 13, 14 or 15 row still in `screening` that no person
//   changed becomes `not_relevant` with the D10 reason, for an Admin to confirm.
//
//   npm run migrate:scope3-assets
//
// Idempotent: IF NOT EXISTS / ON CONFLICT DO NOTHING, and the backfill only
// touches rows nobody edited (updated_by IS NULL), so a re-run changes
// nothing. Statements match what TypeORM generates for the entities, so
// ci/schema-diff.cjs sees nothing left to do. Logs counts only.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { ghgCategory } from "../scope3/contracts/ghgCategory";
import { D10_REASON, ensureBoundaryRows } from "../scope3/taxonomy/service";
import { ASSET_CATEGORIES } from "../scope3/assets/configs";

export const ASSETS_SCHEMA = [
  `ALTER TABLE "site" ADD COLUMN IF NOT EXISTS "lease_role" character varying(20)`,
  `ALTER TABLE "site" ADD COLUMN IF NOT EXISTS "lease_type" character varying(20)`,
  `ALTER TABLE "site" ADD COLUMN IF NOT EXISTS "floor_area_m2" numeric(14,2)`,
  `CREATE TABLE IF NOT EXISTS "investment" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "investee" character varying(200) NOT NULL, "type" character varying(20) NOT NULL DEFAULT 'equity', "share_pct" numeric(7,4) NOT NULL, "investee_scope12_tco2e" numeric(18,4), "year" integer NOT NULL, "source" character varying(200), "revenue" numeric(20,2), "currency" character varying(3), "eeio_sector" character varying(100), "sector_split" jsonb, "created_by" integer, "updated_by" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "CHK_investment_share_pct" CHECK ("share_pct" >= 0 AND "share_pct" <= 100), CONSTRAINT "PK_ad085a94bd56e031136925f681b" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_investment_company" ON "investment" ("company_id")`,
];

const BATCH = 1000;

/** Global Scope 3 categories for 8, 13, 14, 15 when no category has that number or the exact GHG name. */
async function ensureCategories(): Promise<number> {
  let created = 0;
  for (const n of ASSET_CATEGORIES) {
    const name = ghgCategory(n)!.name;
    const rows: any[] = await AppDataSource.query(
      `INSERT INTO category (category_name, scope, ghg_category)
       SELECT $1::varchar, 'Scope 3', $2::smallint
        WHERE NOT EXISTS (SELECT 1 FROM category WHERE ghg_category = $2::smallint OR lower(trim(category_name)) = lower($1::varchar))
       RETURNING category_id`,
      [name, n],
    );
    created += rows.length;
  }
  return created;
}

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of ASSETS_SCHEMA) await AppDataSource.query(sql);
    console.log("S3-11 lease columns and investment table present.");
    console.log(`S3-11 categories: ${await ensureCategories()} created.`);

    let companies = 0;
    let seeded = 0;
    let lastId = 0;
    for (;;) {
      const rows: { company_id: number }[] = await AppDataSource.query(
        `SELECT company_id FROM company WHERE company_id > $1 ORDER BY company_id LIMIT ${BATCH}`,
        [lastId],
      );
      if (!rows.length) break;
      lastId = rows[rows.length - 1].company_id;
      for (const { company_id } of rows) seeded += await ensureBoundaryRows(company_id);
      companies += rows.length;
    }
    // TypeORM returns [rows, count] for an UPDATE.
    const [defaulted]: [any[], number] = await AppDataSource.query(
      // Only untouched Screening rows of 13-15 (D10); WHERE kept on the UPDATE line for the data-safety check.
      `UPDATE company_scope3_category SET status = 'not_relevant', reason = $1, updated_at = now() WHERE ghg_category IN (13, 14, 15) AND status = 'screening' AND updated_by IS NULL
       RETURNING id`,
      [D10_REASON],
    );
    console.log(`S3-11 D10 backfill: ${companies} compan(ies), ${seeded} boundary row(s) seeded, ${defaulted.length} row(s) set to Not relevant.`);
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
