/**
 * Activity name → emission factor (IM1).
 *
 * Order, per docs/mcp-import/backend/IM1-emission-write-service/CLAUDE.md:
 *   1. plan match (the user told Claude "HSD means Diesel" for this plan)
 *   2. client mapping (P23: emission_category_mapping, site-specific first)
 *   3. the factor itself, exactly as utils/findEmissionFactor.ts resolves a
 *      typed entry: exact name + year, exact global + year, exact name any
 *      year (newest), exact global any year (newest), then trimmed and
 *      case-blind name/global with year, then any year.
 *
 * The factors of one site × category are loaded once (a few hundred rows at
 * most) and resolved in memory, so planning 5,000 rows does not run 5,000
 * queries. Typed entries use the same index, so the matched factor is the
 * same by construction.
 */
import { EntityManager, IsNull } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { EmissionFactor } from "../../entities/EmissionFactor";
import { EmissionCategoryMapping } from "../../entities/EmissionCategoryMapping";
import { ColumnConfig } from "../../entities/ColumnConfig";
import type { ActivityMatch } from "../../imports/contracts";

export const normalizeName = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

/** Reporting year − 1, parsed from the date string (matches the data-entry form). */
export const targetYearFor = (dateOfReporting: string | Date): number => {
  const year =
    typeof dateOfReporting === "string"
      ? dateOfReporting.substring(0, 4)
      : new Date(dateOfReporting).getFullYear().toString();
  return parseInt(year) - 1;
};

export interface FactorMatch {
  factor: EmissionFactor;
  /** True when no factor exists for the target year and an earlier/later one was used. */
  fallback_year: boolean;
}

/** Factors of one site × category, resolved in memory. */
export class FactorIndex {
  constructor(readonly factors: EmissionFactor[]) {
    // Stable order: lowest id first, so ties resolve like the database's
    // physical order did for the single-row lookups.
    this.factors = [...factors].sort((a, b) => a.emission_factor_id - b.emission_factor_id);
  }

  static async load(manager: EntityManager, site_id: number, category_id: number): Promise<FactorIndex> {
    const rows = await manager.getRepository(EmissionFactor).find({
      where: { site: { site_id }, category: { category_id } },
    });
    return new FactorIndex(rows);
  }

  get isEmpty(): boolean {
    return this.factors.length === 0;
  }

  private newest(list: EmissionFactor[]): EmissionFactor | undefined {
    return [...list].sort((a, b) => b.year - a.year || a.emission_factor_id - b.emission_factor_id)[0];
  }

  /** Same six steps as findEmissionFactorForCategory. */
  find(name: string, year: number): FactorMatch | null {
    const f = this.factors;
    const exact =
      f.find((x) => x.emission_category_name === name && x.year === year) ||
      f.find((x) => x.global_category_name === name && x.year === year) ||
      this.newest(f.filter((x) => x.emission_category_name === name)) ||
      this.newest(f.filter((x) => x.global_category_name === name));
    if (exact) return { factor: exact, fallback_year: exact.year !== year };

    const target = normalizeName(name);
    const matches = f
      .filter((x) => normalizeName(x.emission_category_name) === target || normalizeName(x.global_category_name) === target)
      .sort((a, b) => b.year - a.year || a.emission_factor_id - b.emission_factor_id);
    const found = matches.find((x) => x.year === year) || matches[0] || null;
    return found ? { factor: found, fallback_year: found.year !== year } : null;
  }

  /** FERA twin lookup: exact name + year, else exact global + year, nothing looser. */
  findExactForYear(name: string, year: number): EmissionFactor | null {
    return (
      this.factors.find((x) => x.emission_category_name === name && x.year === year) ||
      this.factors.find((x) => x.global_category_name === name && x.year === year) ||
      null
    );
  }

  /** True when any factor carries this name (any year). */
  knows(name: string): boolean {
    return this.find(name, -1) !== null;
  }

  /** Distinct factor names, newest year first, for UNKNOWN_ACTIVITY suggestions. */
  names(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of [...this.factors].sort((a, b) => b.year - a.year)) {
      const n = x.emission_category_name || x.global_category_name;
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }

  years(): number[] {
    return [...new Set(this.factors.map((x) => x.year))].sort((a, b) => b - a);
  }
}

/**
 * Client mappings (P23) for one site × category: sheet wording → factor
 * name, case-blind. Site-specific rows win over company-wide ones, and the
 * column config's own `emission_category_mapping` (dropdown combinations)
 * is consulted first, as the bulk importer does.
 */
export class MappingIndex {
  private readonly byName = new Map<string, { name: string; factor_name: string; emission_factor_id: number | null }>();

  static async load(manager: EntityManager, company_id: number, site_id: number, category_id: number, config: ColumnConfig | null): Promise<MappingIndex> {
    const idx = new MappingIndex();
    for (const [key, value] of Object.entries(config?.emission_category_mapping ?? {})) {
      if (key && value) idx.byName.set(normalizeName(key), { name: key.trim(), factor_name: String(value).trim(), emission_factor_id: null });
    }
    const rows = await manager.getRepository(EmissionCategoryMapping).find({
      where: [
        { company_id, category_id, site_id },
        { company_id, category_id, site_id: IsNull() },
      ],
    });
    // Company-wide first, then site-specific overrides.
    for (const m of rows.sort((a, b) => (a.site_id === null ? 0 : 1) - (b.site_id === null ? 0 : 1))) {
      const key = normalizeName(m.company_category_name);
      if (!key || !m.global_category_name) continue;
      if (!idx.byName.has(key) || m.site_id !== null) {
        idx.byName.set(key, { name: m.company_category_name.trim(), factor_name: m.global_category_name.trim(), emission_factor_id: m.emission_factor_id ?? null });
      }
    }
    return idx;
  }

  get(sheetName: string): { factor_name: string; emission_factor_id: number | null } | null {
    return this.byName.get(normalizeName(sheetName)) ?? null;
  }

  /** Every mapping as it resolves: the client's wording as stored, the factor name and the pinned factor (#183 unit options). */
  entries(): Array<{ name: string; factor_name: string; emission_factor_id: number | null }> {
    return [...this.byName.values()];
  }
}

export interface ResolvedActivity {
  /** Name used for the factor lookup (after plan match or mapping). */
  name: string;
  matched_by: "factor" | "mapping" | "plan_match";
  match: FactorMatch;
}

/** Plan matches for one site × category, case-blind on the sheet wording. */
export const planMatchFor = (matches: ActivityMatch[], site_id: number, category_id: number, sheetName: string): ActivityMatch | null =>
  matches.find((m) => m.site_id === site_id && m.category_id === category_id && normalizeName(m.sheet_name) === normalizeName(sheetName)) ?? null;

/**
 * Resolve a sheet's activity name. Returns null when nothing matches; the
 * caller turns that into UNKNOWN_ACTIVITY with suggestions.
 */
export const resolveActivity = (
  factors: FactorIndex,
  mappings: MappingIndex,
  planMatch: ActivityMatch | null,
  sheetName: string,
  year: number,
): ResolvedActivity | null => {
  if (planMatch) {
    const match = factors.find(planMatch.factor_name, year);
    if (match) return { name: planMatch.factor_name, matched_by: "plan_match", match };
  }
  const mapped = mappings.get(sheetName);
  if (mapped) {
    const byId = mapped.emission_factor_id ? factors.factors.find((f) => f.emission_factor_id === mapped.emission_factor_id) : undefined;
    const match = byId ? { factor: byId, fallback_year: byId.year !== year } : factors.find(mapped.factor_name, year);
    if (match) return { name: mapped.factor_name, matched_by: "mapping", match };
  }
  const direct = factors.find(sheetName, year);
  if (direct) return { name: sheetName, matched_by: "factor", match: direct };
  return null;
};

/** Up to `limit` factor names closest to the sheet wording, for the issue message. */
export const suggestNames = (factors: FactorIndex, sheetName: string, limit: number): string[] => {
  const target = normalizeName(sheetName);
  const tokens = target.split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  const score = (n: string) => {
    const norm = normalizeName(n);
    if (norm === target) return 100;
    if (norm.includes(target) || target.includes(norm)) return 50;
    return tokens.filter((t) => norm.includes(t)).length;
  };
  return factors
    .names()
    .map((n) => ({ n, s: score(n) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.n);
};

export const defaultManager = (): EntityManager => AppDataSource.manager;
