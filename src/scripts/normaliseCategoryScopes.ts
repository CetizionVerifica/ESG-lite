// S3-4: category.scope holds only 'Scope 1' | 'Scope 2' | 'Scope 3' | null.
// Rewrites the spellings older data used ("scope3", "S3", "Scope-3") to the
// canonical value and lists anything else, untouched, for Shyam to decide.
//
//   npm run migrate:scope3-scope-normalise
//
// npm start runs it (scripts/migrate-all.cjs) before the API starts.
// Idempotent: a second run finds nothing to change.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { normaliseScope } from "../utils/categoryScope";

async function main() {
  await AppDataSource.initialize();
  try {
    const rows: Array<{ category_id: number; category_name: string; scope: string }> = await AppDataSource.query(
      `SELECT category_id, category_name, scope FROM category WHERE scope IS NOT NULL ORDER BY category_id`,
    );
    let fixed = 0;
    const unknown: string[] = [];
    for (const row of rows) {
      const scope = normaliseScope(row.scope);
      if (scope === undefined) {
        unknown.push(`${row.category_id} "${row.category_name}": "${row.scope}"`);
        continue;
      }
      if (scope !== row.scope) {
        await AppDataSource.query(`UPDATE category SET scope = $1 WHERE category_id = $2`, [scope, row.category_id]);
        fixed++;
      }
    }
    console.log(`category.scope: ${fixed} normalised.`);
    if (unknown.length) console.warn(`category.scope: ${unknown.length} not Scope 1, 2, 3 or empty, left as is: ${unknown.join("; ")}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
