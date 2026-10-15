// S3-8 · migrate:scope3-transport. Applies the standard Cat 4 / Cat 9 transport
// and warehousing form (src/scope3/transport/configs.ts) to every site that has
// either category assigned, and adds what the form needs:
//
//   1. Global columns, reused by exact name and type.
//   2. The column config per site × category: created when there is none,
//      updated in place only while it is still the standard one (name
//      "Transport - Standard …" or the S3-8 marker in `calculation`). A config
//      a client customised is left alone and its id logged.
//   3. Unit rows the form offers (never removes one).
//   4. Fuel and refrigerant factors from transport/factors.ts, per year, only where
//      the site × category has no factor of that name and year.
//
//   npm run migrate:scope3-transport            # every assigned site
//   npx ts-node src/scripts/seedScope3Transport.ts 23 24   # specific site ids
//
// Runs on every start through scripts/migrate-all.cjs: idempotent, writes
// nothing when everything is in place, never deletes. Logs ids and counts only.
//
// Cat 4 / Cat 9 are found by `category.ghg_category IN (4, 9)` (S3-1). Until
// that column exists, the existing transport categories (13 upstream, 18
// downstream) are used.
// TODO(S3-3): write `method_options` (METHOD_OPTIONS, UNITS_BY_METHOD) once the column exists.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { ColumnEntity } from "../entities/Column";
import { ColumnConfig } from "../entities/ColumnConfig";
import { EmissionFactor } from "../entities/EmissionFactor";
import { Unit } from "../entities/Unit";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import {
  COL_CLASS,
  COL_MODE,
  COL_VEHICLE,
  COLUMNS,
  CONFIG_NAME_PREFIX,
  UNITS,
  isStandardConfig,
  transportForm,
  withPaidBy,
} from "../scope3/transport/configs";
import { TRANSPORT_FACTORS } from "../scope3/transport/factors";

const LEGACY_CATEGORY_IDS: Record<number, 4 | 9> = { 13: 4, 18: 9 };

/** Transport categories by GHG Protocol number: S3-1's column when it exists, else the legacy ids. */
async function transportCategories(): Promise<Map<number, 4 | 9>> {
  const hasColumn: Array<{ n: number }> = await AppDataSource.query(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'category' AND column_name = 'ghg_category'`,
  );
  if (hasColumn[0]?.n > 0) {
    const rows: Array<{ category_id: number; ghg_category: number }> = await AppDataSource.query(
      `SELECT category_id, ghg_category FROM category WHERE ghg_category IN (4, 9)`,
    );
    return new Map(rows.map((r) => [r.category_id, r.ghg_category as 4 | 9]));
  }
  console.log("  category.ghg_category not there yet (S3-1): using the transport categories 13 and 18");
  return new Map(Object.entries(LEGACY_CATEGORY_IDS).map(([id, n]) => [Number(id), n]));
}

/** JSON with object keys sorted: jsonb reads back with its own key order. */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

async function main() {
  const siteArgs = process.argv.slice(2).map(Number).filter((n) => !isNaN(n));
  await AppDataSource.initialize();
  const columnRepo = AppDataSource.getRepository(ColumnEntity);
  const configRepo = AppDataSource.getRepository(ColumnConfig);
  const factorRepo = AppDataSource.getRepository(EmissionFactor);
  const unitRepo = AppDataSource.getRepository(Unit);

  const categories = await transportCategories();
  const assigned: Array<{ site_id: number; category_id: number }> = categories.size
    ? await AppDataSource.query(
        `SELECT site_id, category_id FROM site_categories WHERE category_id = ANY($1) ORDER BY site_id, category_id`,
        [[...categories.keys()]],
      )
    : [];
  const targets = assigned.filter((a) => siteArgs.length === 0 || siteArgs.includes(a.site_id));
  console.log(`S3-8 transport forms: ${targets.length} site × category assignment(s)`);
  if (targets.length === 0) {
    await AppDataSource.destroy();
    return;
  }

  // 1. Global columns.
  const columnByName = new Map<string, ColumnEntity>();
  for (const c of COLUMNS) {
    let entity = await columnRepo.findOne({ where: { column_name: c.name, column_type: c.type }, order: { pk_id: "ASC" } });
    if (!entity) {
      entity = await columnRepo.save(columnRepo.create({ column_name: c.name, column_type: c.type }));
      console.log(`  column created: pk ${entity.pk_id}`);
    }
    columnByName.set(c.name, entity);
  }
  const form = transportForm({
    mode: columnByName.get(COL_MODE)!.pk_id,
    vehicle: columnByName.get(COL_VEHICLE)!.pk_id,
    cls: columnByName.get(COL_CLASS)!.pk_id,
  });
  const columns = COLUMNS.map((c) => columnByName.get(c.name)!);
  const factors = TRANSPORT_FACTORS;

  let configsWritten = 0;
  let unitsAdded = 0;
  let factorsAdded = 0;
  const customised: number[] = [];
  const mappedNames = new Set(Object.values(form.emission_category_mapping));
  const latestYear = String(Math.max(...factors.flatMap((f) => Object.keys(f.values).map(Number))));

  for (const { site_id, category_id } of targets) {
    const ghg = categories.get(category_id)!;

    // 2. The config the app uses is the first by name.
    const existing = await configRepo.find({
      where: { site: { site_id }, category: { category_id } },
      order: { config_name: "ASC" },
      relations: ["site", "category", "columns"],
    });
    let config = existing[0];
    if (config && !isStandardConfig(config)) {
      // A client's own form: no config, unit or factor changes (its spec wouldn't know the new units).
      customised.push(config.pk_id);
      continue;
    } else {
      if (!config) {
        config = configRepo.create({
          config_name: `${CONFIG_NAME_PREFIX} - ${ghg === 4 ? "Upstream" : "Downstream"}`,
          site: { site_id } as Site,
          category: { category_id } as Category,
        });
      }
      const extra = withPaidBy(config.extra_fields);
      const changed =
        !config.pk_id ||
        !same(config.columns?.map((c) => c.pk_id).sort(), columns.map((c) => c.pk_id).sort()) ||
        !same(config.column_options, form.column_options) ||
        !same(config.column_dependencies, form.column_dependencies) ||
        !same(config.dependent_options, form.dependent_options) ||
        !same(config.emission_category_mapping, form.emission_category_mapping) ||
        !same(config.calculation, form.calculation) ||
        !same(config.extra_fields, extra);
      if (changed) {
        config.columns = columns;
        config.column_options = form.column_options;
        config.column_dependencies = form.column_dependencies;
        config.dependent_options = form.dependent_options;
        config.emission_category_mapping = form.emission_category_mapping;
        config.calculation = form.calculation;
        config.extra_fields = extra;
        await configRepo.save(config);
        configsWritten++;
        console.log(`  site ${site_id} · category ${category_id}: config pk ${config.pk_id} written`);
      }
    }

    // 3. Units (added, never removed).
    const haveUnits = new Set(
      (await unitRepo.find({ where: { site: { site_id }, category: { category_id } } })).map((u) => String(u.unit_name).toLowerCase()),
    );
    for (const u of UNITS) {
      if (haveUnits.has(u.toLowerCase())) continue;
      await unitRepo.save(unitRepo.create({ unit_name: u, description: "Transport", site: { site_id } as Site, category: { category_id } as Category }));
      unitsAdded++;
    }

    // 4. Factors: only names and years the site × category doesn't have.
    const haveFactors = new Set(
      (await factorRepo.find({ where: { site: { site_id }, category: { category_id } } })).map((f) => `${f.emission_category_name}|${f.year}`),
    );
    for (const f of factors) {
      for (const [year, v] of Object.entries(f.values)) {
        if (haveFactors.has(`${f.name}|${year}`)) continue;
        await factorRepo.save(
          factorRepo.create({
            site: { site_id } as Site,
            category: { category_id } as Category,
            year: Number(year),
            factor_value: v.value,
            denominator_unit: f.unit,
            source: `${f.dataset} ${v.dataset_version} (S3-8)`,
            emission_category_name: f.name,
            global_category_name: f.name,
            // S3-2 factor metadata
            factor_type: f.factor_type,
            gwp_set: f.gwp_set,
            geography: f.geography,
            dataset: f.dataset,
            dataset_version: v.dataset_version,
          }),
        );
        factorsAdded++;
        haveFactors.add(`${f.name}|${year}`);
      }
    }

    // Mapped names this site × category has no factor for (freight factors are the
    // client's; repairTransportConfigs.ts copies the DEFRA freight set from the template site).
    {
      const missing = [...mappedNames].filter((n) => !haveFactors.has(`${n}|${latestYear}`)).length;
      if (missing) console.log(`  site ${site_id} · category ${category_id}: ${missing} of ${mappedNames.size} mapped factors have no ${latestYear} factor yet`);
    }
  }

  console.log(`  configs written: ${configsWritten} · units added: ${unitsAdded} · factors added: ${factorsAdded}`);
  if (customised.length) console.log(`  customised configs left as they are: ${customised.join(", ")}`);
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
