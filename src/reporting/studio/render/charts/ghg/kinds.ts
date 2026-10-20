/**
 * DS-8 · which chart kinds a binding can feed, the default binding of each GHG
 * kind, and the rules for typed (custom) data. Pure and mirrored, so the
 * editor (Charts drawer, kind picker, custom-data grid) and the server
 * (DS-12 checks) read the same rules.
 *
 * GHG series shapes are DS-2's (sources/ghg.ts): a breakdown gives one series
 * per year keyed by the breakdown; no breakdown and several years gives one
 * series keyed by year.
 */

export const GHG_CHART_KINDS = ["scope_split", "category_bars", "gas_split", "site_bars", "monthly_stack", "base_year_waterfall", "intensity_line", "treemap"] as const;
export type GhgChartKind = (typeof GHG_CHART_KINDS)[number];
export const RS_CHART_KINDS = ["bar", "stacked_bar", "line", "donut", "share_bar", "waterfall", "sankey", "target_bars", "dot_grid", "materiality_matrix", "sparkline"] as const;
export const ALL_CHART_KINDS: readonly string[] = [...GHG_CHART_KINDS, ...RS_CHART_KINDS];

export const CHART_KIND_LABELS: Record<string, string> = {
  scope_split: "Scope split",
  category_bars: "Scope 3 categories",
  gas_split: "By gas",
  site_bars: "By site",
  monthly_stack: "Monthly by scope",
  base_year_waterfall: "Base year bridge",
  intensity_line: "Intensity trend",
  treemap: "Treemap",
  bar: "Bars",
  stacked_bar: "Stacked bars",
  line: "Line",
  donut: "Donut",
  share_bar: "Share bar",
  waterfall: "Waterfall",
  sankey: "Flows",
  target_bars: "Against target",
  dot_grid: "Dot grid",
  materiality_matrix: "Materiality matrix",
  sparkline: "Sparkline",
};

/** The parts of a binding the rules read (any of GhgBinding, KpiBinding, InputBinding, CustomData). */
export interface ChartBindingLike {
  source: "ghg" | "kpi" | "input" | "custom";
  metric?: string;
  breakdown?: string;
  years?: { last: number } | number[];
  kpis?: unknown[];
  compare?: string;
  top?: number;
  scope3Category?: number;
  columns?: string[];
  rows?: unknown[][];
}

export type KindCheck = { ok: true } | { ok: false; reason: string };

const OK: KindCheck = { ok: true };
const no = (reason: string): KindCheck => ({ ok: false, reason });

/** How many years a binding asks for. */
export const yearCount = (b: Pick<ChartBindingLike, "years">): number => (Array.isArray(b.years) ? new Set(b.years).size : (b.years?.last ?? 1));

const INTENSITY = new Set(["intensity_revenue", "intensity_output", "intensity_employee"]);
const CATEGORY_BREAKDOWNS = new Set(["scope3_category", "source_category", "fuel", "site"]);

function ghgKind(kind: GhgChartKind, b: ChartBindingLike): KindCheck {
  if (b.source !== "ghg") return no(b.source === "custom" ? "GHG charts draw approved emissions only, not typed data." : "Needs an emissions figure from the Data panel.");
  switch (kind) {
    case "scope_split":
      return b.metric === "total" && b.breakdown === "scope" ? OK : no("Needs total emissions split by scope.");
    case "category_bars":
      return (b.metric === "scope3" || b.metric === "scope3_category") && b.breakdown === "scope3_category" ? OK : no("Needs Scope 3 by category.");
    case "treemap":
      return b.breakdown && CATEGORY_BREAKDOWNS.has(b.breakdown) ? OK : no("Needs emissions split into categories, sources or sites.");
    case "gas_split":
      return b.breakdown === "gas" ? OK : no("Needs emissions by gas.");
    case "site_bars":
      return b.breakdown === "site" && !INTENSITY.has(b.metric ?? "") ? OK : no("Needs emissions by site.");
    case "monthly_stack":
      return (b.breakdown === "month" || b.breakdown === "quarter") && !INTENSITY.has(b.metric ?? "") ? OK : no("Needs emissions by month or quarter.");
    case "base_year_waterfall":
      if (b.metric !== "total") return no("Needs total emissions for the base year and this year.");
      if (b.breakdown === "scope") return yearCount(b) >= 2 ? OK : no("Needs total emissions by scope for the base year and this year.");
      return !b.breakdown && (yearCount(b) >= 2 || b.compare === "base") ? OK : no("Needs total emissions for the base year and this year.");
    case "intensity_line":
      return INTENSITY.has(b.metric ?? "") && !b.breakdown && yearCount(b) >= 2 ? OK : no("Needs an intensity figure over two or more years.");
  }
}

function rsKind(kind: string, b: ChartBindingLike): KindCheck {
  if (b.source === "input") return no("Report details are text, not a chart.");
  if (b.source === "custom") {
    const numeric = (b.columns?.length ?? 0) >= 2 && (b.rows?.length ?? 0) >= 1;
    if (!["bar", "stacked_bar", "line", "donut", "share_bar"].includes(kind)) return no("Typed data draws as bars, a line, a donut or a share bar.");
    return numeric ? OK : no("Add a label column and at least one number column.");
  }
  const multiKpi = b.source === "kpi" && (b.kpis?.length ?? 0) > 1;
  const split = !!b.breakdown || multiKpi;
  const years = yearCount(b);
  switch (kind) {
    case "bar":
    case "line":
      return split || years > 1 ? OK : no("Needs several years or a breakdown.");
    case "stacked_bar":
    case "donut":
    case "share_bar":
      return split ? OK : no("Needs a breakdown into parts.");
    case "sparkline":
      return !split && years > 1 ? OK : no("Needs one figure over several years.");
    case "waterfall":
      return years >= 2 || b.compare === "base" ? OK : no("Needs a start and an end year.");
    case "sankey":
      return b.source === "kpi" ? OK : no("Needs an energy or material flow KPI.");
    case "materiality_matrix":
      return b.source === "kpi" ? OK : no("Needs the materiality assessment.");
    case "target_bars":
      return b.source === "kpi" && b.compare === "target" ? OK : no("Needs a KPI compared with its target.");
    case "dot_grid":
      return b.source === "kpi" && !split ? OK : no("Needs one share or percentage KPI.");
  }
  return no("This chart kind isn't available.");
}

/** Can `kind` draw this binding? `{ok: false, reason}` is the drawer's tooltip. */
export function chartKindValidity(kind: string, b: ChartBindingLike | undefined | null): KindCheck {
  if (!b) return no("Needs data.");
  if ((GHG_CHART_KINDS as readonly string[]).includes(kind)) return ghgKind(kind as GhgChartKind, b);
  return rsKind(kind, b);
}

/** Every kind that can draw the binding (GHG kinds first). */
export const validChartKinds = (b: ChartBindingLike | undefined | null): string[] => ALL_CHART_KINDS.filter((k) => chartKindValidity(k, b).ok);

export interface GhgBindingDefault {
  source: "ghg";
  metric: string;
  years: { last: number } | number[];
  sites: "all";
  breakdown?: string;
  top?: number;
}

/**
 * The binding a GHG kind starts with (Charts drawer): e.g. category_bars →
 * Scope 3 by category, the doc's year, top 8. `baseYear` (report details)
 * sets the waterfall's first year; without one it compares with last year.
 */
export function defaultGhgChart(kind: GhgChartKind, ctx: { year: number; baseYear?: number | null }): { binding: GhgBindingDefault; title: string; options: Record<string, boolean | string> } {
  const one = { last: 1 };
  switch (kind) {
    case "scope_split":
      return { binding: { source: "ghg", metric: "total", breakdown: "scope", years: one, sites: "all" }, title: "Emissions by scope", options: { variant: "bar" } };
    case "category_bars":
      return { binding: { source: "ghg", metric: "scope3", breakdown: "scope3_category", years: one, sites: "all", top: 8 }, title: "Scope 3 by category", options: {} };
    case "gas_split":
      return { binding: { source: "ghg", metric: "total", breakdown: "gas", years: one, sites: "all" }, title: "Emissions by gas", options: {} };
    case "site_bars":
      return { binding: { source: "ghg", metric: "total", breakdown: "site", years: one, sites: "all", top: 10 }, title: "Emissions by site", options: {} };
    case "monthly_stack":
      return { binding: { source: "ghg", metric: "total", breakdown: "month", years: one, sites: "all" }, title: "Emissions by month", options: {} };
    case "base_year_waterfall": {
      const by = ctx.baseYear && ctx.baseYear < ctx.year ? ctx.baseYear : ctx.year - 1;
      return { binding: { source: "ghg", metric: "total", breakdown: "scope", years: [by, ctx.year], sites: "all" }, title: `Change since ${by}`, options: {} };
    }
    case "intensity_line":
      return { binding: { source: "ghg", metric: "intensity_revenue", years: { last: 5 }, sites: "all" }, title: "Emissions intensity", options: {} };
    case "treemap":
      return { binding: { source: "ghg", metric: "scope3", breakdown: "scope3_category", years: one, sites: "all" }, title: "Scope 3 categories", options: {} };
  }
}

// ---------------------------------------------------------------------------
// Typed (custom) data: ≤ 200 rows × 20 columns, never labelled as a reported figure.
// ---------------------------------------------------------------------------

export const CUSTOM_MAX_ROWS = 200;
export const CUSTOM_MAX_COLS = 20;

const RESERVED = [
  /^scope\s*[123]\b/i,
  /\btotal\s+emissions?\b/i,
  /^total$/i,
  /\bt?co2e\b|\btco₂e\b|co₂e/i,
  /^(co2|co₂|ch4|ch₄|n2o|n₂o)$/i,
  /\bbiogenic\b/i,
  /\bintensity\b/i,
  /\bbase\s+year\b/i,
  /^[A-Z]{2,5}(-[A-Z0-9]+){1,4}$/, // KPI codes (ENV-GHG-S12)
];

/**
 * Whether a typed series or column label reads like a GHG or KPI metric
 * ("Scope 1", "tCO₂e", "ENV-WATER-WITHDRAWAL"). `extra` adds names to refuse
 * (the company's KPI names, from the Data panel).
 */
export function reservedLabel(label: string, extra: readonly string[] = []): boolean {
  const l = label.trim();
  if (!l) return false;
  if (RESERVED.some((r) => r.test(l))) return true;
  const low = l.toLowerCase();
  return extra.some((x) => x.trim().toLowerCase() === low);
}

/** Elements with typed data on free-form pages (the UNLINKED_DATA check, 01-contracts §6). */
export function unlinkedElements(doc: { pages: { id: string; kind: string; elements?: { id: string; type: string; props: unknown }[] }[] }): { pageId: string; elementId: string; type: string }[] {
  const out: { pageId: string; elementId: string; type: string }[] = [];
  for (const p of doc.pages) {
    if (p.kind !== "freeform") continue;
    for (const e of p.elements ?? []) {
      const b = (e.props as { binding?: { source?: string } } | null)?.binding;
      if (b?.source === "custom") out.push({ pageId: p.id, elementId: e.id, type: e.type });
    }
  }
  return out;
}
