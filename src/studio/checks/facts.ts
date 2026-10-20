/**
 * DS-12 · the facts the GHG and sustainability checks read, loaded once per
 * run, read-only (layer rule 3):
 *   - GHG readiness (DS-5): pending and rejected entries, sites and months
 *     without approved data, Scope 3 categories with approved tCO₂e;
 *   - the approved rows' GWP sets and factor sources (their factor snapshots);
 *   - approved biogenic CO₂ and the scope totals (DS-2 GhgLoader, i.e.
 *     computeGhgTables and the same approved rows);
 *   - sustainability: whether the year is locked (DS-5 readiness).
 */
import { AppDataSource } from "../../config/data-source";
import type { ReportDoc } from "../contracts";
import type { StudioCaller } from "../guard";
import { loadGhgReadiness, loadSustainabilityReadiness } from "../docs/readiness";
import { ghgFilters, type GhgLoader } from "../sources/ghg";
import { approvedWhere } from "../sources/ghg/rows";
import type { GhgFacts, SustainabilityFacts } from "./types";

type Row = Record<string, any>;

/** Factor sources (and dataset versions) on the approved rows of the period. */
export async function factorSources(companyFilters: ReturnType<typeof ghgFilters>): Promise<Array<{ source: string; version: string | null }>> {
  if (!companyFilters.siteIds.length) return [];
  const w = approvedWhere(companyFilters);
  const rows: Row[] = await AppDataSource.query(
    `SELECT DISTINCT TRIM(e.emission_factor_snapshot ->> 'source') AS source,
            NULLIF(TRIM(COALESCE(e.emission_factor_snapshot ->> 'dataset_version', e.emission_factor_snapshot ->> 'year', '')), '') AS version
       FROM emission e LEFT JOIN category c ON c.category_id = e.category_id
      WHERE ${w.sql} AND c.scope IN ('Scope 1', 'Scope 2', 'Scope 3')
        AND NULLIF(TRIM(e.emission_factor_snapshot ->> 'source'), '') IS NOT NULL
      ORDER BY 1, 2`,
    w.params,
  );
  // One entry per source, versions joined ("DEFRA (2024, 2025)").
  const by = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = String(r.source);
    const set = by.get(s) ?? new Set<string>();
    if (r.version) set.add(String(r.version));
    by.set(s, set);
  }
  return [...by.entries()].map(([source, v]) => ({ source, version: v.size ? [...v].sort().join(", ") : null }));
}

export async function loadGhgFacts(caller: StudioCaller, doc: ReportDoc, siteIds: number[], L: GhgLoader): Promise<GhgFacts> {
  const year = doc.meta.year;
  const r = await loadGhgReadiness(caller, { year, yearType: doc.meta.yearType, siteIds });
  let gwpSets: string[] = [];
  let biogenicT: number | null = null;
  let totals: GhgFacts["totals"] = null;
  let sources: GhgFacts["factorSources"] = [];
  if (siteIds.length) {
    gwpSets = (await L.coverage(year, siteIds)).gwp_sets;
    const gases = await L.gases(year, siteIds);
    const bio = (gases ?? []).filter((g) => g.rows_with_biogenic > 0);
    if (bio.length) biogenicT = Number((bio.reduce((a, g) => a + g.biogenic_kg, 0) / 1000).toPrecision(12));
    const t = await L.totals(year, siteIds);
    totals = { total: t.total, scope1: t.scope1, scope2: t.scope2, scope3: t.scope3 };
    sources = await factorSources(ghgFilters(year, doc.meta.yearType, siteIds));
  }
  return {
    periodLabel: r.periodLabel,
    pending: r.pendingRows,
    rejected: r.rejectedRows,
    sitesMissing: r.sitesMissing,
    monthsMissing: r.monthsMissing,
    scope3Reported: r.scope3.reported,
    gwpSets,
    factorSources: sources,
    biogenicT,
    totals,
  };
}

export async function loadSustainabilityFacts(caller: StudioCaller, doc: ReportDoc): Promise<SustainabilityFacts> {
  const r = await loadSustainabilityReadiness(caller, doc.meta.year);
  return { locked: r.locked, periodLabel: r.periodLabel };
}
