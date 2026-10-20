// DS-4 · template and element library (docs/design-studio/modules/DS-4-template-and-element-library,
// 01-contracts §3):
//
//   report_template   whole-report templates (system: company_id null, one row per look)
//   report_layout     page layouts (FreeformPages with placeholders), by template family
//   report_element    the Elements drawer (shapes, lines, frames, grids, icons, SDG, ESG graphics, data)
//   report_asset      uploaded images (+ folder)
//
//   npm run migrate:ds-4-library
//
// Idempotent: IF NOT EXISTS only, then the seed loader (src/studio/library/seed.ts) upserts the
// system templates, layouts and elements from data/studio/ by (slug, version). A re-run changes
// nothing. Statements match what TypeORM generates for the Studio* entities, so
// ci/schema-diff.cjs sees nothing left to do. Pass --no-seed to create the tables only.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { loadLibrarySeeds } from "../studio/library/seed";

export const DS4_LIBRARY_STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,
  `CREATE TABLE IF NOT EXISTS "report_template" ("id" SERIAL NOT NULL, "company_id" integer, "slug" character varying(120) NOT NULL, "family" character varying(120) NOT NULL, "look" character varying(20), "kind" character varying(20) NOT NULL, "purpose" character varying(20) NOT NULL, "format" character varying(20) NOT NULL, "name" character varying(200) NOT NULL, "description" text NOT NULL DEFAULT '', "tags" text array NOT NULL DEFAULT '{}', "theme" jsonb NOT NULL DEFAULT '{}', "doc" jsonb NOT NULL, "page_count" integer NOT NULL DEFAULT '0', "thumbnail_key" character varying(300), "version" integer NOT NULL DEFAULT '1', "is_active" boolean NOT NULL DEFAULT true, "created_by" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d2952f5126d6e487e73ec6ae6a3" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_template_company" ON "report_template" ("company_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_report_template_slug_version" ON "report_template" ("slug", "version")`,
  `CREATE TABLE IF NOT EXISTS "report_layout" ("id" SERIAL NOT NULL, "company_id" integer, "slug" character varying(180) NOT NULL, "family" character varying(120) NOT NULL, "role" character varying(60) NOT NULL, "page_kind" character varying(30) NOT NULL, "kind" character varying(20) NOT NULL, "format" character varying(20) NOT NULL, "name" character varying(200) NOT NULL, "page" jsonb NOT NULL, "thumbnail_key" character varying(300), "sort" integer NOT NULL DEFAULT '0', "version" integer NOT NULL DEFAULT '1', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ad4c872c98c1bf298d637a4a017" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_layout_family" ON "report_layout" ("family")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_report_layout_slug_version" ON "report_layout" ("slug", "version")`,
  `CREATE TABLE IF NOT EXISTS "report_element" ("id" SERIAL NOT NULL, "company_id" integer, "slug" character varying(120) NOT NULL, "group" character varying(20) NOT NULL, "name" character varying(120) NOT NULL, "tags" text array NOT NULL DEFAULT '{}', "payload" jsonb NOT NULL, "license" character varying(40) NOT NULL, "sort" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0d4e8dcef1e6b5f657b71652771" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_element_group" ON "report_element" ("group")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_report_element_slug" ON "report_element" ("slug")`,
  `CREATE TABLE IF NOT EXISTS "report_asset" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_id" integer NOT NULL, "kind" character varying(20) NOT NULL DEFAULT 'image', "r2_key" character varying(300) NOT NULL, "mime" character varying(40) NOT NULL, "bytes" integer NOT NULL, "w" integer NOT NULL, "h" integer NOT NULL, "alt" character varying(500) NOT NULL DEFAULT '', "sha256" character varying(64) NOT NULL, "folder" character varying(60), "created_by" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b586fd5be8a1c9b5977d3c1d73f" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_asset_company_sha" ON "report_asset" ("company_id", "sha256")`,
  `CREATE INDEX IF NOT EXISTS "IDX_report_asset_company" ON "report_asset" ("company_id")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of DS4_LIBRARY_STATEMENTS) await AppDataSource.query(sql);
    console.log("DS-4 report_template, report_layout, report_element and report_asset present.");
    if (!process.argv.includes("--no-seed")) {
      const r = await loadLibrarySeeds(AppDataSource.manager);
      console.log(`DS-4 seeds: templates ${r.templates.inserted} new, ${r.templates.updated} updated, ${r.templates.unchanged} unchanged; layouts ${r.layouts.inserted} new, ${r.layouts.updated} updated, ${r.layouts.unchanged} unchanged; elements ${r.elements.inserted} new, ${r.elements.updated} updated, ${r.elements.unchanged} unchanged.`);
    }
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
