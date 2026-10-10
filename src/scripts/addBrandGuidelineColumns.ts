// Adds the client colour-guideline file to the brand row:
//   brand.guideline_url, brand.guideline_public_id, brand.guideline_name.
//
//   npm run migrate:brand-guideline
//
// Must run BEFORE the backend that ships these Brand columns starts: TypeORM
// selects every mapped column, so without them every brand read (report
// branding included) throws.
//
// Idempotent (IF NOT EXISTS) and additive: existing rows keep their data and
// get NULL guideline fields. If the brand table does not exist yet, it does
// nothing; seed-brands.ts creates the table with these columns already in place.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    const [{ exists }] = await AppDataSource.query(
      `SELECT to_regclass('public.brand') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log("brand table not present; seed-brands.ts creates it with these columns. Nothing to do.");
      return;
    }

    await AppDataSource.query(`
      ALTER TABLE brand
        ADD COLUMN IF NOT EXISTS guideline_url varchar NULL,
        ADD COLUMN IF NOT EXISTS guideline_public_id varchar NULL,
        ADD COLUMN IF NOT EXISTS guideline_name varchar NULL`);
    console.log("brand guideline columns present (guideline_url, guideline_public_id, guideline_name).");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
