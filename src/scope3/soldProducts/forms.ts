/**
 * S3-10 · applies the standard Category 10 / 11 / 12 forms (configs.ts) to one
 * site × category, and seeds what they need:
 *
 *   1. global columns, reused by exact name and type;
 *   2. the column config: created when there is none (and the site × category
 *      has no entries yet), rewritten in place only while it is still the
 *      standard one. Category 11's form as seedUseOfSoldProducts.ts wrote it is
 *      upgraded in place (same name, its options and formulas kept, 11.5
 *      added); a client's own form, or one a Superadmin changed, is left alone;
 *   3. unit rows the form offers (never removes one);
 *   4. factors from factors.ts for the years they carry, only where the
 *      site × category has none of that name and year; for Category 11 the
 *      older refrigerant rows get `gwp_set` AR4 (D7).
 *
 * Used by migrate:scope3-sold-product-forms (every assigned site) and by the
 * sold-products plan (its own site). Idempotent; writes nothing when
 * everything is in place; never deletes. Logs ids and counts only.
 */
import type { EntityManager } from "typeorm";
import { ColumnEntity } from "../../entities/Column";
import { ColumnConfig } from "../../entities/ColumnConfig";
import { EmissionFactor } from "../../entities/EmissionFactor";
import { Unit } from "../../entities/Unit";
import type { Site } from "../../entities/Site";
import type { Category } from "../../entities/Category";
import { AR6_FACTOR_YEARS, REFRIGERANT_FACTORS, SEED_AR4_SOURCE, type SoldProductCategory, formFields, isLegacyUseConfig, isStandardConfig, same, soldProductForm, standardHash } from "./configs";
import { EOL_FACTORS, REFRIGERANT_AR6, type SeedFactor } from "./factors";

export interface FormResult {
  /** has_entries: no form yet, but the site × category already has emission rows (left alone). */
  config: "created" | "updated" | "upgraded" | "unchanged" | "customised" | "has_entries";
  units_added: number;
  factors_added: number;
  /** Category 11 refrigerant rows marked AR4. */
  factors_marked: number;
  /** Category 11 seed refrigerant rows raised to AR6 (factor years 2025 and 2026). */
  factors_raised?: number;
}

const stripHash = (c: unknown) => {
  if (!c || typeof c !== "object") return c;
  const { standard_hash: _h, ...rest } = c as Record<string, unknown>;
  return rest;
};

async function columnFor(m: EntityManager, name: string, type: string): Promise<ColumnEntity> {
  const repo = m.getRepository(ColumnEntity);
  const found = await repo.findOne({ where: { column_name: name, column_type: type }, order: { pk_id: "ASC" } });
  return found ?? repo.save(repo.create({ column_name: name, column_type: type }));
}

/** The seed factors with a value, for the years they carry (missing ones only). */
export async function ensureSeedFactors(m: EntityManager, site_id: number, category_id: number, factors: SeedFactor[]): Promise<number> {
  const wanted = factors.filter((f) => Object.keys(f.values).length > 0);
  if (!wanted.length) return 0;
  const repo = m.getRepository(EmissionFactor);
  const have = new Set(
    (await repo.find({ where: { site: { site_id }, category: { category_id } } })).map((f) => `${f.emission_category_name}|${f.year}`),
  );
  let added = 0;
  for (const f of wanted) {
    for (const [year, v] of Object.entries(f.values)) {
      if (have.has(`${f.name}|${year}`)) continue;
      await repo.save(
        repo.create({
          site: { site_id } as Site,
          category: { category_id } as Category,
          year: Number(year),
          factor_value: v.value,
          denominator_unit: f.unit,
          source: `${f.dataset} ${v.dataset_version} (${v.from})`,
          emission_category_name: f.name,
          global_category_name: f.name,
          factor_type: f.factor_type,
          gwp_set: f.gwp_set,
          geography: f.geography,
          dataset: f.dataset,
          dataset_version: v.dataset_version,
        }),
      );
      have.add(`${f.name}|${year}`);
      added++;
    }
  }
  return added;
}

const AR6_SOURCE = "IPCC AR6 GWP100 (AR6 WG1 Table 7.SM.7)";
const AR6_RAISE_REASON = "S3-10 D7: seed refrigerant factor raised from IPCC AR4 to AR6 GWP100 so rows dated 2026 on use AR6";

/**
 * D7: the seed's untouched AR4 rows on an AR6 factor year (the AR4 value and the
 * seed's source) take the AR6 value, so rows dated 2026 resolve to AR6. Saved
 * rows keep their own factor snapshot and total.
 */
export async function raiseSeedRefrigerantsToAr6(m: EntityManager, site_id: number, category_id: number): Promise<number> {
  let raised = 0;
  for (const f of REFRIGERANT_FACTORS) {
    // One statement: lock the matching rows, raise them, and write one audit_log row each with the old
    // value, source, dataset and GWP set, so nothing is lost. WHERE kept on the UPDATE line for the data-safety check.
    const rows: Array<{ entity_id: number }> = await m.query(
      `WITH old AS (SELECT emission_factor_id, factor_value, gwp_set, source, dataset, dataset_version FROM emission_factors WHERE site_id = $1 AND category_id = $2 AND emission_category_name = $3 AND year = ANY($4::int[]) AND factor_value = $6 AND source = $7 FOR UPDATE),
       up AS (UPDATE emission_factors e SET factor_value = $5, gwp_set = 'AR6', source = $8, dataset = 'IPCC', dataset_version = 'AR6 GWP100' FROM old WHERE e.emission_factor_id = old.emission_factor_id RETURNING old.*)
       INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by)
       SELECT 'scope3_emission_factor', up.emission_factor_id, 'update',
              jsonb_build_object(
                'factor_value', jsonb_build_object('old', up.factor_value, 'new', $5::numeric),
                'gwp_set', jsonb_build_object('old', up.gwp_set, 'new', 'AR6'),
                'source', jsonb_build_object('old', up.source, 'new', $8::text),
                'dataset', jsonb_build_object('old', up.dataset, 'new', 'IPCC'),
                'dataset_version', jsonb_build_object('old', up.dataset_version, 'new', 'AR6 GWP100')),
              $9, NULL
       FROM up RETURNING entity_id`,
      [site_id, category_id, f.name, [...AR6_FACTOR_YEARS], f.ar6, f.ar4, SEED_AR4_SOURCE, AR6_SOURCE, AR6_RAISE_REASON],
    );
    raised += rows.length;
  }
  return raised;
}

/** D7: the seed's AR4 refrigerant rows (before the AR6 factor years, the AR4 value) say AR4. */
export async function markAr4Refrigerants(m: EntityManager, site_id: number, category_id: number): Promise<number> {
  let marked = 0;
  for (const f of REFRIGERANT_FACTORS) {
    // WHERE kept on the UPDATE line for the data-safety check.
    const [, n]: [unknown, number] = await m.query(
      `UPDATE emission_factors SET gwp_set = 'AR4' WHERE site_id = $1 AND category_id = $2 AND emission_category_name = $3 AND year < $4 AND factor_value = $5 AND gwp_set IS DISTINCT FROM 'AR4'`,
      [site_id, category_id, f.name, AR6_FACTOR_YEARS[0], f.ar4],
    );
    marked += Number(n) || 0;
  }
  return marked;
}

export async function ensureSoldProductForm(m: EntityManager, site_id: number, category_id: number, n: SoldProductCategory): Promise<FormResult> {
  const form = soldProductForm(n);
  const configRepo = m.getRepository(ColumnConfig);
  const unitRepo = m.getRepository(Unit);

  const columns: ColumnEntity[] = [];
  for (const c of form.columns) columns.push(await columnFor(m, c.name, c.type));
  const selectIds = Object.fromEntries(columns.filter((c) => c.column_type === "select").map((c) => [c.column_name, c.pk_id]));
  const fields = formFields(form, selectIds);

  // One writer per site × category: two plan calls (or a plan and the migration) on a
  // site with no form would otherwise both create one.
  await m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`s3-10-form:${site_id}:${category_id}`]);

  // The config the app uses is the first by name.
  const existing = await configRepo.find({
    where: { site: { site_id }, category: { category_id } },
    order: { config_name: "ASC" },
    relations: ["columns"],
  });
  let config = existing[0];
  let state: FormResult["config"] = "unchanged";
  if (config && !isStandardConfig(config)) {
    if (n === 11 && isLegacyUseConfig(config)) state = "upgraded";
    // A client's own form: no config, unit or factor changes.
    else return { config: "customised", units_added: 0, factors_added: 0, factors_marked: 0 };
  }
  if (!config) {
    // Rows saved without a form compute from `activity_value` (emissionWrite); a form would
    // change how they are edited and re-imported, so such a site keeps working as it is.
    const rows: unknown[] = await m.query(`SELECT 1 FROM emission WHERE site_id = $1 AND category_id = $2 LIMIT 1`, [site_id, category_id]);
    if (rows.length) return { config: "has_entries", units_added: 0, factors_added: 0, factors_marked: 0 };
    config = configRepo.create({ config_name: form.config_name, site: { site_id } as Site, category: { category_id } as Category });
    state = "created";
  }
  const changed =
    !config.pk_id ||
    !same(config.columns?.map((c) => c.pk_id).sort((a, b) => a - b), columns.map((c) => c.pk_id).sort((a, b) => a - b)) ||
    !same(config.column_options, fields.column_options) ||
    !same(config.column_dependencies, fields.column_dependencies) ||
    !same(config.dependent_options, fields.dependent_options) ||
    !same(config.emission_category_mapping, fields.emission_category_mapping) ||
    !same(stripHash(config.calculation), fields.calculation);
  if (changed) {
    config.columns = columns;
    config.column_options = fields.column_options;
    config.column_dependencies = fields.column_dependencies;
    config.dependent_options = fields.dependent_options;
    config.emission_category_mapping = fields.emission_category_mapping;
    // The hash of what is written: any later edit makes the form "customised" (isStandardConfig).
    config.calculation = {
      ...fields.calculation,
      standard_hash: standardHash({ ...fields, columns, extra_fields: config.extra_fields, calculation: fields.calculation }),
    } as ColumnConfig["calculation"];
    await configRepo.save(config);
    if (state === "unchanged") state = "updated";
  }

  const haveUnits = new Set(
    (await unitRepo.find({ where: { site: { site_id }, category: { category_id } } })).map((u) => String(u.unit_name).toLowerCase()),
  );
  let units_added = 0;
  for (const u of form.units) {
    if (haveUnits.has(u.toLowerCase())) continue;
    await unitRepo.save(unitRepo.create({ unit_name: u, description: "Scope 3 sold products", site: { site_id } as Site, category: { category_id } as Category }));
    units_added++;
  }

  const factors_raised = n === 11 ? await raiseSeedRefrigerantsToAr6(m, site_id, category_id) : 0;
  const factors_added = await ensureSeedFactors(m, site_id, category_id, n === 11 ? REFRIGERANT_AR6 : n === 12 ? EOL_FACTORS : []);
  const factors_marked = n === 11 ? await markAr4Refrigerants(m, site_id, category_id) : 0;
  return { config: state, units_added, factors_added, factors_marked, factors_raised };
}
