// Installs ONE standard setup for the transport categories — Upstream (13) and
// Downstream (18) transportation and distribution — on every site that has
// them assigned, fixing the configuration problems found in the Sep-2026 audit:
//
//   • Same column names everywhere: Travel Mode / Vehicle Type / Fuel Type/Class
//     (selects), Shipment Ref (text), Weight (tonne) + Distance travelled (numbers).
//     Weight and Distance are REAL stored fields now, multiplied by the engine
//     via a per-unit calculation spec (tonne.km → Weight × Distance; km → Distance).
//   • Both factor groups reachable ([tonne.km] and [km] twins), Rail added
//     (mapped to the existing "Road - Rail" factor), Flight capitalised.
//   • Exactly one numeric distance column (removes the stray second one).
//   • Units: the S3-8 list (configs.ts UNITS); removes g.km / kg.km for these categories.
//   • Sites assigned but without factors get the standard DEFRA set copied
//     from the template site (24, Chieron).
//   • Legacy two-part duplicate factor names (e.g. "Van - Diesel",
//     "Cargo Ship - General Cargo", "Rail - Rail Fuel") are deleted — only
//     when no emission row references them.
//   • Shipment Ref becomes part of the duplicate identity, so two shipments on
//     the same route in one month are no longer "duplicates".
//
//   npx ts-node src/scripts/repairTransportConfigs.ts                 # all assigned sites
//   npx ts-node src/scripts/repairTransportConfigs.ts 20 21           # specific site ids
//   npx ts-node src/scripts/repairTransportConfigs.ts --lpg2024=0.30  # also correct the
//        mistyped "Road - Van - LPG [km]" 2024 factor to the official DEFRA value
//
// Idempotent and safe to re-run. Existing configs are updated in place (same
// pk); rows already saved keep working (legacy product-only rows are handled by
// the spec's legacy_field). Never touches other categories.
import "reflect-metadata";
import { In, Not } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { ColumnEntity } from "../entities/Column";
import { ColumnConfig } from "../entities/ColumnConfig";
import { EmissionFactor } from "../entities/EmissionFactor";
import { Emission } from "../entities/Emission";
import { Unit } from "../entities/Unit";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import {
  COL_CLASS,
  COL_MODE,
  COL_VEHICLE,
  COLUMNS,
  CONFIG_NAME_PREFIX,
  STRAY_UNITS,
  UNITS,
  transportForm,
  withPaidBy,
} from "../scope3/transport/configs";

// The standard form itself (columns, options, mapping, spec, units) lives in
// src/scope3/transport/configs.ts (S3-8); migrate:scope3-transport applies it on
// every start. This by-hand script keeps its extra repairs (template factors,
// legacy names, the LPG 2024 value) and writes the same form.
const CATEGORY_IDS = [13, 18];
const TEMPLATE_SITE_ID = 24; // Chieron — complete DEFRA freight set

async function main() {
  const args = process.argv.slice(2);
  const lpgArg = args.find((a) => a.startsWith("--lpg2024="));
  const lpg2024 = lpgArg ? parseFloat(lpgArg.split("=")[1]) : null;
  const siteArgs = args.filter((a) => !a.startsWith("--")).map(Number).filter((n) => !isNaN(n));

  await AppDataSource.initialize();
  const columnRepo = AppDataSource.getRepository(ColumnEntity);
  const configRepo = AppDataSource.getRepository(ColumnConfig);
  const factorRepo = AppDataSource.getRepository(EmissionFactor);
  const emissionRepo = AppDataSource.getRepository(Emission);
  const unitRepo = AppDataSource.getRepository(Unit);
  const siteRepo = AppDataSource.getRepository(Site);

  // Sites that have either transport category assigned
  const assigned: Array<{ site_id: number; category_id: number }> = await AppDataSource.query(
    `SELECT site_id, category_id FROM site_categories WHERE category_id = ANY($1) ORDER BY site_id, category_id`,
    [CATEGORY_IDS],
  );
  const targets = assigned.filter((a) => siteArgs.length === 0 || siteArgs.includes(a.site_id));
  console.log(`Transport assignments to repair: ${targets.map((t) => `${t.site_id}/${t.category_id}`).join(", ")}`);

  // 1. Global columns (reuse by exact name; the select names already exist)
  const columnByName = new Map<string, ColumnEntity>();
  for (const c of COLUMNS) {
    let entity = await columnRepo.findOne({ where: { column_name: c.name, column_type: c.type }, order: { pk_id: "ASC" } });
    if (!entity) {
      entity = await columnRepo.save(columnRepo.create({ column_name: c.name, column_type: c.type }));
      console.log(`  column created: "${c.name}" (${c.type}) pk ${entity.pk_id}`);
    }
    columnByName.set(c.name, entity);
  }
  const form = transportForm({
    mode: columnByName.get(COL_MODE)!.pk_id,
    vehicle: columnByName.get(COL_VEHICLE)!.pk_id,
    cls: columnByName.get(COL_CLASS)!.pk_id,
  });
  const mapping = form.emission_category_mapping;

  const templateFactors = await factorRepo.find({
    where: { site: { site_id: TEMPLATE_SITE_ID }, category: { category_id: In(CATEGORY_IDS) } },
    relations: ["site", "category"],
  });

  for (const { site_id, category_id } of targets) {
    const site = await siteRepo.findOne({ where: { site_id } });
    if (!site) continue;
    const catName = category_id === 13 ? "Upstream" : "Downstream";
    console.log(`\nSite ${site_id} (${site.name}) · ${catName} (${category_id}):`);

    // 2. Config — update the existing one in place (first by name) or create
    const existing = await configRepo.find({
      where: { site: { site_id }, category: { category_id } },
      order: { config_name: "ASC" },
      relations: ["site", "category", "columns"],
    });
    let config = existing[0];
    if (!config) {
      config = configRepo.create({
        config_name: `${CONFIG_NAME_PREFIX} - ${catName}`,
        site: { site_id } as Site,
        category: { category_id } as Category,
      });
      console.log(`  config: creating`);
    } else {
      console.log(`  config: updating pk ${config.pk_id} ("${config.config_name}")`);
    }
    config.columns = COLUMNS.map((c) => columnByName.get(c.name)!);
    config.column_options = form.column_options;
    config.column_dependencies = form.column_dependencies;
    config.dependent_options = form.dependent_options;
    config.emission_category_mapping = mapping;
    config.extra_fields = withPaidBy(config.extra_fields);
    config.calculation = form.calculation;
    await configRepo.save(config);
    if (existing.length > 1) {
      console.log(`  NOTE: ${existing.length - 1} extra config(s) exist for this site+category (only the first is used by the app): ${existing.slice(1).map((c) => c.pk_id).join(", ")}`);
    }

    // 3. Units: ensure the standard list, drop strays (transport categories only)
    for (const u of UNITS) {
      const has = await unitRepo.findOne({ where: { unit_name: u, site: { site_id }, category: { category_id } }, relations: ["site", "category"] });
      if (!has) {
        await unitRepo.save(unitRepo.create({ unit_name: u, description: "Transport", site: { site_id } as Site, category: { category_id } as Category }));
        console.log(`  unit created: ${u}`);
      }
    }
    const strays = await unitRepo.find({ where: { unit_name: In(STRAY_UNITS), site: { site_id }, category: { category_id } }, relations: ["site", "category"] });
    if (strays.length) {
      await unitRepo.remove(strays);
      console.log(`  stray units removed: ${strays.map((s) => s.unit_name).join(", ")}`);
    }

    // 4. Factors: copy the template set where a site has none for this category
    const count = await factorRepo.count({ where: { site: { site_id }, category: { category_id } } });
    if (count === 0 && site_id !== TEMPLATE_SITE_ID) {
      const src = templateFactors.filter((f) => f.category.category_id === category_id);
      await factorRepo.save(src.map((f) => factorRepo.create({
        site: { site_id } as Site,
        category: { category_id } as Category,
        year: f.year,
        factor_value: f.factor_value,
        denominator_unit: f.denominator_unit,
        source: f.source,
        emission_category_name: f.emission_category_name,
        global_category_name: f.global_category_name,
      })));
      console.log(`  factors copied from template site ${TEMPLATE_SITE_ID}: ${src.length} rows`);
    }

    // 5. Legacy two-part duplicate names (never mapped by any config) — delete
    //    only when no emission row references them.
    const legacy = await factorRepo.find({ where: { site: { site_id }, category: { category_id } }, relations: ["site", "category"] });
    const legacyRows = legacy.filter((f) => !/^(Road|Air|Sea) - /.test(f.emission_category_name ?? ""));
    if (legacyRows.length) {
      const names = Array.from(new Set(legacyRows.map((f) => f.emission_category_name)));
      const referenced: Array<{ n: string }> = await AppDataSource.query(
        `SELECT DISTINCT activity_data->>'emission_category' AS n FROM emission
         WHERE site_id = $1 AND category_id = $2 AND activity_data->>'emission_category' = ANY($3)`,
        [site_id, category_id, names],
      );
      const blocked = new Set(referenced.map((r) => r.n));
      const deletable = legacyRows.filter((f) => !blocked.has(f.emission_category_name ?? ""));
      if (deletable.length) {
        await factorRepo.remove(deletable);
        console.log(`  legacy duplicate factors removed: ${deletable.length} rows (${names.filter((n) => !blocked.has(n)).length} names)`);
      }
      if (blocked.size) console.log(`  legacy names KEPT because rows reference them: ${Array.from(blocked).join(", ")}`);
    }

    // 6. Mapping sanity: every mapped factor name must exist for 2025
    const present = new Set((await factorRepo.find({ where: { site: { site_id }, category: { category_id }, year: 2025 } })).map((f) => f.emission_category_name));
    const missing = Array.from(new Set(Object.values(mapping))).filter((n) => !present.has(n));
    if (missing.length) console.log(`  WARNING: mapped factor names missing for 2025: ${missing.join(" ; ")}`);
    else console.log(`  mapping check: all ${new Set(Object.values(mapping)).size} factor names present for 2025`);
  }

  // 7. The mistyped LPG 2024 factor — only with an explicit official value
  const lpgRows = await factorRepo.find({ where: { category: { category_id: In(CATEGORY_IDS) }, year: 2024, emission_category_name: "Road - Van - LPG [km]" }, relations: ["site", "category"] });
  if (lpg2024 && lpg2024 > 0) {
    for (const r of lpgRows) { r.factor_value = lpg2024; r.source = `${(r.source || "DEFRA").replace(/ \(corrected.*\)$/, "")} (corrected ${new Date().toISOString().slice(0, 10)})`; }
    await factorRepo.save(lpgRows);
    console.log(`\nLPG [km] 2024 corrected to ${lpg2024} on ${lpgRows.length} rows`);
  } else {
    const vals = Array.from(new Set(lpgRows.map((r) => Number(r.factor_value))));
    console.log(`\nWARNING: "Road - Van - LPG [km]" 2024 is ${vals.join("/")} on ${lpgRows.length} rows (neighbouring years ≈ 0.29). ` +
      `Re-run with --lpg2024=<official DEFRA 2024 value> to correct it.`);
  }

  await AppDataSource.destroy();
  console.log("\nDone.");
}

main().catch((err) => { console.error(err); process.exit(1); });
