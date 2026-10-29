/**
 * DS-2 (RS-2 port) · the `kpi` source: KpiBinding → ResolvedBinding from
 * APPROVED KPI values only (KPI D14), read with the KPI module's own pure
 * functions (no edits there):
 *
 *   targets/service figureDefs   the company's definitions with their company frequency
 *   values/yearly loadValues     the stored rows; `figureOf` rolls a year up (missing is never 0)
 *   values/units convert         binding.unit ↔ canonical unit
 *   esg/headlines HEADLINES      a headline code (GHG_SCOPE1_2) expands to its parts and sums
 *                                the selected ones (same rule as headlines.ts)
 *   targets/progress progress    the company target's progress
 *
 * Years are the company's KPI reporting years (company_kpi_settings.year_type),
 * as the KPI reports read them. A KPI the company doesn't track (unknown, not
 * selected, inactive) or a unit that can't be converted is DS_BINDING_INVALID;
 * KPI tracking off resolves `unavailable: KPI_TRACKING_OFF`.
 *
 * `value` is the first KPI's figure for the current year; `series` has one
 * series per KPI over the years, or with `breakdown` one series per year:
 * 'site' → per site, anything else → the KPI's breakdown parts (sum KPIs).
 * `unit` is the binding's unit or the first KPI's canonical unit; each series
 * carries its own `unit` (#209 review: KPIs in one binding can differ, e.g.
 * tCO2e, kL and %), so the renderer formats each in its own unit.
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { HEADLINES } from "../../kpi/esg/headlines";
import { kpiSettings } from "../../kpi/setup/settings";
import { progress } from "../../kpi/targets/progress";
import { figureDefs } from "../../kpi/targets/service";
import { convert, normaliseUnit } from "../../kpi/values/units";
import { yearRange } from "../../kpi/values/period";
import { figureOf, loadValues, type FigureDef, type StoredValue, type YearFigure } from "../../kpi/values/yearly";
import { DsError, type KpiBinding, type NumberFormat, type YearType } from "../contracts";
import { changeAbs, changePct } from "./derived";
import { formatNumber } from "./format";
import { bindingYears } from "./ghg";
import type { Comparison, ResolveContext, ResolvedBinding } from "./types";

type Row = Record<string, any>;
type Def = Row & FigureDef & { code: string };

const tidy = (n: number) => Number(n.toPrecision(12));

/** Per-request memo of the company's KPI definitions, settings and values. */
export class KpiLoader {
  private defsP?: Promise<{ byId: Map<number, Def>; byCode: Map<string, FigureDef> }>;
  private yearTypeP?: Promise<YearType>;
  private values = new Map<string, Promise<StoredValue[]>>();
  constructor(readonly companyId: number, readonly m: EntityManager = AppDataSource.manager) {}

  defs() {
    this.defsP ??= figureDefs(this.m, this.companyId) as Promise<{ byId: Map<number, Def>; byCode: Map<string, FigureDef> }>;
    return this.defsP;
  }
  yearType() {
    this.yearTypeP ??= kpiSettings(this.m, this.companyId).then((s) => s.year_type as YearType);
    return this.yearTypeP;
  }
  /** Approved values of the KPIs between two reporting years. */
  async load(kpiIds: number[], from: number, to: number): Promise<StoredValue[]> {
    const yt = await this.yearType();
    const key = `${[...kpiIds].sort().join(",")}|${from}|${to}`;
    if (!this.values.has(key)) this.values.set(key, loadValues(this.m, this.companyId, { from: yearRange(yt, from).start, to: yearRange(yt, to).end, statuses: ["approved"], kpiIds }));
    return this.values.get(key)!;
  }
}

/** The library or company definition a code names, selected and active; a headline code gives its selected parts. */
export async function expandCode(L: KpiLoader, code: string): Promise<{ name: string; parts: Def[] } | null> {
  const { byId } = await L.defs();
  const usable = (c: string): Def | undefined => {
    const candidates = [...byId.values()].filter((d) => d.code === c);
    const def = candidates.find((d) => d.company_id !== null && d.company_id !== undefined) ?? candidates[0];
    return def && def.selected === true && def.active === true ? def : undefined;
  };
  const headline = HEADLINES.find((h) => h.code === code && h.parts.length > 1);
  if (headline) {
    const parts = headline.parts.map(usable).filter((d): d is Def => !!d);
    return parts.length ? { name: headline.name ?? code, parts } : null;
  }
  const def = usable(code);
  return def ? { name: String(def.name), parts: [def] } : null;
}

interface KpiFigure {
  value: number | null;
  text: string | null;
  complete: boolean;
  valueIds: number[];
  breakdown: Record<string, number> | null;
}

/** A code's figure for one year: one KPI's figureOf, or the sum of a headline's parts. */
function codeFigure(parts: Def[], values: StoredValue[], byCode: Map<string, FigureDef>, year: number, yearType: YearType, sites: number[], site?: number): KpiFigure {
  const figs: YearFigure[] = parts.map((d) => figureOf(d, values, byCode, { year, yearType, sites, ...(site !== undefined && d.level === "site" ? { site } : {}) }));
  const nums = figs.map((f) => f.value).filter((v): v is number => v !== null);
  let breakdown: Record<string, number> | null = null;
  for (const f of figs) if (f.breakdown) for (const [k, v] of Object.entries(f.breakdown)) (breakdown ??= {})[k] = tidy((breakdown[k] ?? 0) + v);
  return {
    value: nums.length ? tidy(nums.reduce((a, b) => a + b, 0)) : null,
    text: parts.length === 1 ? figs[0].text : null,
    complete: figs.every((f) => f.complete),
    valueIds: figs.flatMap((f) => f.value_ids),
    breakdown,
  };
}

const unitOf = (parts: Def[]): string | null => (parts[0]?.canonical_unit ? String(parts[0].canonical_unit) : null);

/** The figure in the binding's unit; null when it can't be converted. */
const inUnit = (v: number | null, from: string | null, to: string | undefined): number | null =>
  v === null || !to || !from || normaliseUnit(from) === normaliseUnit(to) ? v : convert(v, from, to);

export async function resolveKpi(L: KpiLoader, ctx: ResolveContext, b: KpiBinding, idx: number, format: NumberFormat = "auto"): Promise<ResolvedBinding> {
  if (!ctx.kpiEnabled) return { source: "kpi", display: "Not reported", value: null, unit: b.unit ?? null, unavailable: { reason: "KPI_TRACKING_OFF" } };
  const { byCode } = await L.defs();
  const yearType = await L.yearType();
  const codes: Array<{ code: string; name: string; parts: Def[]; unit: string | null }> = [];
  for (const code of b.kpis) {
    const e = await expandCode(L, code);
    if (!e) throw new DsError("DS_BINDING_INVALID", { bindingIdx: idx, reason: "KPI_NOT_SELECTED", kpi: code });
    const from = unitOf(e.parts);
    if (b.unit && from && normaliseUnit(from) !== normaliseUnit(b.unit) && convert(1, from, b.unit) === null) {
      throw new DsError("DS_BINDING_INVALID", { bindingIdx: idx, reason: "UNIT_INVALID", kpi: code, unit: b.unit, canonical: from });
    }
    codes.push({ code, ...e, unit: from });
  }
  const sites = b.sites === "all" ? ctx.siteIds : [...new Set(b.sites)].sort((a, c) => a - c);
  const { years, current } = bindingYears(b.years, ctx.year);
  const first = codes[0];

  // Target of the first KPI (company level, the latest target year) for compare/progress.
  const targets: Row[] = await L.m.query(
    `SELECT baseline_year, baseline_value, target_year, target_value, direction FROM kpi_target
      WHERE company_id = $1 AND kpi_definition_id = $2 AND site_id IS NULL ORDER BY target_year DESC LIMIT 1`,
    [ctx.companyId, first.parts[0].id],
  ).catch(() => []);
  const t = targets[0]
    ? { baseline_year: Number(targets[0].baseline_year), baseline_value: Number(targets[0].baseline_value), target_year: Number(targets[0].target_year), target_value: Number(targets[0].target_value), direction: targets[0].direction }
    : null;

  const fromYear = Math.min(years[0], current - 1, t?.baseline_year ?? Infinity);
  const values = await L.load([...new Set(codes.flatMap((c) => c.parts.map((p) => p.id)))], fromYear, Math.max(current, years[years.length - 1]));
  const fig = (c: (typeof codes)[number], y: number, site?: number) => codeFigure(c.parts, values, byCode, y, yearType, sites, site);
  const conv = (c: (typeof codes)[number], v: number | null) => {
    const r = inUnit(v, c.unit, b.unit);
    return r === null ? null : tidy(r);
  };

  const cur = fig(first, current);
  const value = conv(first, cur.value);
  const unit = b.unit ?? first.unit;

  // Approval and evidence behind the current figure.
  let approvedAt: string | null = null;
  let evidenceCount = 0;
  if (cur.valueIds.length) {
    const [a]: Row[] = await L.m.query(`SELECT MAX(reviewed_at) AS at FROM kpi_value WHERE company_id = $1 AND id = ANY($2::int[])`, [ctx.companyId, cur.valueIds]);
    approvedAt = a?.at ? new Date(a.at).toISOString() : null;
    const [e]: Row[] = await L.m.query(`SELECT COUNT(*)::int AS n FROM kpi_value_evidence WHERE kpi_value_id = ANY($1::int[])`, [cur.valueIds]).catch(() => [{ n: 0 }]);
    evidenceCount = Number(e?.n) || 0;
  }

  const out: ResolvedBinding = {
    source: "kpi",
    display: value !== null ? formatNumber(value, format, unit) : cur.text ?? "Not reported", // #209: a tCO2e KPI shows 3 decimals
    value,
    unit,
    approvedAt,
    evidenceCount,
    complete: cur.complete,
    ...(value === null && cur.text === null ? { unavailable: { reason: "NO_DATA" as const } } : {}),
  };

  // #209 review: every series carries its unit; with several KPIs each is in its own (or the binding's).
  if (b.breakdown === "site") {
    out.series = years.map((y) => ({ label: String(y), values: sites.map((s) => ({ key: String(s), value: conv(first, fig(first, y, s).value) })), unit }));
  } else if (b.breakdown) {
    out.series = years.map((y) => {
      const parts = fig(first, y).breakdown ?? {};
      return { label: String(y), values: Object.keys(parts).sort().map((k) => ({ key: k, value: conv(first, parts[k]) })), unit };
    });
  } else {
    out.series = codes.map((c) => ({ label: c.name, values: years.map((y) => ({ key: String(y), value: conv(c, fig(c, y).value) })), unit: b.unit ?? c.unit }));
  }
  if (b.breakdown || codes.length > 1) out.total = value;

  if (t) {
    const points = [];
    for (let y = t.baseline_year + 1; y <= Math.max(current, t.baseline_year + 1); y++) points.push({ year: y, value: fig(first, y).value });
    const p = progress(t, points.filter((pt) => pt.year <= current));
    out.target = { ...t, baseline_value: conv(first, t.baseline_value) ?? t.baseline_value, target_value: conv(first, t.target_value) ?? t.target_value, progress_pct: p.progress_pct, status: p.status };
  }

  if (b.compare) {
    let cmp: Comparison;
    if (b.compare === "prior") {
      const prior = conv(first, fig(first, current - 1).value);
      cmp = { against: "prior", year: current - 1, value: prior, change_abs: changeAbs(value, prior).value, change_pct: changePct(value, prior).value };
    } else if (!t) {
      cmp = { against: b.compare, year: null, value: null, change_abs: null, change_pct: null, reason: "NO_TARGET" };
    } else {
      const y = b.compare === "base" ? t.baseline_year : t.target_year;
      const v = conv(first, b.compare === "base" ? t.baseline_value : t.target_value);
      cmp = { against: b.compare, year: y, value: v, change_abs: changeAbs(value, v).value, change_pct: changePct(value, v).value };
    }
    out.compare = cmp;
  }
  return out;
}

/** One KPI's approved figure for a reporting year (report-input prefill: REVENUE, EMPLOYEES_TOTAL). Null when not tracked or no value. */
export async function kpiYearValue(L: KpiLoader, code: string, year: number, sites: number[]): Promise<{ value: number; unit: string | null } | null> {
  const e = await expandCode(L, code);
  if (!e) return null;
  const { byCode } = await L.defs();
  const yt = await L.yearType();
  const values = await L.load(e.parts.map((p) => p.id), year, year);
  const f = codeFigure(e.parts, values, byCode, year, yt, sites);
  return f.value === null ? null : { value: f.value, unit: unitOf(e.parts) };
}
