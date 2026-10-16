// S3-10 · sold products (docs/scope3/01-contracts.md §4, §10):
//
//   the `product_sale` table (monthly `period`, like emission.date),
//   product.lifetime_uses, product.eol_mix and the stand-in product.use_profile
//   (packaging per unit, how the product is used; S3-0 follow-up), and the
//   global Category 10 "Processing of sold products" (scope 'Scope 3',
//   ghg_category 10) when no category carries that number or name yet.
//
//   npm run migrate:scope3-sold-products
//
// Idempotent: IF NOT EXISTS / WHERE NOT EXISTS, so a re-run changes nothing.
// Statements match what TypeORM generates for the entities, so
// ci/schema-diff.cjs sees nothing left to do. Logs counts only.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { ghgCategory } from "../scope3/contracts/ghgCategory";

export const SOLD_PRODUCTS_SCHEMA = [
  `ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "lifetime_uses" numeric`,
  `ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "eol_mix" jsonb`,
  `ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "use_profile" jsonb`,
  `CREATE TABLE IF NOT EXISTS "product_sale" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "product_id" integer NOT NULL, "period" date NOT NULL, "quantity" numeric(18,4) NOT NULL, "unit" character varying(50) NOT NULL, "region" character varying(100), "created_by" integer, "updated_by" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_856c3e8465de416b20cd631d778" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_product_sale_company_period" ON "product_sale" ("company_id", "period")`,
  `CREATE INDEX IF NOT EXISTS "IDX_product_sale_product" ON "product_sale" ("product_id")`,
];

/** The global Category 10 when no category has that number or the exact GHG name. */
async function ensureCategory10(): Promise<number> {
  const name = ghgCategory(10)!.name;
  const rows: any[] = await AppDataSource.query(
    `INSERT INTO category (category_name, scope, ghg_category)
     SELECT $1::varchar, 'Scope 3', 10::smallint
      WHERE NOT EXISTS (SELECT 1 FROM category WHERE ghg_category = 10 OR lower(trim(category_name)) = lower($1::varchar))
     RETURNING category_id`,
    [name],
  );
  return rows.length;
}

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of SOLD_PRODUCTS_SCHEMA) await AppDataSource.query(sql);
    console.log("S3-10 product_sale table and product columns present.");
    console.log(`S3-10 Category 10: ${await ensureCategory10()} created.`);
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
