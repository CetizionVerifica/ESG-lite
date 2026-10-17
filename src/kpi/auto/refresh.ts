/**
 * KPI-5 · refreshing auto values.
 *
 *   refreshAuto(companyId, year)   every selected auto KPI of the company, for every period of the
 *                                  reporting year that has started, per site (or for the company):
 *                                  the adapter's value is written through values/system.ts
 *                                  (`source:'auto'`, `status:'approved'`, since its inputs are
 *                                  approved rows); no source rows → an earlier value is removed.
 *                                  Then every calculated KPI of the year recomputes (KPI-6).
 *   POST /kpi/auto/refresh?year=   Manager, Admin, Superadmin (router.ts).
 *
 * Refreshes of one company run one at a time (in this process).
 */
import { AppDataSource } from "../../config/data-source";
import { KpiError } from "../contracts/errors";
import { recomputeFormulas, type RecomputeResult } from "../formulas/recompute";
import { kpiSettings, setupCompleted, todayIso } from "../setup/settings";
import { periodsFor } from "../values/period";
import { removeSystemValue, writeSystemValue } from "../values/system";
import { ADAPTERS } from "./adapters";
import type { AdapterKpi } from "./types";

type Row = Record<string, any>;

export interface RefreshResult {
  year: number;
  /** Auto values created or changed. */
  refreshed: number;
  unchanged: number;
  removed: number;
  /** Left as they were because their period is locked. */
  locked: number;
  /** Auto KPIs × sites × periods whose source had nothing (no value). */
  empty: number;
  value_ids: number[];
  formulas: RecomputeResult;
}

const running = new Map<number, Promise<unknown>>();

/** Runs `fn` after any refresh of the same company already running. */
function serial<T>(companyId: number, fn: () => Promise<T>): Promise<T> {
  const before = running.get(companyId) ?? Promise.resolve();
  const next = before.catch(() => undefined).then(fn);
  running.set(companyId, next);
  next.finally(() => {
    if (running.get(companyId) === next) running.delete(companyId);
  }).catch(() => undefined);
  return next;
}

export function refreshAuto(companyId: number, year: number): Promise<RefreshResult> {
  return serial(companyId, () => refreshNow(companyId, year));
}

async function refreshNow(companyId: number, year: number): Promise<RefreshResult> {
  const m = AppDataSource.manager;
  if (!(await setupCompleted(m, companyId))) throw new KpiError("KPI_SETUP_INCOMPLETE");
  const { year_type: yearType } = await kpiSettings(m, companyId);
  const kpis: Row[] = await m.query(
    `SELECT d.id, d.code, d.auto_source, d.canonical_unit, d.unit_dimension, d.allowed_units, d.breakdowns, d.level, d.default_frequency, ck.frequency
       FROM kpi_definition d JOIN company_kpi ck ON ck.kpi_definition_id = d.id AND ck.company_id = $1 AND ck.selected
      WHERE d.active AND d.source = 'auto' AND d.auto_source IS NOT NULL AND (d.company_id IS NULL OR d.company_id = $1)
      ORDER BY d.code`,
    [companyId],
  );
  const siteIds: number[] = (await m.query(`SELECT site_id FROM site WHERE company_id = $1 ORDER BY site_id`, [companyId])).map((r: Row) => Number(r.site_id));
  const today = todayIso();
  const out: RefreshResult = { year, refreshed: 0, unchanged: 0, removed: 0, locked: 0, empty: 0, value_ids: [], formulas: { written: 0, unchanged: 0, removed: 0, locked: 0, value_ids: [] } };
  const cache = new Map<string, Promise<unknown>>();
  // Stored auto values of the year, so "nothing to read" removes only what exists.
  const yr = periodsFor("annual", yearType, year)[0];
  const stored = new Set<string>(
    (
      await m.query(`SELECT kpi_definition_id, site_id, period_start::text AS start, frequency FROM kpi_value WHERE company_id = $1 AND source = 'auto' AND period_start >= $2 AND period_end <= $3`, [
        companyId,
        yr.start,
        yr.end,
      ])
    ).map((r: Row) => `${r.kpi_definition_id}|${r.site_id ?? ""}|${r.start}|${r.frequency}`),
  );

  for (const k of kpis) {
    const adapter = ADAPTERS[k.auto_source];
    if (!adapter) continue;
    const kpi: AdapterKpi = {
      id: Number(k.id),
      code: k.code,
      auto_source: k.auto_source,
      canonical_unit: k.canonical_unit ?? null,
      unit_dimension: k.unit_dimension,
      allowed_units: k.allowed_units ?? [],
      breakdowns: k.breakdowns ?? null,
    };
    const targets: Array<number | null> = k.level === "company" ? [null] : siteIds;
    for (const period of periodsFor(k.frequency ?? k.default_frequency, yearType, year)) {
      if (period.start > today) continue; // a period that hasn't started has nothing to read yet
      for (const target of targets) {
        const r = await adapter({ m, companyId, siteIds: target === null ? siteIds : [target], period, kpi, cache });
        if (!r) {
          out.empty++;
          if (!stored.has(`${kpi.id}|${target ?? ""}|${period.start}|${period.frequency}`)) continue;
          const gone = await removeSystemValue({ companyId, siteId: target, kpiId: kpi.id, period, source: "auto" });
          if (gone === "removed") out.removed++;
          if (gone === "locked") out.locked++;
          continue;
        }
        const w = await writeSystemValue({
          companyId,
          siteId: target,
          kpi: { id: kpi.id, code: kpi.code, canonical_unit: kpi.canonical_unit },
          period,
          value: r.value_canonical,
          breakdown: r.breakdown ?? null,
          source: "auto",
          status: "approved",
          snapshot: r.snapshot,
        });
        if (w.outcome === "created" || w.outcome === "updated") out.refreshed++;
        else if (w.outcome === "unchanged") out.unchanged++;
        else if (w.outcome === "locked") out.locked++;
        if (w.id && w.outcome !== "locked" && w.outcome !== "manual_value") out.value_ids.push(w.id);
      }
    }
  }
  // Auto values feed calculated KPIs (KPI-6): recompute the year's formulas.
  out.formulas = await recomputeFormulas(companyId, { years: [year] });
  return out;
}
