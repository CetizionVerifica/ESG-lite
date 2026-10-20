// DS-3 · brand kit (docs/design-studio/modules/DS-3-brand-kit-and-styles, 01-contracts §3):
//
//   brand.font_heading   varchar(40) null   FontId (R12 OFL set); null = the template default
//   brand.font_body      varchar(40) null
//   brand.voice          text not null default ''   brand voice for AI writing (D11, ≤ 3,000 chars)
//   brand_palette        company_id, name, colors jsonb (≤ 10 hex), sort
//
//   npm run migrate:ds-3-brand-kit
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Additive; no
// existing row changes. Statements match what TypeORM generates for Brand and
// BrandPalette, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const DS3_BRAND_KIT_STATEMENTS = [
  `ALTER TABLE "brand" ADD COLUMN IF NOT EXISTS "font_heading" character varying(40)`,
  `ALTER TABLE "brand" ADD COLUMN IF NOT EXISTS "font_body" character varying(40)`,
  `ALTER TABLE "brand" ADD COLUMN IF NOT EXISTS "voice" text NOT NULL DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS "brand_palette" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "name" character varying(60) NOT NULL, "colors" jsonb NOT NULL, "sort" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3fd757c792f64ed75e3cabd9d3e" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_brand_palette_company" ON "brand_palette" ("company_id")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of DS3_BRAND_KIT_STATEMENTS) await AppDataSource.query(sql);
    console.log("DS-3 brand font and voice columns and brand_palette present.");
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
