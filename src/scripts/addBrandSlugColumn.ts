// Adds brand.slug, the client's name in its sign-in link (/{slug}/login, P01
// in docs/redesign), with a unique index, and gives every brand without one a
// slug made from its name ("Midal Cables" -> "midal-cables"; "-<company id>"
// is added when two names collide).
//
//   npm run migrate:brand-slug
//
// Must run BEFORE the backend that ships the Brand.slug column starts:
// TypeORM selects every mapped column, so without it every brand read throws.
//
// Idempotent and additive: IF NOT EXISTS for the column and index, and the
// backfill only fills slugs that are still NULL. If the brand table does not
// exist yet, it does nothing; seed-brands.ts creates it with the column.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { slugify } from "../utils/brandSlug";

async function main() {
  await AppDataSource.initialize();
  try {
    const [{ exists }] = await AppDataSource.query(
      `SELECT to_regclass('public.brand') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log("brand table not present; seed-brands.ts creates it with the slug column. Nothing to do.");
      return;
    }

    await AppDataSource.query(`ALTER TABLE brand ADD COLUMN IF NOT EXISTS slug varchar(63) NULL`);
    await AppDataSource.query(`CREATE UNIQUE INDEX IF NOT EXISTS brand_slug_key ON brand (slug)`);

    const taken = new Set<string>(
      (await AppDataSource.query(`SELECT slug FROM brand WHERE slug IS NOT NULL`)).map((r: { slug: string }) => r.slug),
    );
    const missing: { company_id: number; name: string }[] = await AppDataSource.query(
      `SELECT company_id, name FROM brand WHERE slug IS NULL ORDER BY company_id`,
    );
    let filled = 0;
    for (const row of missing) {
      const base = slugify(row.name) || "client";
      const slug = taken.has(base) ? `${base.slice(0, 50)}-${row.company_id}` : base;
      if (taken.has(slug)) continue;
      await AppDataSource.query(`UPDATE brand SET slug = $1 WHERE company_id = $2 AND slug IS NULL`, [slug, row.company_id]);
      taken.add(slug);
      filled++;
    }
    console.log(`brand.slug present; filled ${filled} of ${missing.length} brands without a slug.`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
