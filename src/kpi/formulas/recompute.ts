/**
 * KPI-6 · recompute calculated KPIs from their inputs and store them
 * (`source: 'formula'`, through values/system.ts).
 *
 *   recomputeFormulas(companyId, {years, changedCodes?})
 *       every selected formula KPI of the company (or only those that use
 *       `changedCodes`, transitively), for every period of each reporting year,
 *       per site (site-level KPIs) or for the company. Inputs before the KPIs
 *       that use them, so a formula of a formula sees the fresh value.
 *   recomputeForValues(companyId, valueIds)
 *       the hook after values change (submit; KPI-8's approve and reject; KPI-5's
 *       refresh): the dependants of those values' KPIs, in their years.
 *
 * Inputs are values that were submitted: pending or approved (drafts and
 * rejected values don't count). The result is `approved` when every input
 * used is approved, else `pending` with "Waiting for …" in its comment. With
 * an input missing, or a division by zero, there is no value: an earlier one
 * is removed. Locked periods are left as they are.
 * How a reference resolves for a site or the company and a period: resolve.ts.
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import type { KpiFrequency, YearType } from "../contracts/enums";
import { kpiSettings } from "../setup/settings";
import { periodsFor, reportingYearOf, isoDay } from "../values/period";
import { removeSystemValue, writeSystemValue } from "../values/system";
import { evaluate } from "./evaluate";
import { dependantsOf, evaluationOrder } from "./graph";
import { parseFormula, type Ast } from "./parse";
import { makeResolver, type CompanyDef, type MemValue } from "./resolve";

type Row = Record<string, any>;

/** Every KPI the company can use (active library KPIs and its own), with its frequency and selection. */
export async function companyDefinitions(m: EntityManager, companyId: number): Promise<CompanyDef[]> {
  const rows: Row[] = await m.query(
    `SELECT d.id, d.code, d.name, d.source, d.formula, d.canonical_unit, d.level, d.aggregation, d.default_frequency, ck.frequency, COALESCE(ck.selected, false) AS selected
       FROM kpi_definition d LEFT JOIN company_kpi ck ON ck.kpi_definition_id = d.id AND ck.company_id = $1
      WHERE d.active AND (d.company_id IS NULL OR d.company_id = $1)`,
    [companyId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    code: r.code,
    name: r.name,
    source: r.source,
    formula: r.formula ?? null,
    canonical_unit: r.canonical_unit ?? null,
    level: r.level,
    aggregation: r.aggregation,
    frequency: (r.frequency ?? r.default_frequency) as KpiFrequency,
    selected: r.selected === true,
  }));
}

const day = (v: unknown) => isoDay(v) as string;

async function loadValues(m: EntityManager, companyId: number, range: { start: string; end: string }): Promise<MemValue[]> {
  const rows: Row[] = await m.query(
    `SELECT id, kpi_definition_id, site_id, period_start, period_end, frequency, value_canonical, breakdown, status
       FROM kpi_value WHERE company_id = $1 AND status IN ('pending', 'approved') AND period_start >= $2 AND period_end <= $3`,
    [companyId, range.start, range.end],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kpi_definition_id: Number(r.kpi_definition_id),
    site_id: r.site_id === null ? null : Number(r.site_id),
    period_start: day(r.period_start),
    period_end: day(r.period_end),
    frequency: r.frequency,
    value: r.value_canonical === null ? null : Number(r.value_canonical),
    breakdown: r.breakdown ?? null,
    status: r.status,
  }));
}

export interface RecomputeResult {
  written: number;
  unchanged: number;
  removed: number;
  locked: number;
  value_ids: number[];
}

const NAME_LIMIT = 6;
const waitingText = (codes: string[], defs: Map<string, CompanyDef>) => {
  const names = codes.map((c) => defs.get(c.replace(/^(sum|avg)\(/, "").replace(/\)$/, "").split(".")[0])?.name ?? c);
  const unique = [...new Set(names)];
  return `Waiting for ${unique.slice(0, NAME_LIMIT).join(", ")}${unique.length > NAME_LIMIT ? ` and ${unique.length - NAME_LIMIT} more` : ""}.`;
};

export async function recomputeFormulas(companyId: number, opts: { years: number[]; changedCodes?: string[] }): Promise<RecomputeResult> {
  const m = AppDataSource.manager;
  const out: RecomputeResult = { written: 0, unchanged: 0, removed: 0, locked: 0, value_ids: [] };
  const settings = await kpiSettings(m, companyId);
  const yearType: YearType = settings.year_type;
  const all = await companyDefinitions(m, companyId);
  const defs = new Map(all.map((d) => [d.code, d]));
  const wanted = opts.changedCodes ? dependantsOf(all, opts.changedCodes) : undefined;
  const order = evaluationOrder(all, wanted).map((c) => defs.get(c)!).filter((d) => d.selected && d.source === "formula" && d.formula);
  if (!order.length) return out;
  const siteIds: number[] = (await m.query(`SELECT site_id FROM site WHERE company_id = $1 ORDER BY site_id`, [companyId])).map((r: Row) => Number(r.site_id));

  for (const year of [...new Set(opts.years)].sort()) {
    const yr = periodsFor("annual", yearType, year)[0];
    const values = await loadValues(m, companyId, yr);
    for (const f of order) {
      let ast: Ast;
      try {
        ast = parseFormula(f.formula!);
      } catch {
        continue; // refused at save time; an old bad row is skipped, never guessed
      }
      const targets = f.level === "company" ? [null] : siteIds;
      for (const period of periodsFor(f.frequency, yearType, year)) {
        for (const target of targets) {
          const result = evaluate(ast, makeResolver(defs, values, siteIds, target, period));
          if (result.value === null) {
            // Only a stored formula value needs removing (formula values are always pending or approved, so in `values`).
            const i = values.findIndex((v) => v.kpi_definition_id === f.id && v.site_id === target && v.period_start === period.start && v.frequency === period.frequency);
            if (i < 0) continue;
            const r = await removeSystemValue({ companyId, siteId: target, kpiId: f.id, period, source: "formula" });
            if (r === "removed") {
              out.removed++;
              values.splice(i, 1);
            }
            if (r === "locked") out.locked++;
            continue;
          }
          const status = result.waiting_for.length ? "pending" : "approved";
          const snapshot = {
            kind: "formula",
            formula: f.formula,
            unit: f.canonical_unit,
            inputs: result.inputs,
            waiting_for: result.waiting_for,
            computed_at: new Date().toISOString(),
          };
          const w = await writeSystemValue({
            companyId,
            siteId: target,
            kpi: { id: f.id, code: f.code, canonical_unit: f.canonical_unit },
            period,
            value: result.value,
            source: "formula",
            status,
            snapshot,
            comment: status === "pending" ? waitingText(result.waiting_for, defs) : null,
          });
          if (w.outcome === "created" || w.outcome === "updated") out.written++;
          else if (w.outcome === "unchanged") out.unchanged++;
          else if (w.outcome === "locked") out.locked++;
          if (w.id && (w.outcome === "created" || w.outcome === "updated" || w.outcome === "unchanged")) {
            out.value_ids.push(w.id);
            const mem: MemValue = { id: w.id, kpi_definition_id: f.id, site_id: target, period_start: period.start, period_end: period.end, frequency: period.frequency, value: Number(result.value.toFixed(6)), breakdown: null, status };
            const i = values.findIndex((v) => v.id === w.id);
            if (i >= 0) values[i] = mem;
            else values.push(mem);
          }
        }
      }
    }
  }
  return out;
}

/** After values changed (submitted, approved, rejected, refreshed): recompute their dependants in their years. Never throws. */
export async function recomputeForValues(companyId: number, valueIds: number[]): Promise<RecomputeResult | null> {
  if (!valueIds.length) return null;
  try {
    const m = AppDataSource.manager;
    const rows: Row[] = await m.query(
      `SELECT DISTINCT d.code, v.period_start FROM kpi_value v JOIN kpi_definition d ON d.id = v.kpi_definition_id WHERE v.company_id = $1 AND v.id = ANY($2::int[])`,
      [companyId, valueIds],
    );
    if (!rows.length) return null;
    const yearType = (await kpiSettings(m, companyId)).year_type;
    const years = [...new Set(rows.map((r) => reportingYearOf(day(r.period_start), yearType)))];
    return await recomputeFormulas(companyId, { years, changedCodes: [...new Set(rows.map((r) => String(r.code)))] });
  } catch (err) {
    console.error(`[kpi] formula recompute failed (company ${companyId}):`, (err as Error)?.message);
    return null;
  }
}
