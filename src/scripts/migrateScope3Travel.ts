// S3-9 · migrate:scope3-travel. Applies the standard Category 6 (business
// travel) and Category 7 (employee commuting) forms (src/scope3/commuting/configs.ts)
// to every site that has one of those categories assigned (category.ghg_category),
// with their units (passenger.km, vehicle.km, night, litre) and the factors in
// src/scope3/commuting/factors.ts that carry values. A client's own form, or
// one a Superadmin customised, is left alone and its id logged.
//
//   npm run migrate:scope3-travel
//   npx ts-node src/scripts/migrateScope3Travel.ts 23 24   # specific site ids
//
// Runs on every start through scripts/migrate-all.cjs: idempotent, writes
// nothing when everything is in place, never deletes. Logs ids and counts only.
// TODO(S3-3): write `method_options` (configs.ts METHOD_OPTIONS, UNITS_BY_METHOD) once the column exists.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { TravelCategory } from "../scope3/commuting/configs";
import { ensureTravelForm } from "../scope3/commuting/forms";

async function main() {
  const siteArgs = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  await AppDataSource.initialize();
  try {
    const assigned: Array<{ site_id: number; category_id: number; n: number }> = await AppDataSource.query(
      `SELECT sc.site_id, sc.category_id, c.ghg_category AS n
         FROM site_categories sc JOIN category c ON c.category_id = sc.category_id
        WHERE c.ghg_category IN (6, 7)
        ORDER BY sc.site_id, sc.category_id`,
    );
    const targets = assigned.filter((a) => siteArgs.length === 0 || siteArgs.includes(Number(a.site_id)));
    console.log(`S3-9 travel forms: ${targets.length} site × category assignment(s)`);
    const counts = { created: 0, updated: 0, unchanged: 0, units: 0, factors: 0 };
    const customised: string[] = [];
    for (const t of targets) {
      const r = await AppDataSource.transaction((m) => ensureTravelForm(m, Number(t.site_id), Number(t.category_id), Number(t.n) as TravelCategory));
      if (r.config === "customised") customised.push(`${t.site_id}/${t.category_id}`);
      else counts[r.config]++;
      counts.units += r.units_added;
      counts.factors += r.factors_added;
    }
    console.log(
      `  configs created: ${counts.created} · updated: ${counts.updated} · unchanged: ${counts.unchanged} · units added: ${counts.units} · factors added: ${counts.factors}`,
    );
    if (customised.length) console.log(`  customised forms left as they are (site/category): ${customised.join(", ")}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
