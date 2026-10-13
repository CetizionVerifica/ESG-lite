// Creates the supplier_request table (PCF phase 3, C06 supplier data
// requests; src/entities/SupplierRequest.ts):
//
//   npm run migrate:supplier-requests
//
// Statements match what TypeORM generates for the entity (constraint and
// index names included), so ci/schema-diff.cjs sees nothing left to do.
// Idempotent (IF NOT EXISTS, constraints added only when missing) and
// additive: no existing table or column is changed.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

const TABLE = `CREATE TABLE IF NOT EXISTS "supplier_request" ("supplier_request_id" SERIAL NOT NULL, "material" character varying NOT NULL, "unit" character varying(20) NOT NULL, "supplier_name" character varying, "supplier_email" character varying NOT NULL, "due_date" date, "subject" character varying NOT NULL, "message" text NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'sent', "token_hash" character varying(64) NOT NULL, "token_expires_at" TIMESTAMP NOT NULL, "sent_at" TIMESTAMP, "opened_at" TIMESTAMP, "received_at" TIMESTAMP, "decided_at" TIMESTAMP, "decision_comment" text, "reply_value_kgco2e" numeric, "reply_unit" character varying(20), "reply_boundary" character varying(20), "reply_standard" character varying, "reply_gwp_set" character varying(5), "reply_reference_start" date, "reply_reference_end" date, "reply_valid_from" date, "reply_valid_to" date, "reply_verifier" character varying, "reply_product_name" character varying, "reply_note" text, "reply_file_name" character varying, "reply_file_type" character varying, "reply_file_size" integer, "reply_file" bytea, "accepted_value_kgco2e" numeric, "accepted_boundary" character varying(20), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "company_id" integer, "pcf_study_id" integer, "pcf_input_id" integer, "requested_by" integer, "decided_by" integer, "material_factor_id" integer, CONSTRAINT "PK_a9e8aeccd5dc5db06e296392b76" PRIMARY KEY ("supplier_request_id"))`;

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS "IDX_c9889fff9fa5ece429fb0d0fba" ON "supplier_request" ("company_id")`,
  `CREATE INDEX IF NOT EXISTS "IDX_c52cc53164d0e8039612f15573" ON "supplier_request" ("pcf_study_id")`,
  `CREATE INDEX IF NOT EXISTS "IDX_dae6d297108222e978a2b80e48" ON "supplier_request" ("status")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_7737cb367285861825ec319507" ON "supplier_request" ("token_hash")`,
];

// [constraint name, statement]
const FOREIGN_KEYS: [string, string][] = [
  [`FK_c9889fff9fa5ece429fb0d0fbaa`, `ALTER TABLE "supplier_request" ADD CONSTRAINT "FK_c9889fff9fa5ece429fb0d0fbaa" FOREIGN KEY ("company_id") REFERENCES "company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_c52cc53164d0e8039612f155733`, `ALTER TABLE "supplier_request" ADD CONSTRAINT "FK_c52cc53164d0e8039612f155733" FOREIGN KEY ("pcf_study_id") REFERENCES "pcf_study"("pcf_study_id") ON DELETE CASCADE ON UPDATE NO ACTION`],
  [`FK_ff1ff8351d1cd1a81ba8767e5fc`, `ALTER TABLE "supplier_request" ADD CONSTRAINT "FK_ff1ff8351d1cd1a81ba8767e5fc" FOREIGN KEY ("pcf_input_id") REFERENCES "pcf_input"("pcf_input_id") ON DELETE SET NULL ON UPDATE NO ACTION`],
  [`FK_0d506dfab0e6ebc905f86611fbe`, `ALTER TABLE "supplier_request" ADD CONSTRAINT "FK_0d506dfab0e6ebc905f86611fbe" FOREIGN KEY ("requested_by") REFERENCES "user"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION`],
  [`FK_5e019b5a12c1f03e1957940ddb8`, `ALTER TABLE "supplier_request" ADD CONSTRAINT "FK_5e019b5a12c1f03e1957940ddb8" FOREIGN KEY ("decided_by") REFERENCES "user"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION`],
  [`FK_d519163c0b1c8c74bd258dc96b4`, `ALTER TABLE "supplier_request" ADD CONSTRAINT "FK_d519163c0b1c8c74bd258dc96b4" FOREIGN KEY ("material_factor_id") REFERENCES "material_factor"("material_factor_id") ON DELETE SET NULL ON UPDATE NO ACTION`],
];

async function main() {
  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    for (const q of [TABLE, ...INDEXES]) await qr.query(q);
    for (const [name, q] of FOREIGN_KEYS) {
      const found = await qr.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [name]);
      if (found.length === 0) await qr.query(q);
    }
    await qr.commitTransaction();
    console.log("supplier_request table present.");
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
