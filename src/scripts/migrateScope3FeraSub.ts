// S3-7 · emission.scope3_sub, the Category 3 sub-activity of a FERA twin
// (docs/scope3/01-contracts.md §1 and §4):
//
//   npm run migrate:scope3-fera-sub
//
// Adds the column, then backfills the twins that have none: a twin whose
// partner (the non-FERA row it is linked to, either direction) is in a
// Scope 2 category is upstream of electricity (3b); any other twin is
// upstream of fuels (3a), the same rule methods/fera.ts applies to new
// twins. A twin whose factor snapshot says td_loss is a T&D-loss twin (3c);
// none exist before S3-7. Idempotent: ADD COLUMN IF NOT EXISTS, and only
// rows whose scope3_sub is still NULL are written, so a re-run changes
// nothing. Additive: no total, status or link is touched.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const ADD_SCOPE3_SUB = `ALTER TABLE "emission" ADD COLUMN IF NOT EXISTS "scope3_sub" character varying(32)`;

// The partner's scope as categoryScope.ts normalises it ("Scope 2", "scope2", "S2").
export const BACKFILL_SCOPE3_SUB = `
  UPDATE emission t
     SET scope3_sub = CASE
           WHEN t.emission_factor_snapshot->>'factor_type' = 'td_loss' THEN '3c_td_losses'
           WHEN EXISTS (
             SELECT 1 FROM emission p
               JOIN category pc ON pc.category_id = p.category_id
              WHERE (p.pk_id = t.fera_linked_id OR p.fera_linked_id = t.pk_id)
                AND p.pk_id <> t.pk_id
                AND LOWER(pc.category_name) <> 'fera'
                AND pc.scope ~* '^\\s*s(cope)?[\\s_-]*2\\s*$'
           ) THEN '3b_upstream_electricity'
           ELSE '3a_upstream_fuels'
         END
    FROM category c
   WHERE c.category_id = t.category_id
     AND LOWER(c.category_name) = 'fera'
     AND t.scope3_sub IS NULL`;

export async function migrateScope3FeraSub(query: (sql: string) => Promise<unknown>): Promise<void> {
  await query(ADD_SCOPE3_SUB);
  await query(BACKFILL_SCOPE3_SUB);
}

async function main() {
  await AppDataSource.initialize();
  try {
    await migrateScope3FeraSub((sql) => AppDataSource.query(sql));
    const [{ n }] = await AppDataSource.query(
      `SELECT COUNT(*)::int AS n FROM emission t JOIN category c ON c.category_id = t.category_id
        WHERE LOWER(c.category_name) = 'fera' AND t.scope3_sub IS NULL`,
    );
    console.log(`emission.scope3_sub present; FERA twins without a sub-activity: ${n}.`);
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
