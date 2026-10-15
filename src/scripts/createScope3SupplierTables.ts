// S3-6 · The supplier tables and emission.supplier_id, so a purchase can be
// calculated from the supplier's own figure or by the hybrid method
// (docs/scope3/01-contracts.md §4).
//
//   npm run migrate:scope3-suppliers
//
// Statements match what TypeORM generates for the entities (constraint names
// included), so ci/schema-diff.cjs sees nothing left to do — the same shape
// as createSupplierRequestTable.ts. Idempotent (IF NOT EXISTS, constraints
// added only when missing) and additive: no existing column changes, and
// emission.supplier_id is nullable.
//
// The backfill (spec §Build.1) creates suppliers a client already names in
// its own data and links the rows that name them exactly. It never merges two
// spellings: a name that only looks similar is left unlinked for someone to
// judge on the Suppliers page.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS "supplier" ("supplier_id" SERIAL NOT NULL, "name" character varying NOT NULL, "country" character varying(2), "email" character varying, "company_id" integer NOT NULL, "created_by" integer, CONSTRAINT "PK_e0f8ee60663218082b83251cd85" PRIMARY KEY ("supplier_id"))`,
  `CREATE TABLE IF NOT EXISTS "supplier_factor" ("supplier_factor_id" SERIAL NOT NULL, "item" character varying NOT NULL, "unit" character varying(20) NOT NULL, "kgco2e_per_unit" numeric(18,8) NOT NULL, "boundary" character varying(20) NOT NULL DEFAULT 'cradle_to_gate', "reference_year" smallint NOT NULL, "gwp_set" character varying(5), "source" character varying(20) NOT NULL DEFAULT 'manual', "company_id" integer NOT NULL, "supplier_id" integer NOT NULL, "evidence_document_id" integer, "material_factor_id" integer, CONSTRAINT "PK_e2ea47571a98eabdc074355f38a" PRIMARY KEY ("supplier_factor_id"))`,
  `CREATE TABLE IF NOT EXISTS "supplier_facility_data" ("supplier_facility_data_id" SERIAL NOT NULL, "year" smallint NOT NULL, "scope12_tco2e" numeric(18,4) NOT NULL, "output_qty" numeric(18,4) NOT NULL, "output_unit" character varying(20) NOT NULL, "allocation_key" character varying(20) NOT NULL DEFAULT 'mass', "company_id" integer NOT NULL, "supplier_id" integer NOT NULL, CONSTRAINT "PK_8d370bec205361432d597c17962" PRIMARY KEY ("supplier_facility_data_id"))`,
  `ALTER TABLE "emission" ADD COLUMN IF NOT EXISTS "supplier_id" integer`,
];

// One supplier per company per name, compared case-folded, so "Gulf Smelter
// Co." and "gulf smelter co." cannot both be created. A functional unique
// index is the only way to say that in Postgres; §4 asks for exactly this.
const INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_supplier_company_lower_name" ON "supplier" ("company_id", lower("name"))`,
];

// [constraint name, statement] — added only when the name is absent.
const FOREIGN_KEYS: [string, string][] = [
  [`FK_3e3ed41fe5a4f5ea801e2e55dad`, `ALTER TABLE "supplier" ADD CONSTRAINT "FK_3e3ed41fe5a4f5ea801e2e55dad" FOREIGN KEY ("company_id") REFERENCES "company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_52e721d9b8aae65b8de9d493175`, `ALTER TABLE "supplier" ADD CONSTRAINT "FK_52e721d9b8aae65b8de9d493175" FOREIGN KEY ("created_by") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION`],
  [`FK_c4373891eb528ed63d235af2e87`, `ALTER TABLE "supplier_factor" ADD CONSTRAINT "FK_c4373891eb528ed63d235af2e87" FOREIGN KEY ("company_id") REFERENCES "company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_ffb525d10688d53ab3edad923db`, `ALTER TABLE "supplier_factor" ADD CONSTRAINT "FK_ffb525d10688d53ab3edad923db" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("supplier_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_8ec279213dcdf7e6ef5ae9c7928`, `ALTER TABLE "supplier_factor" ADD CONSTRAINT "FK_8ec279213dcdf7e6ef5ae9c7928" FOREIGN KEY ("evidence_document_id") REFERENCES "emission_document"("document_id") ON DELETE SET NULL ON UPDATE NO ACTION`],
  [`FK_34c00bf24ba2208d2500e84099c`, `ALTER TABLE "supplier_factor" ADD CONSTRAINT "FK_34c00bf24ba2208d2500e84099c" FOREIGN KEY ("material_factor_id") REFERENCES "material_factor"("material_factor_id") ON DELETE SET NULL ON UPDATE NO ACTION`],
  [`FK_c359d070d01fb4a28e74acdd7e0`, `ALTER TABLE "supplier_facility_data" ADD CONSTRAINT "FK_c359d070d01fb4a28e74acdd7e0" FOREIGN KEY ("company_id") REFERENCES "company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_9679aef35144bb679035d86f1c5`, `ALTER TABLE "supplier_facility_data" ADD CONSTRAINT "FK_9679aef35144bb679035d86f1c5" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("supplier_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_959ec6c19af8e7c6847ad7eb4b5`, `ALTER TABLE "emission" ADD CONSTRAINT "FK_959ec6c19af8e7c6847ad7eb4b5" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("supplier_id") ON DELETE SET NULL ON UPDATE NO ACTION`],
];

/** The rows a RETURNING clause gave back; an UPDATE answers [rows, count]. */
const returnedRows = (result: unknown): unknown[] => {
  if (!Array.isArray(result)) return [];
  return Array.isArray(result[0]) ? (result[0] as unknown[]) : result;
};

async function main() {
  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    for (const q of [...TABLES, ...INDEXES]) await qr.query(q);
    for (const [name, q] of FOREIGN_KEYS) {
      const found = await qr.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [name]);
      if (found.length === 0) await qr.query(q);
    }
    await qr.commitTransaction();
    console.log("supplier, supplier_factor, supplier_facility_data and emission.supplier_id present.");
  } catch (err) {
    await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();
  }

  try {
    await backfillSuppliers();
  } finally {
    await AppDataSource.destroy();
  }
}

/**
 * Suppliers a client already names, from the two places it names them: the
 * C06 requests it has sent, and the `supplier_name` extra field on its own
 * emission rows. A name is taken as written for the row it creates and
 * compared case-folded against what is already there, so a re-run adds
 * nothing.
 */
async function backfillSuppliers() {
  const fromRequests = await AppDataSource.query(
    `INSERT INTO "supplier" ("company_id", "name", "email")
     SELECT DISTINCT ON (sr.company_id, lower(btrim(sr.supplier_name)))
            sr.company_id, btrim(sr.supplier_name), sr.supplier_email
       FROM supplier_request sr
      WHERE sr.company_id IS NOT NULL
        AND coalesce(btrim(sr.supplier_name), '') <> ''
      ORDER BY sr.company_id, lower(btrim(sr.supplier_name)), sr.supplier_request_id
     ON CONFLICT DO NOTHING
     RETURNING "supplier_id"`,
  );

  const fromRows = await AppDataSource.query(
    `INSERT INTO "supplier" ("company_id", "name")
     SELECT DISTINCT ON (s.company_id, lower(btrim(e.extra_data->>'supplier_name')))
            s.company_id, btrim(e.extra_data->>'supplier_name')
       FROM emission e
       JOIN site s ON s.site_id = e.site_id
      WHERE s.company_id IS NOT NULL
        AND coalesce(btrim(e.extra_data->>'supplier_name'), '') <> ''
      ORDER BY s.company_id, lower(btrim(e.extra_data->>'supplier_name')), e.pk_id
     ON CONFLICT DO NOTHING
     RETURNING "supplier_id"`,
  );

  // Only an exact case-folded match is linked. Anything that merely looks
  // similar stays null and shows up on the Suppliers page for someone to
  // judge, which is why this never merges two spellings (spec §Build.1).
  const linked = await AppDataSource.query(
    `UPDATE emission e
        SET supplier_id = match.supplier_id
       FROM (
             SELECT e2.pk_id, sup.supplier_id
               FROM emission e2
               JOIN site si ON si.site_id = e2.site_id
               JOIN "supplier" sup
                 ON sup.company_id = si.company_id
                AND lower(sup.name) = lower(btrim(e2.extra_data->>'supplier_name'))
              WHERE e2.supplier_id IS NULL
                AND coalesce(btrim(e2.extra_data->>'supplier_name'), '') <> ''
            ) match
      WHERE match.pk_id = e.pk_id`,
  );

  const created = returnedRows(fromRequests).length + returnedRows(fromRows).length;
  const linkedCount = Array.isArray(linked) ? (linked[1] ?? 0) : 0;
  console.log(`Created ${created} supplier(s); linked ${linkedCount} emission row(s) by an exact name.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
