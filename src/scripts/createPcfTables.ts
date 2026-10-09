// Creates the PCF tables (E1 in docs/pcf/foundation/E1-data-and-engine/CLAUDE.md):
// material_factor, pcf_study, pcf_input, pcf_allocation, pcf_result, and adds
// the declared-unit columns to product.
//
//   npm run migrate:pcf
//
// Must run BEFORE the backend that ships these entities starts: product reads
// select every mapped column, so without the new product columns they throw.
//
// The statements are exactly what TypeORM generates for the entities (same
// constraint and index names), so ci/schema-diff.cjs finds nothing left to do.
// Idempotent (IF NOT EXISTS, constraints added only when missing) and
// additive: no existing table or column is changed.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS "material_factor" ("material_factor_id" SERIAL NOT NULL, "name" character varying NOT NULL, "material_group" character varying(30) NOT NULL, "geography" character varying, "unit" character varying(20) NOT NULL, "value_kgco2e" numeric NOT NULL, "gwp_set" character varying(5) NOT NULL DEFAULT 'AR6', "source" character varying, "source_year" integer, "dataset_ref" character varying, "licence" character varying(20) NOT NULL DEFAULT 'open', "recycled_variant" boolean NOT NULL DEFAULT false, "valid_from" date, "valid_to" date, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "company_id" integer, CONSTRAINT "PK_734b9515dea89d50ab60edcf883" PRIMARY KEY ("material_factor_id"))`,
  `CREATE TABLE IF NOT EXISTS "pcf_input" ("pcf_input_id" SERIAL NOT NULL, "stage" character varying(20) NOT NULL, "name" character varying NOT NULL, "sort_order" integer NOT NULL DEFAULT '0', "supplier_pcf_kgco2e" numeric, "quantity" numeric NOT NULL DEFAULT '0', "unit" character varying(20) NOT NULL, "recycled_share_pct" numeric NOT NULL DEFAULT '0', "origin_country" character varying, "supplier_name" character varying, "transport_mode" character varying(20), "distance_km" numeric, "payload_t" numeric, "data_type" character varying(10) NOT NULL DEFAULT 'secondary', "dqr_technology" smallint NOT NULL DEFAULT '3', "dqr_geography" smallint NOT NULL DEFAULT '3', "dqr_time" smallint NOT NULL DEFAULT '3', "ai_suggested" boolean NOT NULL DEFAULT false, "ai_confidence" numeric, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "pcf_study_id" integer, "material_factor_id" integer, "recycled_material_factor_id" integer, "emission_factor_id" integer, CONSTRAINT "PK_d80a421f6f3f9d20597f8765327" PRIMARY KEY ("pcf_input_id"))`,
  `CREATE TABLE IF NOT EXISTS "pcf_allocation" ("pcf_allocation_id" SERIAL NOT NULL, "category_name" character varying NOT NULL, "scope" integer NOT NULL, "period_total_tco2e" numeric NOT NULL, "key_value_product" numeric NOT NULL, "key_value_site_total" numeric NOT NULL, "share_pct" numeric NOT NULL, "allocated_kg_per_unit" numeric NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "pcf_study_id" integer, "category_id" integer, CONSTRAINT "PK_f46a19d99e2c9b7477cb2d2dc76" PRIMARY KEY ("pcf_allocation_id"))`,
  `CREATE TABLE IF NOT EXISTS "pcf_study" ("pcf_study_id" SERIAL NOT NULL, "reference_start" date NOT NULL, "reference_end" date NOT NULL, "year_type" character varying(2) NOT NULL DEFAULT 'CY', "boundary" character varying(20) NOT NULL DEFAULT 'cradle_to_gate', "standard" character varying(20) NOT NULL DEFAULT 'iso14067', "pcr_tag" character varying, "allocation_key" character varying(20) NOT NULL DEFAULT 'mass', "cut_off_rule_pct" numeric NOT NULL DEFAULT '1', "version" integer NOT NULL DEFAULT '1', "status" character varying(20) NOT NULL DEFAULT 'draft', "stale" boolean NOT NULL DEFAULT false, "notes" text, "reviewed_at" TIMESTAMP, "review_comment" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "company_id" integer, "product_id" integer, "site_id" integer, "parent_version_id" integer, "created_by" integer, "reviewed_by" integer, CONSTRAINT "PK_6e2958e944044ffa699d5cd34ff" PRIMARY KEY ("pcf_study_id"))`,
  `CREATE TABLE IF NOT EXISTS "pcf_result" ("pcf_result_id" SERIAL NOT NULL, "total_kg_per_unit" numeric NOT NULL, "by_stage" jsonb NOT NULL, "by_input" jsonb NOT NULL, "biogenic_kg_per_unit" numeric NOT NULL DEFAULT '0', "aircraft_kg_per_unit" numeric NOT NULL DEFAULT '0', "luc_kg_per_unit" numeric NOT NULL DEFAULT '0', "primary_data_share_pct" numeric NOT NULL, "dqr_overall" numeric NOT NULL, "cut_off" jsonb NOT NULL, "factor_snapshot" jsonb NOT NULL, "emission_ids_used" integer array, "production_ids_used" integer array, "is_draft" boolean NOT NULL DEFAULT true, "engine_version" character varying(20) NOT NULL, "calculated_at" TIMESTAMP NOT NULL, "pcf_study_id" integer, "calculated_by" integer, CONSTRAINT "REL_935a01a8f36eb4d2346cf4b544" UNIQUE ("pcf_study_id"), CONSTRAINT "PK_99175609c0855d0e4dd00b7284a" PRIMARY KEY ("pcf_result_id"))`
];

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS "IDX_3b5585f77eb842017a0ba84e1b" ON "pcf_input" ("pcf_study_id")`,
  `CREATE INDEX IF NOT EXISTS "IDX_41f2eefc8705a3260bbf69f246" ON "pcf_allocation" ("pcf_study_id")`,
  `CREATE INDEX IF NOT EXISTS "IDX_4955ff200a3f509b746bb9c610" ON "pcf_study" ("company_id")`,
  `CREATE INDEX IF NOT EXISTS "IDX_3e990baa4fd20f37906b254165" ON "pcf_study" ("product_id")`,
  `CREATE INDEX IF NOT EXISTS "IDX_2bd9e7712a2785b58346f27bab" ON "pcf_study" ("status")`
];

const COLUMNS = [
  `ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "declared_unit" character varying(20)`,
  `ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "declared_unit_qty" numeric`,
  `ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "mass_per_unit_kg" numeric`,
  `ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "pcr_tag" character varying`
];

// [constraint name, statement]
const FOREIGN_KEYS: [string, string][] = [
  [`FK_5af98f6b059de6c8817ad7ab267`, `ALTER TABLE "material_factor" ADD CONSTRAINT "FK_5af98f6b059de6c8817ad7ab267" FOREIGN KEY ("company_id") REFERENCES "company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_3b5585f77eb842017a0ba84e1b0`, `ALTER TABLE "pcf_input" ADD CONSTRAINT "FK_3b5585f77eb842017a0ba84e1b0" FOREIGN KEY ("pcf_study_id") REFERENCES "pcf_study"("pcf_study_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_27f8efee933f781a1e1d474efc3`, `ALTER TABLE "pcf_input" ADD CONSTRAINT "FK_27f8efee933f781a1e1d474efc3" FOREIGN KEY ("material_factor_id") REFERENCES "material_factor"("material_factor_id") ON DELETE NO ACTION ON UPDATE NO ACTION`],
  [`FK_bd88cbf19d5f6d0bfe9817f481c`, `ALTER TABLE "pcf_input" ADD CONSTRAINT "FK_bd88cbf19d5f6d0bfe9817f481c" FOREIGN KEY ("recycled_material_factor_id") REFERENCES "material_factor"("material_factor_id") ON DELETE NO ACTION ON UPDATE NO ACTION`],
  [`FK_72375cc6c04deac29e1531a57d3`, `ALTER TABLE "pcf_input" ADD CONSTRAINT "FK_72375cc6c04deac29e1531a57d3" FOREIGN KEY ("emission_factor_id") REFERENCES "emission_factors"("emission_factor_id") ON DELETE NO ACTION ON UPDATE NO ACTION`],
  [`FK_41f2eefc8705a3260bbf69f246d`, `ALTER TABLE "pcf_allocation" ADD CONSTRAINT "FK_41f2eefc8705a3260bbf69f246d" FOREIGN KEY ("pcf_study_id") REFERENCES "pcf_study"("pcf_study_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_8a70c0d03bf7b87da123d2be403`, `ALTER TABLE "pcf_allocation" ADD CONSTRAINT "FK_8a70c0d03bf7b87da123d2be403" FOREIGN KEY ("category_id") REFERENCES "category"("category_id") ON DELETE SET NULL ON UPDATE NO ACTION`],
  [`FK_4955ff200a3f509b746bb9c6108`, `ALTER TABLE "pcf_study" ADD CONSTRAINT "FK_4955ff200a3f509b746bb9c6108" FOREIGN KEY ("company_id") REFERENCES "company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_3e990baa4fd20f37906b2541654`, `ALTER TABLE "pcf_study" ADD CONSTRAINT "FK_3e990baa4fd20f37906b2541654" FOREIGN KEY ("product_id") REFERENCES "product"("product_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_ac69859fb4ca13d6ab732bf36eb`, `ALTER TABLE "pcf_study" ADD CONSTRAINT "FK_ac69859fb4ca13d6ab732bf36eb" FOREIGN KEY ("site_id") REFERENCES "site"("site_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_ed819eb7d129b5a27a0ed4a1675`, `ALTER TABLE "pcf_study" ADD CONSTRAINT "FK_ed819eb7d129b5a27a0ed4a1675" FOREIGN KEY ("parent_version_id") REFERENCES "pcf_study"("pcf_study_id") ON DELETE SET NULL ON UPDATE NO ACTION`],
  [`FK_5ff12fcc66d2f749911de0f5581`, `ALTER TABLE "pcf_study" ADD CONSTRAINT "FK_5ff12fcc66d2f749911de0f5581" FOREIGN KEY ("created_by") REFERENCES "user"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION`],
  [`FK_8b626cb5ac95a1fd7cd0c98b356`, `ALTER TABLE "pcf_study" ADD CONSTRAINT "FK_8b626cb5ac95a1fd7cd0c98b356" FOREIGN KEY ("reviewed_by") REFERENCES "user"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION`],
  [`FK_935a01a8f36eb4d2346cf4b544b`, `ALTER TABLE "pcf_result" ADD CONSTRAINT "FK_935a01a8f36eb4d2346cf4b544b" FOREIGN KEY ("pcf_study_id") REFERENCES "pcf_study"("pcf_study_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_f36b7b77ac7c98ff37f14902ecf`, `ALTER TABLE "pcf_result" ADD CONSTRAINT "FK_f36b7b77ac7c98ff37f14902ecf" FOREIGN KEY ("calculated_by") REFERENCES "user"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION`]
];

async function main() {
  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    for (const q of [...TABLES, ...INDEXES, ...COLUMNS]) await qr.query(q);
    for (const [name, q] of FOREIGN_KEYS) {
      const found = await qr.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [name]);
      if (found.length === 0) await qr.query(q);
    }
    await qr.commitTransaction();
    console.log("PCF tables and product declared-unit columns present.");
  } catch (err) {
    await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
