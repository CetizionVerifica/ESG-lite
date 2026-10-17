/**
 * Loads what the engine needs for one site × category, once (IM1):
 * assignment, form (column config), calculation spec, select columns,
 * factors, FERA category and its factors. A ContextCache shares the loads
 * across every row of a plan.
 */
import type { EntityManager } from "typeorm";
import { Site } from "../../entities/Site";
import { ColumnConfig } from "../../entities/ColumnConfig";
import { getCalculationSpec } from "../calculationSpec";
import { getSelectColumns } from "../activityValue";
import { FactorIndex, MappingIndex } from "./resolve";
import type { CategoryContext } from "./compute";
import { methodUnits, offeredMethods } from "../../scope3/dq/methodOptions";
import { SpendRateSource } from "../../scope3/spend/rates";
import { NO_FORM_SETTINGS, readFormSettings, type FormSettings } from "../../forms/formConfig";

export interface LoadedContext extends CategoryContext {
  mappings: MappingIndex;
  /** The site's company, for mapping lookups and scope. */
  company_id: number | null;
  /** S3-5: stored FX rates and deflators, shared by every row of the plan. */
  rates?: SpendRateSource;
  /** SE-2: what the form fixes for the person entering data (src/forms/formConfig.ts). */
  form?: FormSettings;
  /** SE-2: the company's currency for a spend row whose row and form name none (INR for current clients). */
  default_currency?: string | null;
  /** SE-4: the form rows are entered on and its version, which each row records. */
  form_id?: number | null;
  form_version?: number | null;
}

export class ContextCache {
  private readonly sites = new Map<number, Promise<Site | null>>();
  private readonly contexts = new Map<string, Promise<LoadedContext>>();

  private readonly spendRates: SpendRateSource;

  constructor(private readonly manager: EntityManager) {
    this.spendRates = new SpendRateSource(manager);
  }

  site(site_id: number): Promise<Site | null> {
    let p = this.sites.get(site_id);
    if (!p) {
      p = this.manager.getRepository(Site).findOne({ where: { site_id }, relations: ["categories", "company", "country"] });
      this.sites.set(site_id, p);
    }
    return p;
  }

  context(site_id: number, category_id: number): Promise<LoadedContext> {
    const key = `${site_id}:${category_id}`;
    let p = this.contexts.get(key);
    if (!p) {
      p = this.load(site_id, category_id);
      this.contexts.set(key, p);
    }
    return p;
  }

  private async load(site_id: number, category_id: number): Promise<LoadedContext> {
    const site = await this.site(site_id);
    const category = site?.categories?.find((c) => c.category_id === category_id) ?? null;
    const feraCategory = site?.categories?.find((c) => c.category_name.toLowerCase() === "fera") ?? null;
    const configRepo = this.manager.getRepository(ColumnConfig);
    const [configs, spec, selectColumns, factors, feraFactors, unitRows] = await Promise.all([
      // SE-2: with its columns, so a choice given by its label maps to a method too.
      configRepo.find({ where: { site: { site_id }, category: { category_id } }, relations: ["columns"], order: { config_name: "ASC" } }),
      getCalculationSpec(configRepo, site_id, category_id),
      getSelectColumns(configRepo, site_id, category_id),
      FactorIndex.load(this.manager, site_id, category_id),
      feraCategory ? FactorIndex.load(this.manager, site_id, feraCategory.category_id) : Promise.resolve(null),
      this.manager.query(`SELECT unit_name FROM unit WHERE site_id = $1 AND category_id = $2`, [site_id, category_id]) as Promise<Array<{ unit_name: string }>>,
    ]);
    const company_id = site?.company?.company_id ?? null;
    const mappings = company_id ? await MappingIndex.load(this.manager, company_id, site_id, category_id, configs[0] ?? null) : new MappingIndex();
    return {
      site_id,
      category_id,
      category_name: category?.category_name ?? "",
      scope: category?.scope ?? null,
      ghg_category: category?.ghg_category ?? null,
      assigned: !!category,
      hasForm: configs.length > 0,
      spec,
      selectColumns,
      factors,
      fera: feraCategory && feraFactors ? { category_id: feraCategory.category_id, factors: feraFactors } : null,
      formUnits: [...new Set(unitRows.map((u) => u.unit_name).filter(Boolean))],
      // S3-3: the site's country decides the factor's geographic fit, and the
      // form's methods give the default when a row names none.
      site_country: site?.country?.code ?? null,
      // `{method, units}` entries (or legacy bare keys) → the offered keys.
      method_options: configs[0]?.method_options ? offeredMethods(configs[0].method_options) : null,
      // S3-8: each method's units as unit keys, so a row with no method records the one its unit belongs to.
      method_units: configs[0]?.method_options ? methodUnits(configs[0].method_options) : null,
      mappings,
      company_id,
      rates: this.spendRates,
      // SE-2: the form's choice → method map, hidden-field defaults, fixed unit and currency.
      form: configs[0] ? readFormSettings(configs[0], configs[0]) : NO_FORM_SETTINGS,
      default_currency: site?.company?.default_currency ?? null,
      form_id: configs[0]?.pk_id ?? null,
      form_version: configs[0]?.version ?? null,
    };
  }
}
