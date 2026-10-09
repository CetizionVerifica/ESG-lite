// Adds emission_document.ai_invoice_id (+ index): B8 in
// docs/redesign/00-entity-map.md, the link from an evidence document to the
// bill python_AI_service extracted (invoice.invoice_id).
//
//   npm run migrate:document-ai-invoice
//
// Must run BEFORE the backend that ships EmissionDocument.ai_invoice_id
// starts: TypeORM selects every mapped column, so without it every document
// read throws.
//
// Idempotent (IF NOT EXISTS) and additive: existing documents get NULL
// ("not from the AI service").
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(
      `ALTER TABLE emission_document ADD COLUMN IF NOT EXISTS ai_invoice_id integer NULL`,
    );
    // The name TypeORM gives the entity's @Index() on this column
    // (DefaultNamingStrategy.indexName("emission_document", ["ai_invoice_id"])),
    // so an entity sync sees the index as already present.
    await AppDataSource.query(
      `CREATE INDEX IF NOT EXISTS "IDX_8bec8c26f1205ff4edfce59a94" ON emission_document (ai_invoice_id)`,
    );
    console.log("emission_document.ai_invoice_id and its index present.");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
