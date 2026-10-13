import { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { BUNDLE_VERSION, BundleFactor, BundleForm, BundleMapping, BundleMaterialFactor, BundleProduct, BundleSite, BundleUnit, SetupBundle } from "./bundle";

type SiteRow = { site_id: number; name: string; address: string; contact_person: string; country_name: string | null };

const n = (v: unknown): number => Number(v);
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * Everything a Superadmin set up for one client, keyed by names (no ids), so
 * the result can be saved as a file and applied to another client or another
 * database. Rows that are history (entries, people, PCF studies, documents)
 * are never read. Licensed material factors ('ecoinvent') are left out.
 */
export async function readBundle(companyId: number, manager?: EntityManager): Promise<SetupBundle | null> {
  const m = manager ?? AppDataSource.manager;
  const company: { company_id: number; name: string }[] = await m.query(`SELECT company_id, name FROM company WHERE company_id = $1`, [companyId]);
  if (!company.length) return null;

  const sites: SiteRow[] = await m.query(
    `SELECT s.site_id, s.name, s.address, s.contact_person, c.name AS country_name
       FROM site s LEFT JOIN country c ON c.country_id = s.country_id
      WHERE s.company_id = $1 ORDER BY s.site_id`,
    [companyId],
  );
  const siteIds = sites.map((r) => n(r.site_id));

  // A site's name is its key; when two sites share a name the id disambiguates.
  const nameCount = new Map<string, number>();
  for (const r of sites) nameCount.set(r.name, (nameCount.get(r.name) ?? 0) + 1);
  const keyOf = new Map<number, string>();
  for (const r of sites) keyOf.set(n(r.site_id), (nameCount.get(r.name) ?? 0) > 1 ? `${r.name} #${r.site_id}` : r.name);

  const bySite = <T>(rows: (T & { site_id: number })[]): Map<number, T[]> => {
    const out = new Map<number, T[]>();
    for (const r of rows) {
      const list = out.get(n(r.site_id)) ?? [];
      list.push(r);
      out.set(n(r.site_id), list);
    }
    return out;
  };

  const empty = { sites: [] as BundleSite[] };
  if (!siteIds.length) {
    return {
      version: BUNDLE_VERSION,
      source: { company_id: companyId, company_name: company[0].name, taken_at: new Date().toISOString() },
      ...empty,
      mappings: await readMappings(m, companyId, keyOf),
      threshold: await readThreshold(m, companyId),
      material_factors: await readMaterialFactors(m, companyId),
    };
  }

  const categories = bySite<{ site_id: number; category_name: string }>(
    await m.query(
      `SELECT sc.site_id, c.category_name FROM site_categories sc JOIN category c ON c.category_id = sc.category_id
        WHERE sc.site_id = ANY($1) ORDER BY c.category_id`,
      [siteIds],
    ),
  );
  const units = bySite<{ site_id: number } & BundleUnit>(
    await m.query(
      `SELECT u.site_id, c.category_name, u.unit_name, u.description FROM unit u JOIN category c ON c.category_id = u.category_id
        WHERE u.site_id = ANY($1) ORDER BY u.unit_id`,
      [siteIds],
    ),
  );
  const formRows: ({ site_id: number; pk_id: number } & Omit<BundleForm, "columns">)[] = await m.query(
    `SELECT cc.site_id, cc.pk_id, c.category_name, cc.config_name, cc.column_options, cc.column_dependencies, cc.dependent_options,
            cc.emission_category_mapping, cc.extra_fields, cc.calculation
       FROM column_config cc JOIN category c ON c.category_id = cc.category_id
      WHERE cc.site_id = ANY($1) ORDER BY cc.pk_id`,
    [siteIds],
  );
  const columnRows: { column_config_id: number; column_name: string; column_type: string }[] = formRows.length
    ? await m.query(
        `SELECT ccc.column_config_id, ce.column_name, ce.column_type
           FROM column_config_columns ccc JOIN column_entity ce ON ce.pk_id = ccc.column_id
          WHERE ccc.column_config_id = ANY($1) ORDER BY ccc.column_config_id, ce.pk_id`,
        [formRows.map((f) => n(f.pk_id))],
      )
    : [];
  const columnsOf = new Map<number, { column_name: string; column_type: string }[]>();
  for (const r of columnRows) {
    const list = columnsOf.get(n(r.column_config_id)) ?? [];
    list.push({ column_name: r.column_name, column_type: r.column_type });
    columnsOf.set(n(r.column_config_id), list);
  }
  const forms = bySite<{ site_id: number } & BundleForm>(
    formRows.map((f) => ({
      site_id: f.site_id,
      category_name: f.category_name,
      config_name: f.config_name,
      columns: columnsOf.get(n(f.pk_id)) ?? [],
      column_options: f.column_options ?? {},
      column_dependencies: f.column_dependencies ?? {},
      dependent_options: f.dependent_options ?? {},
      emission_category_mapping: f.emission_category_mapping ?? {},
      extra_fields: Array.isArray(f.extra_fields) ? f.extra_fields : [],
      calculation: f.calculation ?? null,
    })),
  );
  const factors = bySite<{ site_id: number } & BundleFactor>(
    (
      await m.query(
        `SELECT ef.site_id, c.category_name, ef.year, ef.factor_value, ef.denominator_unit, ef.source, ef.emission_category_name, ef.global_category_name
           FROM emission_factors ef JOIN category c ON c.category_id = ef.category_id
          WHERE ef.site_id = ANY($1) ORDER BY ef.emission_factor_id`,
        [siteIds],
      )
    ).map((r: Record<string, unknown>) => ({
      site_id: n(r.site_id),
      category_name: String(r.category_name),
      year: n(r.year),
      factor_value: n(r.factor_value),
      denominator_unit: s(r.denominator_unit),
      source: s(r.source),
      emission_category_name: s(r.emission_category_name),
      global_category_name: s(r.global_category_name),
    })),
  );
  const products = bySite<{ site_id: number } & BundleProduct>(
    (
      await m.query(
        `SELECT site_id, name, description, unit, declared_unit, declared_unit_qty, mass_per_unit_kg, pcr_tag
           FROM product WHERE site_id = ANY($1) ORDER BY product_id`,
        [siteIds],
      )
    ).map((r: Record<string, unknown>) => ({
      site_id: n(r.site_id),
      name: String(r.name),
      description: s(r.description),
      unit: String(r.unit),
      declared_unit: s(r.declared_unit),
      declared_unit_qty: s(r.declared_unit_qty),
      mass_per_unit_kg: s(r.mass_per_unit_kg),
      pcr_tag: s(r.pcr_tag),
    })),
  );

  const strip = <T extends { site_id: number }>(rows: T[] | undefined): Omit<T, "site_id">[] =>
    (rows ?? []).map(({ site_id: _ignored, ...rest }) => rest);

  const bundleSites: BundleSite[] = sites.map((r) => {
    const id = n(r.site_id);
    return {
      key: keyOf.get(id)!,
      name: r.name,
      address: r.address,
      contact_person: r.contact_person,
      country_name: r.country_name ?? null,
      categories: (categories.get(id) ?? []).map((c) => c.category_name),
      units: strip(units.get(id)),
      forms: strip(forms.get(id)),
      factors: strip(factors.get(id)),
      products: strip(products.get(id)),
    };
  });

  return {
    version: BUNDLE_VERSION,
    source: { company_id: companyId, company_name: company[0].name, taken_at: new Date().toISOString() },
    sites: bundleSites,
    mappings: await readMappings(m, companyId, keyOf),
    threshold: await readThreshold(m, companyId),
    material_factors: await readMaterialFactors(m, companyId),
  };
}

async function readMappings(m: EntityManager, companyId: number, keyOf: Map<number, string>): Promise<BundleMapping[]> {
  const rows: { site_id: number | null; category_name: string; company_category_name: string; global_category_name: string }[] = await m.query(
    `SELECT ecm.site_id, c.category_name, ecm.company_category_name, ecm.global_category_name
       FROM emission_category_mapping ecm JOIN category c ON c.category_id = ecm.category_id
      WHERE ecm.company_id = $1 ORDER BY ecm.id`,
    [companyId],
  );
  return rows
    // A mapping on a site that is not this company's (stale data) is left out.
    .filter((r) => r.site_id === null || keyOf.has(n(r.site_id)))
    .map((r) => ({
      site_key: r.site_id === null ? null : keyOf.get(n(r.site_id))!,
      category_name: r.category_name,
      company_category_name: r.company_category_name,
      global_category_name: r.global_category_name,
    }));
}

async function readThreshold(m: EntityManager, companyId: number): Promise<{ threshold_percentage: number } | null> {
  const rows: { threshold_percentage: string }[] = await m.query(`SELECT threshold_percentage FROM emission_threshold WHERE company_id = $1`, [companyId]);
  return rows.length ? { threshold_percentage: n(rows[0].threshold_percentage) } : null;
}

async function readMaterialFactors(m: EntityManager, companyId: number): Promise<BundleMaterialFactor[]> {
  const rows: Record<string, unknown>[] = await m.query(
    `SELECT name, material_group, geography, unit, value_kgco2e, gwp_set, source, source_year, dataset_ref, licence, recycled_variant, valid_from, valid_to
       FROM material_factor WHERE company_id = $1 AND licence <> 'ecoinvent' ORDER BY material_factor_id`,
    [companyId],
  );
  return rows.map((r) => ({
    name: String(r.name),
    material_group: String(r.material_group),
    geography: s(r.geography),
    unit: String(r.unit),
    value_kgco2e: String(r.value_kgco2e),
    gwp_set: String(r.gwp_set),
    source: s(r.source),
    source_year: r.source_year === null || r.source_year === undefined ? null : n(r.source_year),
    dataset_ref: s(r.dataset_ref),
    licence: String(r.licence),
    recycled_variant: !!r.recycled_variant,
    valid_from: r.valid_from === null || r.valid_from === undefined ? null : String(r.valid_from).slice(0, 10),
    valid_to: r.valid_to === null || r.valid_to === undefined ? null : String(r.valid_to).slice(0, 10),
  }));
}
