/**
 * S3-9 · applies the standard Category 6 / 7 forms (configs.ts) to one
 * site × category, and seeds what they need:
 *
 *   1. global columns, reused by exact name and type;
 *   2. the column config: created when there is none, rewritten in place only
 *      while it is still the standard one (a client's own form, or one a
 *      Superadmin customised, is left alone);
 *   3. unit rows the form offers (never removes one);
 *   4. factors from factors.ts for the years they carry, only where the
 *      site × category has none of that name and year.
 *
 * Used by migrate:scope3-travel (every assigned site) and by the commuting
 * survey plan (its own site). Idempotent; writes nothing when everything is in
 * place; never deletes. Logs ids and counts only.
 */
import type { EntityManager } from "typeorm";
import { ColumnEntity } from "../../entities/Column";
import { ColumnConfig } from "../../entities/ColumnConfig";
import { EmissionFactor } from "../../entities/EmissionFactor";
import { Unit } from "../../entities/Unit";
import type { Site } from "../../entities/Site";
import type { Category } from "../../entities/Category";
import { TravelCategory, canon, formFields, isStandardConfig, standardHash, travelForm } from "./configs";
import { TRAVEL_FACTORS } from "./factors";

export interface FormResult {
  /** has_entries: no form yet, but the site × category already has emission rows (left alone, see below). */
  config: "created" | "updated" | "unchanged" | "customised" | "has_entries";
  units_added: number;
  factors_added: number;
}

const stripHash = (c: unknown) => {
  if (!c || typeof c !== "object") return c;
  const { standard_hash: _h, ...rest } = c as Record<string, unknown>;
  return rest;
};
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

async function columnFor(m: EntityManager, name: string, type: string): Promise<ColumnEntity> {
  const repo = m.getRepository(ColumnEntity);
  const found = await repo.findOne({ where: { column_name: name, column_type: type }, order: { pk_id: "ASC" } });
  return found ?? repo.save(repo.create({ column_name: name, column_type: type }));
}

/** The form's factors with a value, for the years factors.ts carries (missing ones only). */
async function ensureTravelFactors(m: EntityManager, site_id: number, category_id: number, names: Set<string>): Promise<number> {
  const wanted = TRAVEL_FACTORS.filter((f) => names.has(f.name) && Object.keys(f.values).length > 0);
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

export async function ensureTravelForm(m: EntityManager, site_id: number, category_id: number, n: TravelCategory): Promise<FormResult> {
  const form = travelForm(n);
  const configRepo = m.getRepository(ColumnConfig);
  const unitRepo = m.getRepository(Unit);

  const columns: ColumnEntity[] = [];
  for (const c of form.columns) columns.push(await columnFor(m, c.name, c.type));
  const selectIds = Object.fromEntries(columns.filter((c) => c.column_type === "select").map((c) => [c.column_name, c.pk_id]));
  const fields = formFields(form, selectIds);

  // One writer per site × category: two survey calls (or a survey and the migration) on a
  // site with no form would otherwise both create one.
  await m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`s3-9-form:${site_id}:${category_id}`]);

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
    // Rows saved without a form compute from `activity_value` (emissionWrite); a form would
    // change how they are edited and re-imported, so such a site keeps working as it is
    // until someone decides to move it to the standard form.
    const rows: unknown[] = await m.query(`SELECT 1 FROM emission WHERE site_id = $1 AND category_id = $2 LIMIT 1`, [site_id, category_id]);
    if (rows.length) return { config: "has_entries", units_added: 0, factors_added: 0 };
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
    config.calculation = { ...fields.calculation, standard_hash: standardHash({ ...fields, columns, extra_fields: config.extra_fields, calculation: fields.calculation }) } as ColumnConfig["calculation"];
    await configRepo.save(config);
    if (state === "unchanged") state = "updated";
  }

  const haveUnits = new Set(
    (await unitRepo.find({ where: { site: { site_id }, category: { category_id } } })).map((u) => String(u.unit_name).toLowerCase()),
  );
  let units_added = 0;
  for (const u of form.units) {
    if (haveUnits.has(u.toLowerCase())) continue;
    await unitRepo.save(unitRepo.create({ unit_name: u, description: "Scope 3 travel", site: { site_id } as Site, category: { category_id } as Category }));
    units_added++;
  }

  const factors_added = await ensureTravelFactors(m, site_id, category_id, new Set(Object.values(fields.emission_category_mapping)));
  return { config: state, units_added, factors_added };
}
