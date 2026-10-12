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

export interface LoadedContext extends CategoryContext {
  mappings: MappingIndex;
  /** The site's company, for mapping lookups and scope. */
  company_id: number | null;
}

export class ContextCache {
  private readonly sites = new Map<number, Promise<Site | null>>();
  private readonly contexts = new Map<string, Promise<LoadedContext>>();

  constructor(private readonly manager: EntityManager) {}

  site(site_id: number): Promise<Site | null> {
    let p = this.sites.get(site_id);
    if (!p) {
      p = this.manager.getRepository(Site).findOne({ where: { site_id }, relations: ["categories", "company"] });
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
    const [configs, spec, selectColumns, factors, feraFactors] = await Promise.all([
      configRepo.find({ where: { site: { site_id }, category: { category_id } }, order: { config_name: "ASC" } }),
      getCalculationSpec(configRepo, site_id, category_id),
      getSelectColumns(configRepo, site_id, category_id),
      FactorIndex.load(this.manager, site_id, category_id),
      feraCategory ? FactorIndex.load(this.manager, site_id, feraCategory.category_id) : Promise.resolve(null),
    ]);
    const company_id = site?.company?.company_id ?? null;
    const mappings = company_id ? await MappingIndex.load(this.manager, company_id, site_id, category_id, configs[0] ?? null) : new MappingIndex();
    return {
      site_id,
      category_id,
      category_name: category?.category_name ?? "",
      scope: category?.scope ?? null,
      assigned: !!category,
      hasForm: configs.length > 0,
      spec,
      selectColumns,
      factors,
      fera: feraCategory && feraFactors ? { category_id: feraCategory.category_id, factors: feraFactors } : null,
      mappings,
      company_id,
    };
  }
}
