// Copy client setup (onboarding from an existing client or a .json file).
//
// A setup bundle is everything a Superadmin builds for a client, with no
// database ids in it: sites are keyed by name, categories, countries and
// library columns by name, so a bundle taken from one database applies on
// another. It never carries people, entries, production, PCF studies,
// documents, brand or MCP data (see docs/setup-copy.md).

export const BUNDLE_VERSION = 1 as const;

export type BundleColumn = { column_name: string; column_type: string };

export type BundleForm = {
  category_name: string;
  config_name: string;
  columns: BundleColumn[];
  column_options: Record<string, unknown>;
  column_dependencies: Record<string, unknown>;
  dependent_options: Record<string, unknown>;
  emission_category_mapping: Record<string, unknown>;
  extra_fields: unknown[];
  calculation: Record<string, unknown> | null;
};

export type BundleUnit = { category_name: string; unit_name: string; description: string | null };

export type BundleFactor = {
  category_name: string;
  year: number;
  factor_value: number;
  denominator_unit: string | null;
  source: string | null;
  emission_category_name: string | null;
  global_category_name: string | null;
};

export type BundleProduct = {
  name: string;
  description: string | null;
  unit: string;
  declared_unit: string | null;
  declared_unit_qty: string | null;
  mass_per_unit_kg: string | null;
  pcr_tag: string | null;
};

export type BundleSite = {
  /** Stable key inside the bundle (the site's name; the id when two sites share a name). */
  key: string;
  name: string;
  address: string;
  contact_person: string;
  country_name: string | null;
  categories: string[];
  units: BundleUnit[];
  forms: BundleForm[];
  factors: BundleFactor[];
  products: BundleProduct[];
};

export type BundleMapping = {
  /** null = company-wide mapping. */
  site_key: string | null;
  category_name: string;
  company_category_name: string;
  global_category_name: string;
};

export type BundleMaterialFactor = {
  name: string;
  material_group: string;
  geography: string | null;
  unit: string;
  value_kgco2e: string;
  gwp_set: string;
  source: string | null;
  source_year: number | null;
  dataset_ref: string | null;
  licence: string;
  recycled_variant: boolean;
  valid_from: string | null;
  valid_to: string | null;
};

export type SetupBundle = {
  version: typeof BUNDLE_VERSION;
  source: { company_id: number | null; company_name: string; taken_at: string };
  sites: BundleSite[];
  mappings: BundleMapping[];
  threshold: { threshold_percentage: number } | null;
  material_factors: BundleMaterialFactor[];
};

/** Largest bundle accepted on upload (a few hundred rows is typical; this is only a guard). */
export const BUNDLE_MAX_BYTES = 5 * 1024 * 1024;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const optStr = (v: unknown): v is string | null => v === null || v === undefined || typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Shape check for an uploaded bundle. Returns the problems found (empty when
 * the bundle is usable). Values are checked for type only; names are matched
 * against the target database when the plan is built.
 */
export function validateBundle(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ["The file is not a setup bundle."];
  if (input.version !== BUNDLE_VERSION) problems.push(`Unsupported bundle version ${String(input.version)}; this app reads version ${BUNDLE_VERSION}.`);
  if (!isObj(input.source) || !str(input.source.company_name)) problems.push("The bundle has no source.");
  if (!Array.isArray(input.sites)) problems.push("The bundle has no sites list.");
  else {
    const keys = new Set<string>();
    input.sites.forEach((s, i) => {
      const at = `Site ${i + 1}`;
      if (!isObj(s)) return problems.push(`${at} is not an object.`);
      if (!str(s.key) || !s.key) problems.push(`${at} has no key.`);
      else if (keys.has(s.key)) problems.push(`${at}: key "${s.key}" is used twice.`);
      else keys.add(s.key);
      if (!str(s.name) || !s.name.trim()) problems.push(`${at} has no name.`);
      if (!optStr(s.country_name)) problems.push(`${at}: country_name must be text.`);
      if (!Array.isArray(s.categories) || !s.categories.every(str)) problems.push(`${at}: categories must be a list of names.`);
      for (const list of ["units", "forms", "factors", "products"] as const) {
        if (!Array.isArray(s[list])) problems.push(`${at}: ${list} must be a list.`);
      }
      if (Array.isArray(s.forms)) {
        s.forms.forEach((f, j) => {
          if (!isObj(f) || !str(f.category_name) || !str(f.config_name) || !Array.isArray(f.columns)) problems.push(`${at}: form ${j + 1} is incomplete.`);
          else if (!f.columns.every((c) => isObj(c) && str(c.column_name) && str(c.column_type))) problems.push(`${at}: form "${f.config_name}" has a malformed column.`);
        });
      }
      if (Array.isArray(s.factors)) {
        s.factors.forEach((f, j) => {
          if (!isObj(f) || !str(f.category_name) || !num(f.year) || !num(f.factor_value)) problems.push(`${at}: factor ${j + 1} is incomplete.`);
        });
      }
      if (Array.isArray(s.units)) {
        s.units.forEach((u, j) => {
          if (!isObj(u) || !str(u.category_name) || !str(u.unit_name)) problems.push(`${at}: unit ${j + 1} is incomplete.`);
        });
      }
      if (Array.isArray(s.products)) {
        s.products.forEach((p, j) => {
          if (!isObj(p) || !str(p.name) || !str(p.unit)) problems.push(`${at}: product ${j + 1} is incomplete.`);
        });
      }
    });
  }
  if (!Array.isArray(input.mappings)) problems.push("The bundle has no mappings list.");
  else {
    input.mappings.forEach((m, i) => {
      if (!isObj(m) || !optStr(m.site_key) || !str(m.category_name) || !str(m.company_category_name) || !str(m.global_category_name)) {
        problems.push(`Mapping ${i + 1} is incomplete.`);
      }
    });
  }
  if (input.threshold !== null && input.threshold !== undefined) {
    if (!isObj(input.threshold) || !num(input.threshold.threshold_percentage)) problems.push("The threshold is malformed.");
  }
  if (input.material_factors !== undefined && !Array.isArray(input.material_factors)) problems.push("material_factors must be a list.");
  else if (Array.isArray(input.material_factors)) {
    input.material_factors.forEach((f, i) => {
      if (!isObj(f) || !str(f.name) || !str(f.material_group) || !str(f.unit) || !str(f.value_kgco2e)) problems.push(`Material factor ${i + 1} is incomplete.`);
    });
  }
  return problems;
}
