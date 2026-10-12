import { AppDataSource } from "../../config/data-source";
import { User } from "../../entities/User";
import { Site } from "../../entities/Site";
import { UserRole } from "../../types/type";
import { resolveUserCompanyId } from "../../utils/companyScope";
import { normalizeUnitKey } from "../../services/calculationSpec";
import { In } from "typeorm";
import { ColumnConfig } from "../../entities/ColumnConfig";
import { ImportError } from "../errors";
import { IMPORT_LIMITS } from "../limits";
import type { ActivityOption, CalcMode, ContextCategory, ContextSite, FormField, ImportContext, ReadinessCell as ContractReadinessCell } from "../contracts";

// IM3 · Import context: everything Claude (or the P27 page) needs to map a
// workbook for every category assigned to a client. See ./CLAUDE.md and
// docs/mcp-import/01-contracts.md §4. Read-only; scoped exactly like the app.

export interface ContextCaller {
  user_id: number;
  role: string;
}

/** The sites and, per site, the categories a caller may import into. */
export interface ImportScope {
  company_id: number;
  role: string;
  site_ids: number[];
  /** null = every category assigned to the site */
  category_ids: Set<number> | null;
}

/** IM0 CategoryForm plus `method_column` (which column picks the per_method calculation). */
export type ContextForm = Omit<NonNullable<ContextCategory["form"]>, "fields"> & {
  method_column?: string;
  /** `required_for`: methods (per_method names or per_unit unit keys) that need the field when `required` is false. */
  fields: (FormField & { depends_on?: string; show_for?: string[]; required_for?: string[] })[];
};

export type { ActivityOption, ContextCategory, ContextSite, ImportContext };

/** IM0 ReadinessCell plus names, the lookup year and a `ready` verdict. */
export type ReadinessCell = ContractReadinessCell & {
  site_name: string;
  category_name: string;
  /** Factors are looked up for the year before the reporting year (as Add data does). */
  lookup_year: number;
  factor_for_year: boolean;
  ready: boolean;
  missing: { what: "form" | "factor" | "factor_for_year"; fix_page: string }[];
};

export interface Readiness {
  company_id: number;
  year: number;
  cells: ReadinessCell[];
  gaps: number;
}

// Every category and scope may be entered monthly or yearly
// (docs/yearly-data-entry.md, widened Aug 2026).
const PERIOD_MODES: ("monthly" | "yearly")[] = ["monthly", "yearly"];
export const FY_START_MONTH = 4 as const;

// 60 s per company and scope; off under NODE_ENV=test so API tests that seed
// forms or factors read them back at once (same rule as src/oauth/verify.ts).
const CACHE_TTL_MS = process.env.NODE_ENV === "test" ? 0 : 60_000;
const contextCache = new Map<string, { at: number; value: ImportContext }>();
/**
 * Forget every cached context (tests, or after a form or factor change).
 * Entries are deleted one at a time on purpose: the data-safety CI treats a
 * bare "clear()" call on any object as a table wipe.
 */
export const clearImportContextCache = (): void => {
  for (const k of [...contextCache.keys()]) contextCache.delete(k);
};

const feBase = (): string => (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
export const fixUrls = (company_id: number, site_id: number, category_id: number) => ({
  form: `${feBase()}/capture/forms?site=${site_id}&category=${category_id}`,
  factors: `${feBase()}/factors?client=${company_id}&site=${site_id}&category=${category_id}`,
});

const scopeOf = (s: string | null | undefined): ContextCategory["scope"] =>
  s === "Scope 1" || s === "Scope 2" || s === "Scope 3" ? s : null;

/**
 * Which company and sites the caller may read, mirroring the app's rules
 * (utils/companyScope, utils/filterUserCategories): Superadmin names the
 * client (company_id required), an Admin gets their company, Managers their
 * managed sites, Users their site(s) and, when granted, only some categories.
 */
export async function resolveImportScope(caller: ContextCaller, requestedCompanyId?: number): Promise<ImportScope> {
  const siteRepo = AppDataSource.getRepository(Site);
  if (caller.role === UserRole.SUPERADMIN) {
    if (!requestedCompanyId) throw new ImportError("IMPORT_COMPANY_REQUIRED");
    const sites = await siteRepo.find({ where: { company: { company_id: requestedCompanyId } }, select: ["site_id"] });
    return { company_id: requestedCompanyId, role: caller.role, site_ids: sites.map((s) => s.site_id), category_ids: null };
  }
  const own = await resolveUserCompanyId(caller.user_id);
  if (!own) throw new ImportError("IMPORT_FORBIDDEN");
  if (requestedCompanyId && requestedCompanyId !== own) throw new ImportError("IMPORT_FORBIDDEN");
  const user = await AppDataSource.getRepository(User).findOne({
    where: { user_id: caller.user_id },
    relations: ["site", "sites", "categories"],
  });
  // A non-empty user_categories set narrows ANY role (filterUserCategories.ts at
  // login; a Superadmin can grant a Manager a subset, user.controller.ts).
  const granted = (user?.categories || []).length > 0 ? new Set((user!.categories || []).map((c) => c.category_id)) : null;
  if (caller.role === UserRole.ADMIN) {
    const sites = await siteRepo.find({ where: { company: { company_id: own } }, select: ["site_id"] });
    return { company_id: own, role: caller.role, site_ids: sites.map((s) => s.site_id), category_ids: granted };
  }
  const ids = new Set<number>();
  if (user?.site) ids.add(user.site.site_id);
  (user?.sites || []).forEach((s) => ids.add(s.site_id));
  return { company_id: own, role: caller.role, site_ids: [...ids], category_ids: granted };
}

/** company.mcp_enabled is added by IM5; until that migration runs it reads as off. */
export async function isMcpEnabled(company_id: number): Promise<boolean> {
  try {
    const rows = await AppDataSource.query(`SELECT mcp_enabled FROM company WHERE company_id = $1`, [company_id]);
    return rows[0]?.mcp_enabled === true;
  } catch (err: any) {
    if (err?.code === "42703") return false; // undefined_column: IM5 migration not run yet
    throw err;
  }
}

interface FactorRow { site_id: number; category_id: number; year: number; emission_category_name: string | null; global_category_name: string | null; denominator_unit: string | null }
interface MappingRow { site_id: number | null; category_id: number; company_category_name: string; global_category_name: string }
interface UnitRow { site_id: number; category_id: number; unit_name: string }

const key = (site_id: number, category_id: number) => `${site_id}:${category_id}`;

async function loadFactors(site_ids: number[]): Promise<FactorRow[]> {
  if (!site_ids.length) return [];
  return AppDataSource.query(
    `SELECT site_id, category_id, year, emission_category_name, global_category_name, denominator_unit
       FROM emission_factors WHERE site_id = ANY($1::int[])`,
    [site_ids],
  );
}

async function loadMappings(company_id: number): Promise<MappingRow[]> {
  return AppDataSource.query(
    `SELECT site_id, category_id, company_category_name, global_category_name
       FROM emission_category_mapping WHERE company_id = $1`,
    [company_id],
  );
}

async function loadUnits(site_ids: number[]): Promise<UnitRow[]> {
  if (!site_ids.length) return [];
  return AppDataSource.query(`SELECT site_id, category_id, unit_name FROM unit WHERE site_id = ANY($1::int[])`, [site_ids]);
}

const uniqSorted = (values: Iterable<string>): string[] => {
  const seen = new Map<string, string>();
  for (const v of values) {
    const t = String(v ?? "").trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

// Quantity column names the one-value rule tries first (services/activityValue.ts COMMON_FIELDS; keep in step).
const COMMON_QUANTITY_FIELDS = ["activity_value", "quantity", "value", "amount", "consumption", "activity_data"];
const columnKey = (name: string) => name.toLowerCase().trim().replace(/[\s-]+/g, "_");

/**
 * Which columns the backend rejects a row without (`required`), and which only some
 * calculation methods need (`required_for`). With a spec (calculationSpec.ts): the
 * method column plus the fields in every method's `multiply`; a field in only some
 * methods is listed under `required_for`. Without a spec the one-value rule
 * (activityValue.ts) needs one positive number: the common quantity column, else the
 * only number column; with several unnamed number columns any one will do, so none
 * is marked. Select columns are never required by the backend.
 */
function requiredColumns(config: ColumnConfig, spec: ColumnConfig["calculation"] | null): { required: Set<string>; requiredFor: Map<string, string[]> } {
  const required = new Set<string>();
  const requiredFor = new Map<string, string[]>();
  if (spec) {
    if (spec.mode === "per_method" && spec.method_column) required.add(spec.method_column);
    const methods = Object.entries(spec.methods || {});
    const perField = new Map<string, string[]>();
    for (const [name, m] of methods) for (const f of m?.multiply || []) perField.set(f, [...(perField.get(f) || []), name]);
    for (const [f, names] of perField) {
      if (names.length === methods.length) required.add(f);
      else requiredFor.set(f, names);
    }
    return { required, requiredFor };
  }
  const numbers = (config.columns || []).filter((c) => c.column_type !== "select");
  const common = numbers.find((c) => COMMON_QUANTITY_FIELDS.includes(columnKey(c.column_name)));
  if (common) required.add(common.column_name);
  else if (numbers.length === 1) required.add(numbers[0].column_name);
  return { required, requiredFor };
}

/** Column config → form. The first config by name is the one the data-entry page and calculationSpec.ts use. */
function formFromConfig(config: ColumnConfig): ContextForm {
  const fields: FormField[] = [];
  const options = config.column_options || {};
  const dependencies = config.column_dependencies || {};
  const dependent = config.dependent_options || {};
  // Same acceptance rules as getCalculationSpec (services/calculationSpec.ts).
  const raw = config.calculation;
  const spec = raw && raw.methods && ((raw.mode === "per_method" && raw.method_column) || raw.mode === "per_unit") ? raw : null;
  const { required, requiredFor } = requiredColumns(config, spec);
  for (const col of config.columns || []) {
    const parent = dependencies[col.column_name];
    const direct = options[String(col.pk_id)] || options[col.column_name];
    // A dependent select lists the union of every parent value's options; `depends_on` names the parent.
    const fromParent = parent ? Object.values(dependent[col.column_name] || {}).flat() : [];
    const opts = [...(Array.isArray(direct) ? direct : []), ...fromParent].map((o) => String(o.label ?? o.id));
    fields.push({
      key: col.column_name,
      label: col.column_name,
      type: col.column_type,
      // `required` = the backend rejects the row without it (see requiredColumns).
      required: required.has(col.column_name),
      ...(opts.length ? { options: [...new Set(opts)] } : {}),
      ...(parent ? { depends_on: parent } : {}),
      ...(requiredFor.has(col.column_name) ? { required_for: requiredFor.get(col.column_name) } : {}),
    });
  }
  for (const extra of config.extra_fields || []) {
    if (fields.some((f) => f.key === extra.key)) continue;
    fields.push({
      key: extra.key,
      label: extra.label,
      type: extra.type,
      required: !!extra.required,
      ...(extra.options?.length ? { options: extra.options } : {}),
      // Shown only when the activity name contains one of these strings (ExtraFieldDefinition.show_for).
      ...(extra.show_for?.length ? { show_for: extra.show_for } : {}),
    });
  }
  let calc_mode: CalcMode = "single";
  if (spec?.mode === "per_method") calc_mode = "per_method";
  else if (spec?.mode === "per_unit") {
    const keys = Object.keys(spec.methods || {}).map(normalizeUnitKey);
    calc_mode = keys.includes("km") || keys.includes("tonne.km") ? "distance" : "per_unit";
  }
  return { calc_mode, ...(spec?.method_column ? { method_column: spec.method_column } : {}), fields };
}

/** Forms for every site × category of the given sites, in one query. */
export async function loadForms(site_ids: number[]): Promise<Map<string, ContextForm>> {
  const forms = new Map<string, ContextForm>();
  if (!site_ids.length) return forms;
  const configs = await AppDataSource.getRepository(ColumnConfig).find({
    where: { site: { site_id: In(site_ids) } },
    relations: ["site", "category", "columns"],
    order: { config_name: "ASC" },
  });
  for (const config of configs) {
    const k = key(config.site.site_id, config.category.category_id);
    if (!forms.has(k)) forms.set(k, formFromConfig(config)); // first by config_name wins
  }
  return forms;
}

/** The data-entry form of one site × category, or null when none is configured. */
export async function loadForm(site_id: number, category_id: number): Promise<ContextForm | null> {
  const config = await AppDataSource.getRepository(ColumnConfig).findOne({
    where: { site: { site_id }, category: { category_id } },
    relations: ["columns"],
    order: { config_name: "ASC" },
  });
  return config ? formFromConfig(config) : null;
}

export async function buildImportContext(scope: ImportScope): Promise<ImportContext> {
  const cacheKey = `${scope.company_id}:${scope.role}:${scope.site_ids.join(",")}:${scope.category_ids ? [...scope.category_ids].join(",") : "*"}`;
  const hit = contextCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const [company] = await AppDataSource.query(`SELECT company_id, name FROM company WHERE company_id = $1`, [scope.company_id]);
  if (!company) throw new ImportError("IMPORT_FORBIDDEN");
  const sites = scope.site_ids.length
    ? await AppDataSource.getRepository(Site).find({
        where: scope.site_ids.map((site_id) => ({ site_id, company: { company_id: scope.company_id } })),
        relations: ["categories"],
        order: { name: "ASC" },
      })
    : [];
  const site_ids = sites.map((s) => s.site_id);
  const [factors, mappings, units, forms, mcp_enabled] = await Promise.all([
    loadFactors(site_ids),
    loadMappings(scope.company_id),
    loadUnits(site_ids),
    loadForms(site_ids),
    isMcpEnabled(scope.company_id),
  ]);

  const factorsBy = new Map<string, FactorRow[]>();
  for (const f of factors) {
    const k = key(f.site_id, f.category_id);
    (factorsBy.get(k) || factorsBy.set(k, []).get(k)!).push(f);
  }
  const unitsBy = new Map<string, string[]>();
  for (const u of units) {
    const k = key(u.site_id, u.category_id);
    (unitsBy.get(k) || unitsBy.set(k, []).get(k)!).push(u.unit_name);
  }

  const out: ContextSite[] = [];
  for (const site of sites) {
    const categories: ContextCategory[] = [];
    const cats = (site.categories || [])
      .filter((c) => !scope.category_ids || scope.category_ids.has(c.category_id))
      .sort((a, b) => a.category_name.localeCompare(b.category_name));
    for (const cat of cats) {
      const k = key(site.site_id, cat.category_id);
      const catFactors = factorsBy.get(k) || [];
      const catMappings = mappings.filter((m) => m.category_id === cat.category_id && (m.site_id === null || m.site_id === site.site_id));
      const form = forms.get(k) ?? null;
      const factorNames = new Set<string>();
      for (const f of catFactors) {
        if (f.emission_category_name) factorNames.add(f.emission_category_name.trim().toLowerCase());
        if (f.global_category_name) factorNames.add(f.global_category_name.trim().toLowerCase());
      }
      const mappingNames = new Set(catMappings.map((m) => m.company_category_name.trim().toLowerCase()).filter((n) => !factorNames.has(n)));
      categories.push({
        category_id: cat.category_id,
        name: cat.category_name,
        scope: scopeOf(cat.scope),
        period_modes: PERIOD_MODES,
        form,
        units: uniqSorted([...(unitsBy.get(k) || []), ...catFactors.map((f) => f.denominator_unit || "")]),
        activity_count: factorNames.size + mappingNames.size,
        readiness: { form: form !== null, factor_years: [...new Set(catFactors.map((f) => Number(f.year)))].sort((a, b) => a - b) },
      });
    }
    out.push({ site_id: site.site_id, name: site.name, categories });
  }

  const value: ImportContext = {
    company: { company_id: Number(company.company_id), name: company.name, mcp_enabled },
    role: scope.role,
    fy_start_month: FY_START_MONTH,
    sites: out,
  };
  contextCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

export const ACTIVITY_LIMIT_DEFAULT = 20;
/** Spec: 10–50 matches; the query schema allows up to MAX_PAGE_SIZE, so cap here. */
export const ACTIVITY_LIMIT_MAX = Math.min(50, IMPORT_LIMITS.MAX_PAGE_SIZE);

/**
 * Activity names a row may use for a site × category: factor names
 * (emission_category_name, global_category_name) and the client's P23
 * mappings (company wording → global name). Case-blind contains search,
 * ranked exact → prefix → contains, then alphabetical.
 */
export async function searchActivities(
  scope: ImportScope,
  site_id: number,
  category_id: number,
  q: string | undefined,
  limit: number,
): Promise<ActivityOption[]> {
  if (!scope.site_ids.includes(site_id)) throw new ImportError("IMPORT_FORBIDDEN");
  if (scope.category_ids && !scope.category_ids.has(category_id)) throw new ImportError("IMPORT_FORBIDDEN");
  const assigned = await AppDataSource.query(
    `SELECT 1 FROM site_categories sc JOIN site s ON s.site_id = sc.site_id
      WHERE sc.site_id = $1 AND sc.category_id = $2 AND s.company_id = $3`,
    [site_id, category_id, scope.company_id],
  );
  if (!assigned.length) throw new ImportError("IMPORT_FORBIDDEN", { reason: "CATEGORY_NOT_ASSIGNED" });

  const [factors, mappings] = await Promise.all([
    AppDataSource.query(
      `SELECT year, emission_category_name, global_category_name, denominator_unit
         FROM emission_factors WHERE site_id = $1 AND category_id = $2`,
      [site_id, category_id],
    ) as Promise<Omit<FactorRow, "site_id" | "category_id">[]>,
    AppDataSource.query(
      `SELECT site_id, category_id, company_category_name, global_category_name
         FROM emission_category_mapping
        WHERE company_id = $1 AND category_id = $2 AND (site_id IS NULL OR site_id = $3)`,
      [scope.company_id, category_id, site_id],
    ) as Promise<MappingRow[]>,
  ]);

  const byName = new Map<string, ActivityOption>();
  const add = (name: string | null, kind: "factor" | "mapping", unit: string | null, year: number | null, maps_to?: string) => {
    const t = (name ?? "").trim();
    if (!t) return;
    const k = t.toLowerCase();
    const cur = byName.get(k);
    if (cur) {
      if (unit && !cur.units.includes(unit)) cur.units.push(unit);
      if (year !== null && (cur.latest_year === null || year > cur.latest_year)) cur.latest_year = year;
      if (cur.kind === "mapping" && kind === "factor") { cur.kind = "factor"; delete cur.maps_to; }
      return;
    }
    byName.set(k, { name: t, kind, ...(maps_to ? { maps_to } : {}), units: unit ? [unit] : [], latest_year: year });
  };
  for (const f of factors) {
    add(f.emission_category_name, "factor", f.denominator_unit, Number(f.year));
    add(f.global_category_name, "factor", f.denominator_unit, Number(f.year));
  }
  for (const m of mappings) {
    const target = byName.get(m.global_category_name.trim().toLowerCase());
    add(m.company_category_name, "mapping", null, target?.latest_year ?? null, m.global_category_name);
    const added = byName.get(m.company_category_name.trim().toLowerCase());
    if (added && added.kind === "mapping" && target) added.units = [...target.units];
  }

  const needle = (q ?? "").trim().toLowerCase();
  const rank = (name: string): number => {
    const n = name.toLowerCase();
    if (!needle) return 2;
    if (n === needle) return 0;
    if (n.startsWith(needle)) return 1;
    return n.includes(needle) ? 2 : -1;
  };
  return [...byName.values()]
    .map((m) => ({ m, r: rank(m.name) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.m.name.localeCompare(b.m.name))
    .slice(0, limit)
    .map((x) => ({ ...x.m, units: uniqSorted(x.m.units) }));
}

/** Per site × category: is an import for `year` possible, and if not, what fixes it. */
export async function buildReadiness(scope: ImportScope, year: number): Promise<Readiness> {
  const context = await buildImportContext(scope);
  const lookup_year = year - 1; // Add data looks factors up for the year before the reporting year
  const cells: ReadinessCell[] = [];
  for (const site of context.sites) {
    for (const cat of site.categories) {
      const urls = fixUrls(context.company.company_id, site.site_id, cat.category_id);
      const missing: ReadinessCell["missing"] = [];
      if (!cat.readiness.form) missing.push({ what: "form", fix_page: urls.form });
      if (!cat.readiness.factor_years.length) missing.push({ what: "factor", fix_page: urls.factors });
      const factor_for_year = cat.readiness.factor_years.includes(lookup_year);
      if (cat.readiness.factor_years.length && !factor_for_year) missing.push({ what: "factor_for_year", fix_page: urls.factors });
      cells.push({
        site_id: site.site_id,
        site_name: site.name,
        category_id: cat.category_id,
        category_name: cat.name,
        form: cat.readiness.form,
        factor_years: cat.readiness.factor_years,
        lookup_year,
        factor_for_year,
        period_modes: cat.period_modes,
        // Ready = a form and at least one factor (lookups fall back to the newest year).
        ready: cat.readiness.form && cat.readiness.factor_years.length > 0,
        missing,
      });
    }
  }
  return { company_id: context.company.company_id, year, cells, gaps: cells.filter((c) => !c.ready).length };
}
