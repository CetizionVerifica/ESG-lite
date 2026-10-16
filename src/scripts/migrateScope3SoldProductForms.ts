// S3-10 · migrate:scope3-sold-product-forms. Applies the standard Category 10
// (processing), 11 (use) and 12 (end of life) forms (src/scope3/soldProducts/configs.ts)
// to every site that has one of those categories assigned (category.ghg_category),
// with their units and the factors in src/scope3/soldProducts/factors.ts that
// carry values. Category 11's form as seedUseOfSoldProducts.ts wrote it is
// upgraded in place (option "Part of a customer's product", 11.5) and gets the
// D7 AR6 refrigerant rows for 2026; its older refrigerant rows are marked AR4.
// A client's own form, or one a Superadmin changed, is left alone and its id
// logged; so is a site × category with entries but no form.
//
//   npm run migrate:scope3-sold-product-forms
//   npx ts-node src/scripts/migrateScope3SoldProductForms.ts 23 24   # specific site ids
//
// Runs on every start through scripts/migrate-all.cjs: idempotent, writes
// nothing when everything is in place, never deletes. Logs ids and counts only.
// TODO(S3-3): write `method_options` (configs.ts METHOD_OPTIONS, UNITS_BY_METHOD) once the column exists.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import type { SoldProductCategory } from "../scope3/soldProducts/configs";
import { ensureSoldProductForm } from "../scope3/soldProducts/forms";

async function main() {
  const siteArgs = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  await AppDataSource.initialize();
  try {
    const assigned: Array<{ site_id: number; category_id: number; n: number }> = await AppDataSource.query(
      `SELECT sc.site_id, sc.category_id, c.ghg_category AS n
         FROM site_categories sc JOIN category c ON c.category_id = sc.category_id
        WHERE c.ghg_category IN (10, 11, 12)
        ORDER BY sc.site_id, sc.category_id`,
    );
    const targets = assigned.filter((a) => siteArgs.length === 0 || siteArgs.includes(Number(a.site_id)));
    console.log(`S3-10 sold-product forms: ${targets.length} site × category assignment(s)`);
    const counts = { created: 0, updated: 0, upgraded: 0, unchanged: 0, units: 0, factors: 0, marked: 0 };
    const customised: string[] = [];
    const withEntries: string[] = [];
    for (const t of targets) {
      const r = await AppDataSource.transaction((m) => ensureSoldProductForm(m, Number(t.site_id), Number(t.category_id), Number(t.n) as SoldProductCategory));
      if (r.config === "customised") customised.push(`${t.site_id}/${t.category_id}`);
      else if (r.config === "has_entries") withEntries.push(`${t.site_id}/${t.category_id}`);
      else counts[r.config]++;
      counts.units += r.units_added;
      counts.factors += r.factors_added;
      counts.marked += r.factors_marked;
    }
    console.log(
      `  configs created: ${counts.created} · updated: ${counts.updated} · upgraded: ${counts.upgraded} · unchanged: ${counts.unchanged} · units added: ${counts.units} · factors added: ${counts.factors} · marked AR4: ${counts.marked}`,
    );
    if (customised.length) console.log(`  customised forms left as they are (site/category): ${customised.join(", ")}`);
    if (withEntries.length) console.log(`  no form but existing entries, left as they are (site/category): ${withEntries.join(", ")}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
