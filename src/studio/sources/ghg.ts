/**
 * DS-2 · the `ghg` source: GhgBinding → ResolvedBinding from APPROVED emission
 * entries, through the GHG report's own functions (layer rule 3):
 *
 *   computeGhgTables      totals per scope (and the prior year), by site and source category
 *   computeScope3         categories 1–15, DQ, primary-data share, GWP sets
 *   computeGhgByFuelType  fuel within each category
 *   baseYearSummary       the frozen Scope 3 base year (S3-14)
 *   reporting/intensity   approved production per site and month (EDE)
 *   ghg/rows.ts           months, gases, biogenic CO₂, coverage: partitions of the same rows
 *
 * The filters are built as report.controller.ts builds them for /reports/ghg
 * (`ghgFilters`): sites, CY/FY, year, frequency yearly, compare year = year − 1.
 * Every figure is tCO₂e unless the metric says otherwise (per-gas metrics are
 * tonnes of that gas; dq_score a 1–3 score; primary_data_pct a percentage).
 *
 * Metric × breakdown (anything else is DS_BINDING_INVALID `BREAKDOWN_UNSUPPORTED`):
 *   total                                   scope, site, month, quarter, gas, fuel, source_category
 *   scope1 · scope2_location · scope3        site, month, quarter, gas, fuel, source_category (+ scope3: scope3_category)
 *   scope3_category                         scope3_category
 *   intensity_output                        site, month
 *   everything else                         none
 */
import { computeGhgByFuelType, computeGhgTables, getPeriodRange, type FuelTypeRow, type GhgFilters, type GhgTablesResult } from "../../reporting/ghg-data";
import { computeScope3, type Scope3BaseYearSummary, type Scope3Report } from "../../reporting/ghg-scope3";
import { loadMonthlyProduction } from "../../reporting/intensity";
import { baseYearSummary } from "../../scope3/baseYear/service";
import { ghgCategory } from "../../scope3/contracts/ghgCategory";
import { DsError, type GhgBinding, type GhgBreakdown, type GhgMetric, type NumberFormat, type YearType } from "../contracts";
import { changeAbs, changePct, intensity } from "./derived";
import { formatNumber } from "./format";
import { coverage, gasesByScope, monthlyByScope, reportingMonthKeys, type Coverage, type GasRow, type MonthScopeRow, type ScopeName } from "./ghg/rows";
import { exclusionFor } from "./inputs";
import type { Comparison, ResolveContext, ResolvedBinding, Series, UnavailableReason } from "./types";

export const TCO2E = "tCO₂e";

/** The /reports/ghg filters for a year and sites (report.controller.ts parseGhgRequest, yearly). */
export const ghgFilters = (year: number, yearType: YearType, siteIds: number[], compareYear?: number): GhgFilters => ({
  siteIds,
  yearType,
  year,
  ...(compareYear ? { compareYear } : {}),
  frequency: "yearly",
});

export const METRIC_UNITS: Record<GhgMetric, string | null> = {
  total: TCO2E,
  scope1: TCO2E,
  scope2_location: TCO2E,
  scope2_market: TCO2E,
  scope3: TCO2E,
  scope3_category: TCO2E,
  biogenic_co2: "t CO₂ (biogenic)",
  gas_co2: "t CO₂",
  gas_ch4: "t CH₄",
  gas_n2o: "t N₂O",
  gas_other: TCO2E,
  intensity_revenue: `${TCO2E} per unit of revenue`,
  intensity_output: `${TCO2E} per unit of output`,
  intensity_employee: `${TCO2E} per employee`,
  base_year_total: TCO2E,
  dq_score: "score (1 good – 3 poor)",
  primary_data_pct: "%",
  sites_covered: "sites",
  months_covered: "months",
};

export const METRIC_LABELS: Record<GhgMetric, string> = {
  total: "Total emissions",
  scope1: "Scope 1",
  scope2_location: "Scope 2 (location-based)",
  scope2_market: "Scope 2 (market-based)",
  scope3: "Scope 3",
  scope3_category: "Scope 3 category",
  biogenic_co2: "Biogenic CO₂",
  gas_co2: "CO₂",
  gas_ch4: "CH₄",
  gas_n2o: "N₂O",
  gas_other: "Other gases",
  intensity_revenue: "Intensity per revenue",
  intensity_output: "Intensity per unit of output",
  intensity_employee: "Intensity per employee",
  base_year_total: "Base year (Scope 3)",
  dq_score: "Scope 3 data quality",
  primary_data_pct: "Scope 3 primary data",
  sites_covered: "Sites with data",
  months_covered: "Months with data",
};

const SCOPE_OF: Partial<Record<GhgMetric, ScopeName[]>> = {
  total: ["Scope 1", "Scope 2", "Scope 3"],
  scope1: ["Scope 1"],
  scope2_location: ["Scope 2"],
  scope3: ["Scope 3"],
};

const SPLITS: GhgBreakdown[] = ["site", "month", "quarter", "gas", "fuel", "source_category"];
export const BREAKDOWNS_BY_METRIC: Partial<Record<GhgMetric, GhgBreakdown[]>> = {
  total: ["scope", ...SPLITS],
  scope1: SPLITS,
  scope2_location: SPLITS,
  scope3: ["scope3_category", ...SPLITS],
  scope3_category: ["scope3_category"],
  intensity_output: ["site", "month"],
};

/** The binding's years: {last: n} counts back from the doc's year; a list is used as given (sorted). */
export function bindingYears(years: GhgBinding["years"], docYear: number): { years: number[]; current: number } {
  const list = Array.isArray(years) ? [...new Set(years)].sort((a, b) => a - b) : Array.from({ length: years.last }, (_, i) => docYear - years.last + 1 + i);
  return { years: list, current: list.includes(docYear) ? docYear : list[list.length - 1] };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const tidy = (n: number) => Number(n.toPrecision(12));

/**
 * Memoised reads for one resolve request: each report function runs once per
 * (year, sites), however many bindings ask for it.
 */
export class GhgLoader {
  private memo = new Map<string, Promise<unknown>>();
  constructor(readonly companyId: number, readonly yearType: YearType) {}

  private once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.memo.has(key)) this.memo.set(key, fn());
    return this.memo.get(key) as Promise<T>;
  }
  private k = (what: string, year: number, sites: number[]) => `${what}|${year}|${sites.join(",")}`;
  filters = (year: number, sites: number[]) => ghgFilters(year, this.yearType, sites);

  tables = (year: number, sites: number[]) => this.once(this.k("tables", year, sites), () => computeGhgTables(this.filters(year, sites))) as Promise<GhgTablesResult>;
  scope3 = (year: number, sites: number[]) => this.once(this.k("scope3", year, sites), () => computeScope3(this.filters(year, sites), this.companyId)) as Promise<Scope3Report>;
  fuel = (year: number, sites: number[]) => this.once(this.k("fuel", year, sites), () => computeGhgByFuelType(this.filters(year, sites))) as Promise<FuelTypeRow[]>;
  monthly = (year: number, sites: number[]) => this.once(this.k("monthly", year, sites), () => monthlyByScope(this.filters(year, sites))) as Promise<MonthScopeRow[]>;
  gases = (year: number, sites: number[]) => this.once(this.k("gases", year, sites), () => gasesByScope(this.filters(year, sites))) as Promise<GasRow[] | null>;
  coverage = (year: number, sites: number[]) => this.once(this.k("coverage", year, sites), () => coverage(this.filters(year, sites))) as Promise<Coverage>;
  production = (year: number, sites: number[]) =>
    this.once(this.k("production", year, sites), async () => {
      const f = this.filters(year, sites);
      const range = getPeriodRange(f.yearType, f.year, "yearly");
      return loadMonthlyProduction(sites, range);
    }) as Promise<Array<Record<string, any>>>;
  baseYear = () => this.once("baseYear", () => baseYearSummary(this.companyId)) as Promise<Scope3BaseYearSummary | null>;

  /** Scope totals for a year (tCO₂e), exactly computeGhgTables' `totals[year]`. */
  async totals(year: number, sites: number[]) {
    const t = await this.tables(year, sites);
    return t.totals[String(year)];
  }
}

interface Point {
  value: number | null;
  unavailable?: { reason: UnavailableReason; detail?: string };
  display?: string;
  unit?: string;
}

const unavailable = (reason: UnavailableReason, detail?: string): Point => ({ value: null, unavailable: { reason, ...(detail ? { detail } : {}) } });

/** One metric's figure for one year and set of sites (no breakdown). */
export async function metricValue(L: GhgLoader, ctx: ResolveContext, b: GhgBinding, year: number, sites: number[]): Promise<Point> {
  const scopes = SCOPE_OF[b.metric];
  switch (b.metric) {
    case "total":
    case "scope1":
    case "scope2_location":
    case "scope3": {
      const t = await L.totals(year, sites);
      const v = b.metric === "total" ? t.total : b.metric === "scope1" ? t.scope1 : b.metric === "scope2_location" ? t.scope2 : t.scope3;
      return { value: v };
    }
    case "scope2_market":
      return unavailable("NOT_RECORDED", "Market-based Scope 2 isn't recorded (D7).");
    case "scope3_category": {
      const n = b.scope3Category;
      if (n === undefined) return { value: (await L.totals(year, sites)).scope3 };
      const r = await L.scope3(year, sites);
      const row = r.rows.find((x) => x.n === n);
      const value = row ? row.tco2e : 0;
      const excl = exclusionFor(ctx.inputs, n);
      if (excl && !value) return { ...unavailable("EXCLUDED", excl.reason), display: `Excluded: ${excl.reason || "no reason given"}` };
      return { value };
    }
    case "biogenic_co2":
    case "gas_co2":
    case "gas_ch4":
    case "gas_n2o": {
      const g = await L.gases(year, sites);
      const rows = (g ?? []).filter((r) => (scopes ?? ["Scope 1", "Scope 2", "Scope 3"]).includes(r.scope));
      if (b.metric === "biogenic_co2") {
        if (!rows.some((r) => r.rows_with_biogenic > 0)) return unavailable("NOT_TRACKED", "No approved entry in scope records biogenic CO₂.");
        return { value: tidy(sum(rows.map((r) => r.biogenic_kg)) / 1000) };
      }
      if (!rows.some((r) => r.rows_with_gases > 0)) return unavailable("NOT_TRACKED", "No approved entry in scope records its gases.");
      const key = b.metric === "gas_co2" ? "co2_kg" : b.metric === "gas_ch4" ? "ch4_kg" : "n2o_kg";
      return { value: tidy(sum(rows.map((r) => r[key])) / 1000) };
    }
    case "gas_other":
      // Kg of each gas are stored, but not the GWP each factor used, so "total − the three" in CO₂e can't be derived honestly.
      return unavailable("NOT_RECORDED", "Other gases need the GWP values per factor, which aren't stored.");
    case "intensity_revenue":
    case "intensity_employee": {
      const key = b.metric === "intensity_revenue" ? "revenue" : "employees";
      const denom = ctx.inputs[key]?.value as number | undefined;
      if (denom === undefined || denom === null) return unavailable("NO_INPUT", `Add ${key} in Report details.`);
      const d = intensity((await L.totals(year, sites)).total, denom);
      return d.value === null ? unavailable("DIVIDE_BY_ZERO") : { value: d.value };
    }
    case "intensity_output": {
      const typed = ctx.inputs.output_units?.value as number | undefined;
      let denom: number | null = typed ?? null;
      let unit: string | undefined;
      if (denom === null) {
        const prod = await L.production(year, sites);
        if (!prod.length) return unavailable("NO_INPUT", "Add output units in Report details, or approve production data.");
        denom = sum(prod.map((p) => Number(p.production) || 0));
        const units = [...new Set(prod.map((p) => String(p.unit || "unit")))];
        if (units.length === 1) unit = `${TCO2E} per ${units[0]}`;
      }
      const d = intensity((await L.totals(year, sites)).total, denom);
      return d.value === null ? unavailable("DIVIDE_BY_ZERO") : { value: d.value, ...(unit ? { unit } : {}) };
    }
    case "base_year_total": {
      const by = await L.baseYear();
      if (!by) return unavailable("NO_BASE_YEAR", "No Scope 3 base year is set.");
      return { value: tidy(sum(by.categories.map((c) => c.tco2e))) };
    }
    case "dq_score": {
      const r = await L.scope3(year, sites);
      const scored = r.rows.filter((x) => x.dq.overall !== null && x.tco2e > 0);
      const weight = sum(scored.map((x) => x.tco2e));
      if (!weight) return unavailable(r.tracked.dq ? "NO_DATA" : "NOT_TRACKED");
      return { value: tidy(sum(scored.map((x) => (x.dq.overall as number) * x.tco2e)) / weight) };
    }
    case "primary_data_pct": {
      const r = await L.scope3(year, sites);
      if (!r.tracked.data_type) return unavailable("NOT_TRACKED");
      const rows = r.rows.filter((x) => x.tco2e > 0);
      const t = sum(rows.map((x) => x.tco2e));
      if (!t) return unavailable("NO_DATA");
      return { value: tidy(sum(rows.map((x) => x.primary_pct * x.tco2e)) / t) };
    }
    case "sites_covered": {
      const c = await L.coverage(year, sites);
      return { value: c.site_ids.length, display: `${c.site_ids.length} of ${sites.length}` };
    }
    case "months_covered": {
      const c = await L.coverage(year, sites);
      const months = new Set(reportingMonthKeys(ctx.yearType, year));
      const n = c.months.filter((m) => months.has(m)).length;
      return { value: n, display: `${n} of 12` };
    }
  }
}

/** The breakdown of a metric for one year: [{key, value}] in a stable order. */
export async function breakdownPoints(L: GhgLoader, ctx: ResolveContext, b: GhgBinding, year: number, sites: number[]): Promise<Array<{ key: string; value: number | null }>> {
  const scopes = SCOPE_OF[b.metric] ?? ["Scope 1", "Scope 2", "Scope 3"];
  const bd = b.breakdown as GhgBreakdown;
  switch (bd) {
    case "scope": {
      const t = await L.totals(year, sites);
      return [
        { key: "Scope 1", value: t.scope1 },
        { key: "Scope 2", value: t.scope2 },
        { key: "Scope 3", value: t.scope3 },
      ];
    }
    case "scope3_category": {
      const r = await L.scope3(year, sites);
      return r.rows
        .filter((x) => x.n !== null || x.tco2e > 0)
        .filter((x) => b.scope3Category === undefined || x.n === b.scope3Category)
        .map((x) => ({ key: x.n === null ? "Unmapped" : `${x.n} · ${x.name}`, value: x.tco2e }));
    }
    case "site": {
      if (b.metric === "intensity_output") {
        const t = await L.tables(year, sites);
        const prod = await L.production(year, sites);
        const rows = t.tables.table_overviewByLocations_selectedYear.rows.filter((r) => (scopes as string[]).includes(r.scope));
        const names = new Map<number, string>();
        const em = new Map<number, number>();
        for (const r of rows) for (const s of r.bySite) {
          names.set(s.siteId, s.siteName);
          em.set(s.siteId, (em.get(s.siteId) ?? 0) + s.value);
        }
        return [...em.entries()].sort((a, b2) => a[0] - b2[0]).map(([id, e]) => {
          const p = sum(prod.filter((x) => Number(x.siteId) === id).map((x) => Number(x.production) || 0));
          return { key: names.get(id) ?? String(id), value: intensity(tidy(e), p).value };
        });
      }
      const t = await L.tables(year, sites);
      const rows = t.tables.table_overviewByLocations_selectedYear.rows.filter((r) => (scopes as string[]).includes(r.scope));
      const bySite = new Map<number, { name: string; value: number }>();
      for (const r of rows)
        for (const s of r.bySite) {
          const cur = bySite.get(s.siteId) ?? { name: s.siteName, value: 0 };
          cur.value += s.value;
          bySite.set(s.siteId, cur);
        }
      return [...bySite.entries()].sort((a, b2) => a[0] - b2[0]).map(([, v]) => ({ key: v.name, value: tidy(v.value) }));
    }
    case "month":
    case "quarter": {
      const keys = reportingMonthKeys(ctx.yearType, year);
      if (b.metric === "intensity_output") {
        const m = await L.monthly(year, sites);
        const prod = await L.production(year, sites);
        return keys.map((k) => {
          const e = sum(m.filter((r) => r.month === k).map((r) => r.tco2e));
          const p = sum(prod.filter((x) => String(x.month) === k).map((x) => Number(x.production) || 0));
          return { key: k, value: intensity(tidy(e), p).value };
        });
      }
      const m = (await L.monthly(year, sites)).filter((r) => (scopes as string[]).includes(r.scope));
      const month = (k: string) => tidy(sum(m.filter((r) => r.month === k).map((r) => r.tco2e)));
      if (bd === "month") return keys.map((k) => ({ key: k, value: month(k) }));
      return [0, 1, 2, 3].map((q) => ({ key: `Q${q + 1}`, value: tidy(sum(keys.slice(q * 3, q * 3 + 3).map(month))) }));
    }
    case "gas": {
      const g = await L.gases(year, sites);
      const rows = (g ?? []).filter((r) => (scopes as string[]).includes(r.scope));
      if (!rows.some((r) => r.rows_with_gases > 0)) return [];
      return [
        { key: "CO₂", value: tidy(sum(rows.map((r) => r.co2_kg)) / 1000) },
        { key: "CH₄", value: tidy(sum(rows.map((r) => r.ch4_kg)) / 1000) },
        { key: "N₂O", value: tidy(sum(rows.map((r) => r.n2o_kg)) / 1000) },
      ];
    }
    case "fuel": {
      const f = (await L.fuel(year, sites)).filter((r) => (scopes as string[]).includes(r.scope));
      return f.map((r) => ({ key: `${r.category} · ${r.fuelType}`, value: r.emissions }));
    }
    case "source_category": {
      const t = await L.tables(year, sites);
      return t.tables.table_overviewByLocations_selectedYear.rows
        .filter((r) => (scopes as string[]).includes(r.scope))
        .map((r) => ({ key: r.category, value: r.total }));
    }
  }
  return [];
}

/** Keeps the `top` keys by the current year's value and folds the rest into "Other" (in every year). */
export function applyTop(seriesByYear: Array<{ year: number; points: Array<{ key: string; value: number | null }> }>, current: number, top?: number) {
  if (!top) return seriesByYear;
  const cur = seriesByYear.find((s) => s.year === current)?.points ?? [];
  if (cur.length <= top) return seriesByYear;
  const keep = new Set([...cur].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, top).map((p) => p.key));
  return seriesByYear.map((s) => {
    const kept = s.points.filter((p) => keep.has(p.key));
    const rest = s.points.filter((p) => !keep.has(p.key));
    const other = rest.some((p) => p.value !== null) ? tidy(sum(rest.map((p) => p.value ?? 0))) : null;
    return { year: s.year, points: rest.length ? [...kept, { key: "Other", value: other }] : kept };
  });
}

/** Sites a binding reads: the doc's sites for 'all', else its own ids (already checked against the caller). */
export const bindingSites = (ctx: ResolveContext, sites: GhgBinding["sites"]): number[] => (sites === "all" ? ctx.siteIds : [...new Set(sites)].sort((a, b) => a - b));

/** Resolves one GHG binding. Throws DS_BINDING_INVALID for a breakdown the metric doesn't have. */
export async function resolveGhg(L: GhgLoader, ctx: ResolveContext, b: GhgBinding, idx: number, format: NumberFormat = "auto"): Promise<ResolvedBinding> {
  if (b.breakdown && !(BREAKDOWNS_BY_METRIC[b.metric] ?? []).includes(b.breakdown)) {
    throw new DsError("DS_BINDING_INVALID", { bindingIdx: idx, reason: "BREAKDOWN_UNSUPPORTED", metric: b.metric, breakdown: b.breakdown, allowed: BREAKDOWNS_BY_METRIC[b.metric] ?? [] });
  }
  const sites = bindingSites(ctx, b.sites);
  const { years, current } = bindingYears(b.years, ctx.year);
  const unit = METRIC_UNITS[b.metric];
  const label = b.metric === "scope3_category" && b.scope3Category ? `${b.scope3Category} · ${ghgCategory(b.scope3Category)?.name ?? ""}`.trim() : METRIC_LABELS[b.metric];

  const main = await metricValue(L, ctx, b, current, sites);
  const cov = await L.coverage(current, sites);
  const out: ResolvedBinding = {
    source: "ghg",
    display: main.display ?? (main.unavailable ? "Not reported" : formatNumber(main.value, format)),
    value: main.value,
    unit: main.unit ?? unit,
    approvedAt: cov.approved_at,
    approvedEntries: cov.rows, // DS-7
    ...(main.unavailable ? { unavailable: main.unavailable } : {}),
  };
  if (main.unavailable) return out;

  if (b.breakdown) {
    const perYear = [];
    for (const y of years) perYear.push({ year: y, points: await breakdownPoints(L, ctx, b, y, sites) });
    const topped = applyTop(perYear, current, b.top);
    out.series = topped.map((s) => ({ label: String(s.year), values: s.points }));
    out.total = main.value;
  } else if (years.length > 1) {
    const values = [];
    for (const y of years) values.push({ key: String(y), value: y === current ? main.value : (await metricValue(L, ctx, b, y, sites)).value });
    out.series = [{ label, values } satisfies Series];
  }

  if (b.compare) out.compare = await compareGhg(L, ctx, b, current, sites, main.value);
  return out;
}

/** The figure vs the prior year, or vs the base year (frozen Scope 3 figures for Scope 3; approved rows otherwise). */
async function compareGhg(L: GhgLoader, ctx: ResolveContext, b: GhgBinding, current: number, sites: number[], value: number | null): Promise<Comparison> {
  let year: number | null;
  let against: number | null = null;
  if (b.compare === "prior") {
    year = current - 1;
    against = (await metricValue(L, ctx, b, year, sites)).value;
  } else {
    const by = await L.baseYear();
    const typed = ctx.inputs.base_year?.value as number | undefined;
    year = typed ?? by?.base_year ?? null;
    if (year === null) return { against: "base", year: null, value: null, change_abs: null, change_pct: null, reason: "NO_BASE_YEAR" };
    if (by && by.base_year === year && (b.metric === "scope3" || b.metric === "scope3_category")) {
      against = tidy(sum(by.categories.filter((c) => b.metric === "scope3" || c.n === b.scope3Category).map((c) => c.tco2e)));
    } else {
      against = (await metricValue(L, ctx, b, year, sites)).value;
    }
  }
  const abs = changeAbs(value, against);
  const pct = changePct(value, against);
  return { against: b.compare as "prior" | "base", year, value: against, change_abs: abs.value, change_pct: pct.value, ...(pct.reason ? { reason: pct.reason } : {}) };
}
