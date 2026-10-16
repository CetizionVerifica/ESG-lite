// S3-5 · migrate:scope3-spend (docs/scope3/01-contracts.md §4):
//
//   fx_rate and price_deflator tables, emission.fx; the US CPI-U annual series
//   (BLS, public) that deflates USEEIO factors; USEEIO library factors from
//   any EPA file in data/scope3/useeio/; and, once S3-3's
//   column_config.method_options exists, Category 1 and 2 forms that already
//   have both "spent_value" and "currency" offer "From the amount spent"
//   (["average_data", "spend_based"]) when they offer nothing yet. See the
//   ordering note on flipSpendForms: with S3-3 this step only takes effect on
//   a later run, or not at all if S3-3 fills method_options first.
//
//   npm run migrate:scope3-spend
//
// Rates are not loaded here (no network in a migration): the daily FX job
// (src/scope3/spend/fxJob.ts) backfills 2019 → today on its first run.
// Idempotent: IF NOT EXISTS / ON CONFLICT DO NOTHING / only rows still null;
// statements match what TypeORM generates, so ci/schema-diff.cjs sees nothing
// left to do. Never changes a stored value. Logs counts only.
import "reflect-metadata";
import fs from "fs";
import path from "path";
import { AppDataSource } from "../config/data-source";
import { readUseeio, seedUseeio } from "../scope3/spend/useeio";

export const SPEND_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS "fx_rate" ("id" SERIAL NOT NULL, "currency" character varying(3) NOT NULL, "date" date NOT NULL, "rate_to_usd" numeric(20,10) NOT NULL, "source" character varying(100) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_fx_rate_currency_date" UNIQUE ("currency", "date"), CONSTRAINT "PK_172deb302807396e0da8f0aafe0" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "price_deflator" ("id" SERIAL NOT NULL, "country" character varying(16) NOT NULL, "year" integer NOT NULL, "index" numeric(12,4) NOT NULL, "source" character varying(100) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_price_deflator_country_year" UNIQUE ("country", "year"), CONSTRAINT "PK_96d96cf007277aab7c03e013e45" PRIMARY KEY ("id"))`,
  `ALTER TABLE "emission" ADD COLUMN IF NOT EXISTS "fx" jsonb`,
];

/**
 * US CPI-U, U.S. city average, all items, annual average (BLS series
 * CUUR0000SA0, 1982–84 = 100). Only ratios between years are used. Later
 * years are added by a Superadmin with POST /scope3/deflators once BLS
 * publishes them; until then a later spend year uses the latest year here
 * (DEFLATOR_FALLBACK_YEAR).
 */
export const US_CPI_U: Array<[number, number]> = [
  [2015, 237.017],
  [2016, 240.007],
  [2017, 245.12],
  [2018, 251.107],
  [2019, 255.657],
  [2020, 258.811],
  [2021, 270.97],
  [2022, 292.655],
  [2023, 304.702],
  [2024, 313.689],
  [2025, 321.943],
];
export const US_CPI_U_SOURCE = "BLS CPI-U annual average (1982-84=100)";

export const USEEIO_DIR = path.resolve(process.cwd(), "data/scope3/useeio");

async function seedCpi(): Promise<number> {
  let added = 0;
  for (const [year, index] of US_CPI_U) {
    const rows: unknown[] = await AppDataSource.query(
      `INSERT INTO price_deflator (country, year, "index", source) VALUES ('US', $1, $2, $3) ON CONFLICT (country, year) DO NOTHING RETURNING id`,
      [year, index, US_CPI_U_SOURCE],
    );
    added += rows.length;
  }
  return added;
}

async function seedLibrary(): Promise<string> {
  if (!fs.existsSync(USEEIO_DIR)) return "no data/scope3/useeio folder";
  const files = fs.readdirSync(USEEIO_DIR).filter((f) => f.toLowerCase().endsWith(".csv"));
  if (!files.length) return "no EPA file in data/scope3/useeio; the library stays empty";
  const parts: string[] = [];
  for (const file of files) {
    const factors = readUseeio(fs.readFileSync(path.join(USEEIO_DIR, file), "utf8"), file);
    const added = await seedUseeio(AppDataSource.manager, factors, `US EPA Supply Chain GHG Emission Factors (${file})`);
    parts.push(`${file}: ${factors.length} sector(s), ${added} added`);
  }
  return parts.join("; ");
}

/**
 * Category 1/2 forms with "spent_value" and "currency" offer the spend method.
 *
 * ORDERING NOTE for S3-3 (draft #135, `migrate:scope3-row-quality`): this step
 * needs S3-3's `column_config.method_options`, and migrate-all runs scripts in
 * package.json order, where `migrate:scope3-spend` comes before S3-3's
 * migration. So:
 *   - on the first start after S3-3 deploys the column doesn't exist yet when
 *     this runs, and the flip happens only on the next start (the next
 *     migrate-all run);
 *   - if S3-3's own migration fills `method_options` for these forms first,
 *     the `method_options IS NULL` guard makes this a no-op, and those forms
 *     never offer "From the amount spent".
 * S3-3 should therefore apply the same flip (Category 1/2 forms whose
 * extra_fields hold both "spent_value" and "currency" get
 * ["average_data", "spend_based"], or have "spend_based" added) inside its own
 * migration, after it adds the column, or call this function from there.
 * Exported for that reason; idempotent.
 */
export async function flipSpendForms(): Promise<string> {
  const has: unknown[] = await AppDataSource.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'column_config' AND column_name = 'method_options'`,
  );
  if (!has.length) return "column_config.method_options not there yet (S3-3); forms left as they are";
  const rows: unknown[] = await AppDataSource.query(
    `UPDATE column_config cc SET method_options = '["average_data","spend_based"]'::jsonb
       FROM category c
      WHERE c.category_id = cc.category_id AND c.ghg_category IN (1, 2) AND cc.method_options IS NULL
        AND cc.extra_fields @> '[{"key":"spent_value"}]'::jsonb AND cc.extra_fields @> '[{"key":"currency"}]'::jsonb
      RETURNING cc.pk_id`,
  );
  return `${rows.length} Category 1/2 form(s) now offer "From the amount spent"`;
}

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of SPEND_SCHEMA) await AppDataSource.query(sql);
    console.log("S3-5 fx_rate, price_deflator and emission.fx present.");
    console.log(`S3-5 US CPI-U: ${await seedCpi()} year(s) added.`);
    console.log(`S3-5 USEEIO library: ${await seedLibrary()}.`);
    console.log(`S3-5 spend forms: ${await flipSpendForms()}.`);
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
