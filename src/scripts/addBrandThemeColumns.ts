// Adds the redesign's brand theme fields (B1 in docs/redesign/00-entity-map.md):
//   brand.logo_on_dark_url, brand.logo_on_dark_public_id,
//   brand.default_look ('classic' | 'light' | 'night', default 'classic'),
//   brand.scope3_colour.
//
//   npm run migrate:brand-theme
//
// Must run BEFORE the backend that ships these Brand columns starts: TypeORM
// selects every mapped column, so without them every brand read (report
// branding included) throws.
//
// Idempotent (IF NOT EXISTS) and additive: existing rows keep their data and
// get NULL logos/colour and the 'classic' look. If the brand table does not
// exist yet, it does nothing; seed-brands.ts creates the table with these
// columns already in place.
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
        ADD COLUMN IF NOT EXISTS logo_on_dark_url varchar NULL,
        ADD COLUMN IF NOT EXISTS logo_on_dark_public_id varchar NULL,
        ADD COLUMN IF NOT EXISTS default_look varchar(10) NOT NULL DEFAULT 'classic',
        ADD COLUMN IF NOT EXISTS scope3_colour varchar NULL`);
    console.log("brand theme columns present (logo_on_dark_url, logo_on_dark_public_id, default_look, scope3_colour).");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
