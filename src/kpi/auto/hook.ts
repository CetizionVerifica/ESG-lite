/**
 * KPI-5 · the refresh hook. The emission and production write paths call
 * `kpiSourceChanged(kind, ids)` where they already tell PCF that data changed
 * (approve, reject, edit; before a delete, while the rows still exist):
 *
 *   1. for companies with KPI tracking on, the auto values whose site and
 *      period cover a changed row are held with KPI_AUTO_STALE (`checks`);
 *   2. a debounced job (60 s after the last change of that company;
 *      `KPI_AUTO_REFRESH_DELAY_MS`) refreshes the affected reporting years,
 *      which writes fresh values and clears the hold.
 *
 * Never throws and never fails the caller's write. Under NODE_ENV=test the job
 * is off unless KPI_AUTO_REFRESH_DELAY_MS is set (tests refresh explicitly).
 */
import { AppDataSource } from "../../config/data-source";
import type { YearType } from "../contracts/enums";
import { reportingYearOf, isoDay } from "../values/period";

type Row = Record<string, any>;
type Kind = "emission" | "production";
type Hit = { company_id: number; site_id: number; from: string; to: string; year_type: YearType; sources: string[] };

export const STALE_CHECKS = (at: string) => ({ ready: false, held: ["KPI_AUTO_STALE"], checked_at: at });

export interface Debouncer {
  schedule(companyId: number, years: number[]): void;
  pending(): Map<number, number[]>;
}

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
}

/** Per company: wait `delayMs` after the last change, then run once with every year collected. */
export function createDebouncer(run: (companyId: number, years: number[]) => Promise<unknown>, delayMs: number, timers: Timers = { setTimeout, clearTimeout: (t) => clearTimeout(t as NodeJS.Timeout) }): Debouncer {
  const waiting = new Map<number, { years: Set<number>; timer: unknown }>();
  return {
    schedule(companyId, years) {
      const entry = waiting.get(companyId) ?? { years: new Set<number>(), timer: null };
      years.forEach((y) => entry.years.add(y));
      if (entry.timer !== null) timers.clearTimeout(entry.timer);
      entry.timer = timers.setTimeout(() => {
        waiting.delete(companyId);
        run(companyId, [...entry.years].sort()).catch((err) => console.error(`[kpi] auto refresh failed (company ${companyId}):`, (err as Error)?.message));
      }, delayMs);
      (entry.timer as { unref?: () => void })?.unref?.();
      waiting.set(companyId, entry);
    },
    pending: () => new Map([...waiting].map(([c, e]) => [c, [...e.years].sort()])),
  };
}

const delayFromEnv = (): number | null => {
  const raw = process.env.KPI_AUTO_REFRESH_DELAY_MS;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return process.env.NODE_ENV === "test" ? null : 60_000;
};

let debouncer: Debouncer | null | undefined;
const job = (): Debouncer | null => {
  if (debouncer === undefined) {
    const delay = delayFromEnv();
    debouncer =
      delay === null
        ? null
        : createDebouncer(async (companyId, years) => {
            // Loaded here: refresh.ts pulls in the reporting layer, which the hook's callers don't need.
            const { refreshAuto } = await import("./refresh");
            for (const y of years) {
              try {
                await refreshAuto(companyId, y);
              } catch (err) {
                // A company that hasn't finished setup has no auto values to refresh.
                if ((err as { code?: string })?.code !== "KPI_SETUP_INCOMPLETE") throw err;
              }
            }
          }, delay);
  }
  return debouncer;
};

const day = (v: unknown) => isoDay(v) as string;

/** The changed rows' companies (KPI tracking on), sites and date ranges. */
const ENERGY = ["energy_total", "energy_renewable", "energy_non_renewable"];

/** The auto sources an emission row can feed, by its category's scope (production rows feed production_output). */
export function sourcesOf(scope: string | null, ghgCategory: number | null): string[] {
  const s = (scope ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s === "scope3" || s === "s3") return ["ghg_scope3_total", ...(ghgCategory ? [`ghg_scope3_category_${ghgCategory}`] : []), ...(ghgCategory === 5 ? ["waste_total"] : [])];
  if (s === "scope1") return ["ghg_scope1", ...ENERGY];
  if (s === "scope2") return ["ghg_scope2_location", "ghg_scope2_market", ...ENERGY];
  return ENERGY;
}

async function affected(kind: Kind, ids: number[]): Promise<Hit[]> {
  const rows: Row[] =
    kind === "emission"
      ? await AppDataSource.query(
          `SELECT s.company_id, e.site_id, e.date_of_reporting AS d_from, e.date_of_reporting AS d_to, COALESCE(ks.year_type, 'CY') AS year_type, cat.scope, cat.ghg_category
             FROM emission e JOIN category cat ON cat.category_id = e.category_id JOIN site s ON s.site_id = e.site_id JOIN company c ON c.company_id = s.company_id AND c.kpi_tracking_enabled
             LEFT JOIN company_kpi_settings ks ON ks.company_id = s.company_id
            WHERE e.pk_id = ANY($1::int[])`,
          [ids],
        )
      : await AppDataSource.query(
          `SELECT s.company_id, p.site_id, p.start_date AS d_from, p.end_date AS d_to, COALESCE(ks.year_type, 'CY') AS year_type, NULL AS scope, NULL AS ghg_category
             FROM production_data p JOIN site s ON s.site_id = p.site_id JOIN company c ON c.company_id = s.company_id AND c.kpi_tracking_enabled
             LEFT JOIN company_kpi_settings ks ON ks.company_id = s.company_id
            WHERE p.production_id = ANY($1::int[])`,
          [ids],
        );
  return rows.map((r) => ({ company_id: Number(r.company_id), site_id: Number(r.site_id), from: day(r.d_from), to: day(r.d_to), year_type: r.year_type === "FY" ? "FY" : "CY",
    sources: kind === "production" ? ["production_output"] : sourcesOf(r.scope ?? null, r.ghg_category === null ? null : Number(r.ghg_category)),
  }));
}

/** Marks the affected auto values stale and schedules their refresh. Never throws. */
export async function kpiSourceChanged(kind: Kind, ids: Array<number | null | undefined>): Promise<void> {
  const clean = [...new Set(ids.filter((id): id is number => Number.isInteger(id)))];
  if (!clean.length) return;
  try {
    const hits = await affected(kind, clean);
    if (!hits.length) return;
    const now = new Date().toISOString();
    // One UPDATE per (company, site, sources) over the span of dates, not one per row: a bulk
    // approve of thousands of rows stays a handful of queries. A value inside the span that no
    // row touched is only marked stale, and the scheduled refresh recomputes it unchanged.
    const spans = new Map<string, Hit>();
    for (const h of hits) {
      const key = `${h.company_id}|${h.site_id}|${[...h.sources].sort().join(",")}`;
      const span = spans.get(key);
      if (!span) spans.set(key, { ...h });
      else {
        if (h.from < span.from) span.from = h.from;
        if (h.to > span.to) span.to = h.to;
      }
    }
    for (const h of spans.values()) {
      await AppDataSource.query(
        `UPDATE kpi_value v SET checks = $6::jsonb
           FROM kpi_definition d
          WHERE d.id = v.kpi_definition_id AND v.company_id = $1 AND v.source = 'auto'
            AND (v.site_id = $2 OR v.site_id IS NULL) AND v.period_start <= $4 AND v.period_end >= $3
            AND d.auto_source = ANY($5::text[])`,
        [h.company_id, h.site_id, h.from, h.to, h.sources, JSON.stringify(STALE_CHECKS(now))],
      );
    }
    const byCompany = new Map<number, Set<number>>();
    for (const h of hits) {
      const years = byCompany.get(h.company_id) ?? new Set<number>();
      years.add(reportingYearOf(h.from, h.year_type));
      years.add(reportingYearOf(h.to, h.year_type));
      byCompany.set(h.company_id, years);
    }
    const j = job();
    if (j) for (const [companyId, years] of byCompany) j.schedule(companyId, [...years]);
  } catch (err) {
    console.error(`[kpi] auto values not marked stale (${kind} ${clean.length} rows):`, (err as Error)?.message);
  }
}
