/**
 * S3-11 · applies the standard Category 8 / 13 / 14 / 15 forms (configs.ts)
 * to one site × category, and seeds what they need:
 *
 *   1. global columns, reused by exact name and type;
 *   2. the column config: created when there is none, rewritten in place only
 *      while it is still the standard one (a client's own form is left alone);
 *   3. unit rows the form offers (never removes one);
 *   4. the identity factors "Reported emissions [kgCO2e]" / "[tCO2e]" (D13) for
 *      the given years, only where the site × category has none of that name and year.
 *
 * Used by migrate:scope3-asset-forms (every assigned site) and by the
 * investments plan (its own site and year). Idempotent; writes nothing when
 * everything is in place; never deletes. Logs ids and counts only.
 */
import type { EntityManager } from "typeorm";
import { ColumnEntity } from "../../entities/Column";
import { ColumnConfig } from "../../entities/ColumnConfig";
import { EmissionFactor } from "../../entities/EmissionFactor";
import { Unit } from "../../entities/Unit";
import type { Site } from "../../entities/Site";
import type { Category } from "../../entities/Category";
import { AssetCategory, IDENTITY_FACTORS, IDENTITY_META, assetForm, formFields, isStandardConfig } from "./configs";

export interface FormResult {
  config: "created" | "updated" | "unchanged" | "customised";
  units_added: number;
  factors_added: number;
}

/** JSON with object keys sorted: jsonb reads back with its own key order. */
const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

async function columnFor(m: EntityManager, name: string, type: string): Promise<ColumnEntity> {
  const repo = m.getRepository(ColumnEntity);
  const found = await repo.findOne({ where: { column_name: name, column_type: type }, order: { pk_id: "ASC" } });
  return found ?? repo.save(repo.create({ column_name: name, column_type: type }));
}

/** The identity factors for `years` on one site × category (missing ones only). */
export async function ensureIdentityFactors(m: EntityManager, site_id: number, category_id: number, years: number[]): Promise<number> {
  const repo = m.getRepository(EmissionFactor);
  const have = new Set(
    (await repo.find({ where: { site: { site_id }, category: { category_id } } })).map((f) => `${f.emission_category_name}|${f.year}`),
  );
  let added = 0;
  for (const f of IDENTITY_FACTORS) {
    for (const year of years) {
      if (have.has(`${f.name}|${year}`)) continue;
      await repo.save(
        repo.create({
          site: { site_id } as Site,
          category: { category_id } as Category,
          year,
          factor_value: f.value,
          denominator_unit: f.unit,
          source: "Reported partner emissions (identity factor, S3-11)",
          emission_category_name: f.name,
          global_category_name: f.name,
          ...IDENTITY_META,
        }),
      );
      have.add(`${f.name}|${year}`);
      added++;
    }
  }
  return added;
}

export async function ensureAssetForm(m: EntityManager, site_id: number, category_id: number, n: AssetCategory, years: number[]): Promise<FormResult> {
  const form = assetForm(n);
  const configRepo = m.getRepository(ColumnConfig);
  const unitRepo = m.getRepository(Unit);

  const columns: ColumnEntity[] = [];
  for (const c of form.columns) columns.push(await columnFor(m, c.name, c.type));
  const select = columns[form.columns.findIndex((c) => c.name === form.select)];
  const fields = formFields(form, select.pk_id);

  // The config the app uses is the first by name.
  const existing = await configRepo.find({
    where: { site: { site_id }, category: { category_id } },
    order: { config_name: "ASC" },
    relations: ["columns"],
  });
  let config = existing[0];
  let state: FormResult["config"] = "unchanged";
  if (config && !isStandardConfig(config)) {
    // A client's own form: no config, unit or factor changes.
    return { config: "customised", units_added: 0, factors_added: 0 };
  }
  if (!config) {
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
    !same(config.calculation, fields.calculation);
  if (changed) {
    config.columns = columns;
    config.column_options = fields.column_options;
    config.column_dependencies = fields.column_dependencies;
    config.dependent_options = fields.dependent_options;
    config.emission_category_mapping = fields.emission_category_mapping;
    config.calculation = fields.calculation;
    await configRepo.save(config);
    if (state === "unchanged") state = "updated";
  }

  const haveUnits = new Set(
    (await unitRepo.find({ where: { site: { site_id }, category: { category_id } } })).map((u) => String(u.unit_name).toLowerCase()),
  );
  let units_added = 0;
  for (const u of form.units) {
    if (haveUnits.has(u.toLowerCase())) continue;
    await unitRepo.save(unitRepo.create({ unit_name: u, description: "Scope 3 assets", site: { site_id } as Site, category: { category_id } as Category }));
    units_added++;
  }

  const factors_added = await ensureIdentityFactors(m, site_id, category_id, years);
  return { config: state, units_added, factors_added };
}
