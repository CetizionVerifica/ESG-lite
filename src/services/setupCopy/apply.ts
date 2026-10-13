import { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { BundleForm, BundleSite, SetupBundle } from "./bundle";

/**
 * Applying a setup bundle to a client.
 *
 * The preview and the real copy run the same code: the preview runs it in a
 * transaction that is rolled back at the end (on a temporary company row when
 * the client does not exist yet, during onboarding), so what the preview shows
 * is what the copy does. Nothing that already exists is modified: every item
 * is created or skipped, and the report counts both.
 */

/** Where one bundle site goes: a new site (or the target's site of the same name), the target's only site, a given site, or nowhere. */
export type SiteTarget = "create" | "main" | "skip" | number;

export type CopyInclude = {
  units: boolean;
  forms: boolean;
  factors: boolean;
  mappings: boolean;
  threshold: boolean;
  products: boolean;
  material_factors: boolean;
};

export type CopyOptions = {
  sites?: { key: string; target: SiteTarget }[];
  include?: Partial<CopyInclude>;
  /** Factor years to copy; null or missing = every year in the bundle. */
  factor_years?: number[] | null;
  /** A form whose name is taken at the target site and category: skip it (default) or add it as "<name> (copy)". */
  form_conflict?: "skip" | "rename";
  /** Onboarding: the bundle's first site goes to the target's main site when `sites` does not say otherwise. */
  first_site?: "main" | "create";
};

export const DEFAULT_INCLUDE: CopyInclude = { units: true, forms: true, factors: true, mappings: true, threshold: true, products: true, material_factors: false };

export type Counts = { create: number; skip: number };
export type SiteReport = {
  key: string;
  name: string;
  target: { kind: "create" | "reuse" | "skip"; site_id: number | null; site_name: string | null };
  country_name: string | null;
  available_factor_years: number[];
  counts: { categories: Counts; units: Counts; forms: Counts; factors: Counts; products: Counts };
  skipped: { forms: string[]; units: string[]; products: string[] };
  warnings: string[];
};
export type CopyReport = {
  source: { company_id: number | null; company_name: string };
  target: { company_id: number | null; company_name: string | null };
  sites: SiteReport[];
  mappings: Counts;
  threshold: "create" | "keep" | "none" | "skip";
  material_factors: Counts & { licensed_excluded: number };
  columns_created: string[];
  /** The copy cannot run while any of these hold (unknown category or site). */
  errors: string[];
  warnings: string[];
  totals: Counts;
};

const counts = (): Counts => ({ create: 0, skip: 0 });
const n = (v: unknown): number => Number(v);
const norm = (v: string): string => v.trim().toLowerCase();

class Rollback extends Error {
  constructor(public readonly report: CopyReport) {
    super("rollback");
  }
}

export type CopyOutcome = { status: "ok"; report: CopyReport } | { status: "not_found" } | { status: "inactive" };

/**
 * Preview (`dryRun`) or apply a bundle on `targetCompanyId`. With no target
 * (onboarding preview) the plan is built against an empty client.
 */
export async function copySetup(
  bundle: SetupBundle,
  targetCompanyId: number | null,
  options: CopyOptions,
  opts: { dryRun: boolean; actorUserId: number | null },
): Promise<CopyOutcome> {
  try {
    const report = await AppDataSource.transaction(async (m) => {
      let companyId = targetCompanyId;
      let companyName: string | null = null;
      if (companyId === null) {
        const tmp = await m.query(`INSERT INTO company (name, address, contact_person, status) VALUES ($1, '', '', true) RETURNING company_id`, ["(preview)"]);
        companyId = n(tmp[0].company_id);
      } else {
        const rows: { name: string; status: boolean }[] = await m.query(`SELECT name, status FROM company WHERE company_id = $1 FOR UPDATE`, [companyId]);
        if (!rows.length) throw new NotFound();
        if (!rows[0].status) throw new Inactive();
        companyName = rows[0].name;
      }
      const report = await applyInto(m, bundle, companyId, companyName, options, opts.actorUserId);
      if (opts.dryRun || report.errors.length) throw new Rollback(report);
      return report;
    });
    return { status: "ok", report };
  } catch (e) {
    if (e instanceof Rollback) return { status: "ok", report: e.report };
    if (e instanceof NotFound) return { status: "not_found" };
    if (e instanceof Inactive) return { status: "inactive" };
    throw e;
  }
}

class NotFound extends Error {}
class Inactive extends Error {}

type Ctx = {
  m: EntityManager;
  companyId: number;
  categoryId: Map<string, number>;
  countryId: Map<string, number>;
  include: CopyInclude;
  years: Set<number> | null;
  formConflict: "skip" | "rename";
  actor: number | null;
  report: CopyReport;
};

async function applyInto(
  m: EntityManager,
  bundle: SetupBundle,
  companyId: number,
  companyName: string | null,
  options: CopyOptions,
  actor: number | null,
): Promise<CopyReport> {
  const include = { ...DEFAULT_INCLUDE, ...(options.include ?? {}) };
  const report: CopyReport = {
    source: { company_id: bundle.source.company_id, company_name: bundle.source.company_name },
    target: { company_id: companyName === null ? null : companyId, company_name: companyName },
    sites: [],
    mappings: counts(),
    threshold: include.threshold ? "none" : "skip",
    material_factors: { ...counts(), licensed_excluded: 0 },
    columns_created: [],
    errors: [],
    warnings: [],
    totals: counts(),
  };
  if (bundle.source.company_id !== null && bundle.source.company_id === companyId) {
    report.errors.push("A client cannot be copied onto itself.");
    return report;
  }

  const categoryId = new Map<string, number>();
  for (const r of (await m.query(`SELECT category_id, category_name FROM category`)) as { category_id: number; category_name: string }[]) {
    categoryId.set(norm(r.category_name), n(r.category_id));
  }
  const countryId = new Map<string, number>();
  for (const r of (await m.query(`SELECT country_id, name FROM country`)) as { country_id: number; name: string }[]) countryId.set(norm(r.name), n(r.country_id));

  // Every name the bundle uses must exist before anything is written.
  const missingCategories = new Set<string>();
  const needCategory = (name: string) => {
    if (!categoryId.has(norm(name))) missingCategories.add(name);
  };
  for (const site of bundle.sites) {
    site.categories.forEach(needCategory);
    site.units.forEach((u) => needCategory(u.category_name));
    site.forms.forEach((f) => needCategory(f.category_name));
    site.factors.forEach((f) => needCategory(f.category_name));
  }
  bundle.mappings.forEach((mp) => needCategory(mp.category_name));
  if (missingCategories.size) {
    report.errors.push(`Categories not in this database: ${[...missingCategories].join(", ")}. Add them under Reference data first.`);
  }

  const targetSites: { site_id: number; name: string; country_name: string | null }[] = await m.query(
    `SELECT s.site_id, s.name, c.name AS country_name FROM site s LEFT JOIN country c ON c.country_id = s.country_id
      WHERE s.company_id = $1 ORDER BY s.site_id FOR UPDATE OF s`,
    [companyId],
  );
  const wanted = new Map<string, SiteTarget>((options.sites ?? []).map((s) => [s.key, s.target]));
  for (const key of wanted.keys()) if (!bundle.sites.some((s) => s.key === key)) report.errors.push(`The bundle has no site "${key}".`);
  const claimed = new Set<number>();
  const plan: { site: BundleSite; target: SiteTarget }[] = [];
  for (const [i, site] of bundle.sites.entries()) {
    let target = wanted.get(site.key) ?? (i === 0 && options.first_site === "main" ? "main" : "create");
    if (target === "main") target = targetSites.length === 1 ? n(targetSites[0].site_id) : "create";
    if (typeof target === "number") {
      if (!targetSites.some((t) => n(t.site_id) === target)) report.errors.push(`Site ${target} does not belong to this client.`);
      else if (claimed.has(target)) report.errors.push(`Two sites of the bundle go to the same site (${target}).`);
      claimed.add(target);
    }
    plan.push({ site, target });
  }
  if (report.errors.length) return report;

  const years = options.factor_years && options.factor_years.length ? new Set(options.factor_years.map(Number)) : null;
  const ctx: Ctx = { m, companyId, categoryId, countryId, include, years, formConflict: options.form_conflict ?? "skip", actor, report };

  // Sites, then what hangs off them.
  const siteIdOf = new Map<string, number | null>();
  for (const { site, target } of plan) {
    const sr: SiteReport = {
      key: site.key,
      name: site.name,
      target: { kind: "skip", site_id: null, site_name: null },
      country_name: site.country_name,
      available_factor_years: [...new Set(site.factors.map((f) => f.year))].sort((a, b) => b - a),
      counts: { categories: counts(), units: counts(), forms: counts(), factors: counts(), products: counts() },
      skipped: { forms: [], units: [], products: [] },
      warnings: [],
    };
    report.sites.push(sr);
    if (target === "skip") {
      siteIdOf.set(site.key, null);
      continue;
    }
    let siteId: number;
    let targetCountry: string | null;
    const existing = typeof target === "number" ? targetSites.find((t) => n(t.site_id) === target) : targetSites.find((t) => norm(t.name) === norm(site.name) && !claimed.has(n(t.site_id)));
    if (existing) {
      siteId = n(existing.site_id);
      claimed.add(siteId);
      targetCountry = existing.country_name;
      sr.target = { kind: "reuse", site_id: siteId, site_name: existing.name };
    } else {
      const country = site.country_name ? (countryId.get(norm(site.country_name)) ?? null) : null;
      if (site.country_name && country === null) sr.warnings.push(`Country "${site.country_name}" is not in this database; the site is created without one.`);
      const row = await m.query(
        `INSERT INTO site (name, address, contact_person, company_id, country_id) VALUES ($1, $2, $3, $4, $5) RETURNING site_id`,
        [site.name, site.address || "Not Provided", site.contact_person || "Not Provided", companyId, country],
      );
      siteId = n(row[0].site_id);
      targetCountry = country === null ? null : site.country_name;
      sr.target = { kind: "create", site_id: siteId, site_name: site.name };
      report.totals.create++;
    }
    siteIdOf.set(site.key, siteId);
    if (include.factors && site.factors.length && site.country_name && targetCountry && norm(site.country_name) !== norm(targetCountry)) {
      sr.warnings.push(`The source site is in ${site.country_name}, this one in ${targetCountry}: check grid and fuel factors after the copy.`);
    }
    await copySiteItems(ctx, site, siteId, sr);
  }

  if (include.mappings) await copyMappings(ctx, bundle, siteIdOf, companyName);
  if (include.threshold && bundle.threshold) {
    const has = await m.query(`SELECT 1 FROM emission_threshold WHERE company_id = $1`, [companyId]);
    if (has.length) report.threshold = "keep";
    else {
      await m.query(`INSERT INTO emission_threshold (company_id, threshold_percentage) VALUES ($1, $2)`, [companyId, bundle.threshold.threshold_percentage]);
      report.threshold = "create";
      report.totals.create++;
    }
  }
  if (include.material_factors) await copyMaterialFactors(ctx, bundle);

  if (include.forms && !include.factors && bundle.sites.some((s) => s.forms.length)) {
    report.warnings.push("Forms are copied without their factors: entries made on them show \"factor missing\" until factors are loaded.");
  }
  return report;
}

async function copySiteItems(ctx: Ctx, site: BundleSite, siteId: number, sr: SiteReport) {
  const { m, include, report } = ctx;
  const cat = (name: string) => ctx.categoryId.get(norm(name))!;

  for (const name of site.categories) {
    const r = await m.query(`INSERT INTO site_categories (site_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING site_id`, [siteId, cat(name)]);
    tally(sr.counts.categories, report, r.length > 0);
  }
  // A form or unit for a category the site does not list adds the category.
  const extra = new Set<string>();
  if (include.units) site.units.forEach((u) => extra.add(u.category_name));
  if (include.forms) site.forms.forEach((f) => extra.add(f.category_name));
  if (include.factors) site.factors.forEach((f) => extra.add(f.category_name));
  for (const name of extra) {
    if (site.categories.some((c) => norm(c) === norm(name))) continue;
    const r = await m.query(`INSERT INTO site_categories (site_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING site_id`, [siteId, cat(name)]);
    tally(sr.counts.categories, report, r.length > 0);
  }

  if (include.units) {
    for (const u of site.units) {
      const dup = await m.query(`SELECT 1 FROM unit WHERE site_id = $1 AND category_id = $2 AND lower(trim(unit_name)) = $3`, [siteId, cat(u.category_name), norm(u.unit_name)]);
      if (dup.length) {
        tally(sr.counts.units, report, false);
        sr.skipped.units.push(u.unit_name);
        continue;
      }
      await m.query(`INSERT INTO unit (unit_name, description, site_id, category_id) VALUES ($1, $2, $3, $4)`, [u.unit_name, u.description, siteId, cat(u.category_name)]);
      tally(sr.counts.units, report, true);
    }
  }

  if (include.forms) for (const f of site.forms) await copyForm(ctx, f, siteId, cat(f.category_name), sr);

  if (include.factors) {
    for (const f of site.factors) {
      if (ctx.years && !ctx.years.has(f.year)) continue;
      const dup = await m.query(
        `SELECT 1 FROM emission_factors WHERE site_id = $1 AND category_id = $2 AND year = $3 AND emission_category_name IS NOT DISTINCT FROM $4`,
        [siteId, cat(f.category_name), f.year, f.emission_category_name],
      );
      if (dup.length) {
        tally(sr.counts.factors, report, false);
        continue;
      }
      await m.query(
        `INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [siteId, cat(f.category_name), f.year, f.factor_value, f.denominator_unit, f.source, f.emission_category_name, f.global_category_name],
      );
      tally(sr.counts.factors, report, true);
    }
  }

  if (include.products) {
    for (const p of site.products) {
      const dup = await m.query(`SELECT 1 FROM product WHERE site_id = $1 AND lower(trim(name)) = $2`, [siteId, norm(p.name)]);
      if (dup.length) {
        tally(sr.counts.products, report, false);
        sr.skipped.products.push(p.name);
        continue;
      }
      await m.query(
        `INSERT INTO product (name, description, unit, site_id, declared_unit, declared_unit_qty, mass_per_unit_kg, pcr_tag) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [p.name, p.description, p.unit, siteId, p.declared_unit, p.declared_unit_qty, p.mass_per_unit_kg, p.pcr_tag],
      );
      tally(sr.counts.products, report, true);
    }
  }
}

async function copyForm(ctx: Ctx, f: BundleForm, siteId: number, categoryId: number, sr: SiteReport) {
  const { m, report } = ctx;
  const taken = async (name: string) =>
    (await m.query(`SELECT 1 FROM column_config WHERE site_id = $1 AND category_id = $2 AND config_name = $3`, [siteId, categoryId, name])).length > 0;
  let name = f.config_name.trim();
  if (await taken(name)) {
    if (ctx.formConflict === "skip") {
      tally(sr.counts.forms, report, false);
      sr.skipped.forms.push(f.config_name);
      return;
    }
    let i = 1;
    while (await taken(`${f.config_name.trim()} (copy${i > 1 ? ` ${i}` : ""})`)) i++;
    name = `${f.config_name.trim()} (copy${i > 1 ? ` ${i}` : ""})`;
    sr.warnings.push(`Form "${f.config_name}" exists here; added as "${name}".`);
  }
  const columnIds: number[] = [];
  const idOfColumn = new Map<string, number>();
  for (const c of f.columns) {
    const found = await m.query(`SELECT pk_id FROM column_entity WHERE column_name = $1 AND column_type = $2 ORDER BY pk_id LIMIT 1`, [c.column_name, c.column_type]);
    let id: number;
    if (found.length) {
      id = n(found[0].pk_id);
    } else {
      const made = await m.query(`INSERT INTO column_entity (column_name, column_type) VALUES ($1, $2) RETURNING pk_id`, [c.column_name, c.column_type]);
      id = n(made[0].pk_id);
      if (!report.columns_created.includes(c.column_name)) report.columns_created.push(c.column_name);
    }
    columnIds.push(id);
    if (!idOfColumn.has(c.column_name)) idOfColumn.set(c.column_name, id);
  }
  // The bundle keys column_options by column name; the database keys it by column pk_id.
  const columnOptions: Record<string, unknown> = {};
  const orphanOptions: string[] = [];
  const rawOptions = f.column_options && typeof f.column_options === "object" && !Array.isArray(f.column_options) ? f.column_options : {};
  for (const [columnName, value] of Object.entries(rawOptions)) {
    const id = idOfColumn.get(columnName);
    if (id === undefined) orphanOptions.push(columnName);
    else columnOptions[String(id)] = value;
  }
  if (orphanOptions.length) sr.warnings.push(`Form "${name}" has dropdown options for columns it does not have: ${orphanOptions.join(", ")}; they were not copied.`);
  const calc = f.calculation as { methods?: Record<string, { multiply?: string[] }> } | null;
  if (calc?.methods) {
    const names = new Set(f.columns.map((c) => c.column_name));
    const missing = new Set<string>();
    for (const mth of Object.values(calc.methods)) (mth.multiply ?? []).forEach((col) => !names.has(col) && missing.add(col));
    if (missing.size) sr.warnings.push(`Form "${name}" multiplies columns it does not have: ${[...missing].join(", ")}.`);
  }
  const row = await m.query(
    `INSERT INTO column_config (config_name, site_id, category_id, column_options, column_dependencies, dependent_options, emission_category_mapping, extra_fields, calculation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING pk_id`,
    [
      name,
      siteId,
      categoryId,
      JSON.stringify(columnOptions),
      JSON.stringify(f.column_dependencies ?? {}),
      JSON.stringify(f.dependent_options ?? {}),
      JSON.stringify(f.emission_category_mapping ?? {}),
      JSON.stringify(Array.isArray(f.extra_fields) ? f.extra_fields : []),
      f.calculation === null || f.calculation === undefined ? null : JSON.stringify(f.calculation),
    ],
  );
  const configId = n(row[0].pk_id);
  for (const id of [...new Set(columnIds)]) {
    await m.query(`INSERT INTO column_config_columns (column_config_id, column_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [configId, id]);
  }
  tally(sr.counts.forms, report, true);
}

async function copyMappings(ctx: Ctx, bundle: SetupBundle, siteIdOf: Map<string, number | null>, companyName: string | null) {
  const { m, companyId, report } = ctx;
  const name = companyName ?? (await m.query(`SELECT name FROM company WHERE company_id = $1`, [companyId]))[0].name;
  for (const mp of bundle.mappings) {
    let siteId: number | null = null;
    if (mp.site_key !== null) {
      const mapped = siteIdOf.get(mp.site_key);
      if (mapped === null || mapped === undefined) {
        tally(report.mappings, report, false);
        continue;
      }
      siteId = mapped;
    }
    const categoryId = ctx.categoryId.get(norm(mp.category_name))!;
    const dup = await m.query(
      `SELECT 1 FROM emission_category_mapping WHERE company_id = $1 AND site_id IS NOT DISTINCT FROM $2 AND category_id = $3 AND company_category_name = $4`,
      [companyId, siteId, categoryId, mp.company_category_name],
    );
    if (dup.length) {
      tally(report.mappings, report, false);
      continue;
    }
    // The stored factor link is informational (P23 re-matches by name); it is
    // re-resolved against the target's own factors, never copied as an id.
    const ef = await m.query(
      `SELECT ef.emission_factor_id FROM emission_factors ef JOIN site s ON s.site_id = ef.site_id
        WHERE s.company_id = $1 AND ef.category_id = $2 AND ($3::int IS NULL OR ef.site_id = $3)
          AND (ef.emission_category_name IN ($4, $5) OR ef.global_category_name IN ($4, $5))
        ORDER BY ef.year DESC LIMIT 1`,
      [companyId, categoryId, siteId, mp.company_category_name.trim(), mp.global_category_name.trim()],
    );
    await m.query(
      `INSERT INTO emission_category_mapping (company_id, company_name, site_id, category_id, company_category_name, global_category_name, emission_factor_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [companyId, name, siteId, categoryId, mp.company_category_name, mp.global_category_name, ef.length ? n(ef[0].emission_factor_id) : null, ctx.actor],
    );
    tally(report.mappings, report, true);
  }
}

async function copyMaterialFactors(ctx: Ctx, bundle: SetupBundle) {
  const { m, companyId, report } = ctx;
  for (const f of bundle.material_factors ?? []) {
    if (f.licence === "ecoinvent") {
      report.material_factors.licensed_excluded++;
      continue;
    }
    const dup = await m.query(
      `SELECT 1 FROM material_factor WHERE company_id = $1 AND lower(trim(name)) = $2 AND unit = $3 AND geography IS NOT DISTINCT FROM $4`,
      [companyId, norm(f.name), f.unit, f.geography],
    );
    if (dup.length) {
      tally(report.material_factors, report, false);
      continue;
    }
    await m.query(
      `INSERT INTO material_factor (company_id, name, material_group, geography, unit, value_kgco2e, gwp_set, source, source_year, dataset_ref, licence, recycled_variant, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [companyId, f.name, f.material_group, f.geography, f.unit, f.value_kgco2e, f.gwp_set, f.source, f.source_year, f.dataset_ref, f.licence, f.recycled_variant, f.valid_from, f.valid_to],
    );
    tally(report.material_factors, report, true);
  }
}

function tally(c: Counts, report: CopyReport, created: boolean) {
  if (created) {
    c.create++;
    report.totals.create++;
  } else {
    c.skip++;
    report.totals.skip++;
  }
}
