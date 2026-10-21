// PE-2 · uploaded brand fonts (docs/design-studio/pro/PE-2.md, decision E3):
//
//   brand_font        company_id, family (+ family_key = lower(trim)), licence_confirmed_by/at, created_by
//   brand_font_file   uuid id, font_id, company_id, weight, style, format (woff2|ttf|otf), bytes, sha256,
//                     data bytea (≤ 5 MB), licence_confirmed_by/at
//
//   npm run migrate:ds-pro-pe-2-fonts
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Additive; no
// existing row changes. Statements match what TypeORM generates for BrandFont
// and BrandFontFile, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const DS_PRO_PE2_FONTS_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "brand_font" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "family" character varying(60) NOT NULL, "family_key" character varying(60) NOT NULL, "licence_confirmed_by" integer, "licence_confirmed_at" TIMESTAMP NOT NULL, "created_by" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9be4ea5a3be7219320de6b2386b" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_brand_font_company_family" ON "brand_font" ("company_id", "family_key")`,
  `CREATE INDEX IF NOT EXISTS "IDX_brand_font_company" ON "brand_font" ("company_id")`,
  `CREATE TABLE IF NOT EXISTS "brand_font_file" ("id" uuid NOT NULL, "font_id" integer NOT NULL, "company_id" integer NOT NULL, "weight" integer NOT NULL, "style" character varying(10) NOT NULL, "format" character varying(10) NOT NULL, "bytes" integer NOT NULL, "sha256" character varying(64) NOT NULL, "data" bytea NOT NULL, "licence_confirmed_by" integer, "licence_confirmed_at" TIMESTAMP NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bb9fc8381f37d88530973a5caeb" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_brand_font_file_face" ON "brand_font_file" ("font_id", "weight", "style")`,
  `CREATE INDEX IF NOT EXISTS "IDX_brand_font_file_font" ON "brand_font_file" ("font_id")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of DS_PRO_PE2_FONTS_STATEMENTS) await AppDataSource.query(sql);
    console.log("PE-2 brand_font and brand_font_file present.");
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
