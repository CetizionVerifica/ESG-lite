/**
 * KPI-8 · the review checks of 01-contracts §5 (ids in contracts/checks.ts).
 *
 *   computeChecks(input)       pure: which checks hold a value, plus what they found
 *   storeChecks(m, valueId)    reads what the checks need, computes and stores `kpi_value.checks`
 *
 * Stored on submit, on evidence changes and again at approval (so `only_ready`
 * always reads the value as it is now). A value is Ready when nothing holds it.
 *
 *   KPI_EVIDENCE        a manual value with no evidence. D15: evidence is required to submit a
 *                       BRSR Core value, and elsewhere missing evidence holds the value in review.
 *                       Auto and calculated values trace to their source instead.
 *   KPI_CHANGE_LIMIT    more than the company's change limit (emission_threshold.threshold_percentage,
 *                       default 5 %) away from the same period last year (pending or approved);
 *                       no value last year passes; last year 0 and now not 0 holds
 *   KPI_BREAKDOWN_SUM   the parts differ from the total (as entered) by more than ±0.5 %
 *   KPI_UNIT_CONVERTED  informational (never holds): entered in a unit other than the canonical one
 *   KPI_ESTIMATE        marked as an estimate
 *   KPI_AUTO_STALE      kept while KPI-5's hook holds an auto value (a refresh clears it)
 */
import type { EntityManager } from "typeorm";
import { BREAKDOWN_TOLERANCE, KPI_INFO_CHECKS, type KpiCheckId, type KpiValueChecks } from "../contracts/checks";
import { isoDay } from "../values/period";
import { normaliseUnit } from "../values/units";

type Row = Record<string, any>;

/** The company change limit when no emission_threshold row exists (Threshold's default). */
export const DEFAULT_CHANGE_LIMIT_PCT = 5;

export interface CheckInput {
  source: string;
  value_numeric: number | null;
  value_canonical: number | null;
  unit: string | null;
  canonical_unit: string | null;
  breakdown: Record<string, number> | null;
  is_estimate: boolean;
  evidence_count: number;
  /** value_canonical of the same period last year (pending or approved), or null */
  previous: number | null;
  limit_pct: number;
  /** KPI-5 held this auto value (KPI_AUTO_STALE in its stored checks) */
  stale: boolean;
  checked_at?: string;
}

const round = (n: number, d = 1) => Number(n.toFixed(d));

export function computeChecks(i: CheckInput): KpiValueChecks {
  const found: KpiCheckId[] = [];
  const details: Record<string, Record<string, unknown>> = {};

  if (i.source === "manual" && i.evidence_count === 0) found.push("KPI_EVIDENCE");

  if (i.previous !== null && i.value_canonical !== null) {
    const prev = i.previous;
    const cur = i.value_canonical;
    if (prev === 0) {
      if (cur !== 0) {
        found.push("KPI_CHANGE_LIMIT");
        details.KPI_CHANGE_LIMIT = { previous: prev, change_pct: null, ratio: null, limit_pct: i.limit_pct };
      }
    } else {
      const pct = ((cur - prev) / Math.abs(prev)) * 100;
      if (Math.abs(pct) > i.limit_pct + 1e-9) {
        found.push("KPI_CHANGE_LIMIT");
        details.KPI_CHANGE_LIMIT = { previous: prev, change_pct: round(pct), ratio: round(cur / prev, 2), limit_pct: i.limit_pct };
      }
    }
  }

  if (i.breakdown && Object.keys(i.breakdown).length && i.value_numeric !== null) {
    const parts = Object.values(i.breakdown).reduce((a, b) => a + Number(b), 0);
    const total = i.value_numeric;
    if (Math.abs(parts - total) > BREAKDOWN_TOLERANCE * Math.abs(total) + 1e-9) {
      found.push("KPI_BREAKDOWN_SUM");
      details.KPI_BREAKDOWN_SUM = { parts: Number(parts.toPrecision(12)), total, difference_pct: total === 0 ? null : round(((parts - total) / Math.abs(total)) * 100, 2) };
    }
  }

  if (i.unit && i.canonical_unit && normaliseUnit(i.unit) !== normaliseUnit(i.canonical_unit)) found.push("KPI_UNIT_CONVERTED");
  if (i.is_estimate) found.push("KPI_ESTIMATE");
  if (i.stale) found.push("KPI_AUTO_STALE");

  const held = found.filter((c) => !KPI_INFO_CHECKS.includes(c));
  const info = found.filter((c) => KPI_INFO_CHECKS.includes(c));
  return {
    ready: held.length === 0,
    held,
    info,
    ...(Object.keys(details).length ? { details } : {}),
    checked_at: i.checked_at ?? new Date().toISOString(),
  };
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const minusYear = (iso: string) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;

/** The company's change limit in % (the emissions `Threshold`). */
export async function changeLimitPct(m: EntityManager, companyId: number): Promise<number> {
  const rows: Row[] = await m.query(`SELECT threshold_percentage FROM emission_threshold WHERE company_id = $1`, [companyId]);
  const v = rows.length ? Number(rows[0].threshold_percentage) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_CHANGE_LIMIT_PCT;
}

/** The facts the checks need for one stored value (a row of kpi_value). */
export async function checkInputFor(m: EntityManager, v: Row, limitPct?: number): Promise<CheckInput> {
  const [def]: Row[] = await m.query(`SELECT canonical_unit FROM kpi_definition WHERE id = $1`, [v.kpi_definition_id]);
  const [ev]: Row[] = await m.query(`SELECT COUNT(*)::int AS n FROM kpi_value_evidence WHERE kpi_value_id = $1`, [v.id]);
  const [prev]: Row[] = await m.query(
    `SELECT value_canonical FROM kpi_value
      WHERE company_id = $1 AND site_id IS NOT DISTINCT FROM $2 AND kpi_definition_id = $3 AND frequency = $4 AND period_start = $5
        AND status IN ('pending', 'approved')`,
    [v.company_id, v.site_id, v.kpi_definition_id, v.frequency, minusYear(isoDay(v.period_start) as string)],
  );
  return {
    source: v.source,
    value_numeric: num(v.value_numeric),
    value_canonical: num(v.value_canonical),
    unit: v.unit ?? null,
    canonical_unit: def?.canonical_unit ?? null,
    breakdown: v.breakdown ?? null,
    is_estimate: v.is_estimate === true,
    evidence_count: Number(ev?.n ?? 0),
    previous: prev ? num(prev.value_canonical) : null,
    limit_pct: limitPct ?? (await changeLimitPct(m, Number(v.company_id))),
    stale: Array.isArray(v.checks?.held) && v.checks.held.includes("KPI_AUTO_STALE"),
  };
}

/** Computes and stores the checks of value `valueId`; returns them (null when the value is gone). */
export async function storeChecks(m: EntityManager, valueId: number): Promise<KpiValueChecks | null> {
  const [v]: Row[] = await m.query(`SELECT * FROM kpi_value WHERE id = $1`, [valueId]);
  if (!v) return null;
  const checks = computeChecks(await checkInputFor(m, v));
  await m.query(`UPDATE kpi_value SET checks = $2 WHERE id = $1`, [valueId, JSON.stringify(checks)]);
  return checks;
}
