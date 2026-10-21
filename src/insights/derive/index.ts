/**
 * Insights derive (layer rule 4): every figure Insights adds to what the
 * source pages already show is a pure function here, unit tested in
 * ci/unit/in-*.test.cjs. Panels assemble; they never calculate.
 *
 * IN-1 (summary):
 *   changePct(now, before)            % change; null without a base (missing or 0)
 *   goodWhenDown(change)              true when it fell, false when it rose, null when flat/unknown
 *   share(part, total)                part ÷ total × 100; null when total is 0 or missing
 *   pathwayStatus(actual, pathway)    I6 SBTi rule: on_track ≤ pathway, at_risk ≤ +5 %, off_track
 *   expectedProgress(base, target, today)  I6: straight-line % of the way from the end of the
 *                                     baseline year to the end of the target year, at `today`
 *   targetStatus(progress, expected)  I6: reached ≥ 100; on_track ≥ expected; at_risk behind by
 *                                     ≤ 10 pp; off_track behind by more; no_data without progress
 *   combinedIntensity(sites)          Σ emissions ÷ Σ production over sites with production, and
 *                                     whether their units differ (I7, as Overview's "combined")
 *   readinessOf(pillars)              overall coverage over the three pillars' counts (/kpi/esg's rule)
 *   countAbove(rows, before, limit)   categories whose tCO₂e moved more than limit % on last year
 */
import type { Pillar, TargetStatus } from "../contracts/enums";

/** I6 thresholds. */
export const PATHWAY_AT_RISK_PCT = 5;
export const TARGET_AT_RISK_PP = 10;

export const changePct = (now: number | null | undefined, before: number | null | undefined): number | null =>
  now === null || now === undefined || before === null || before === undefined || before === 0 ? null : ((now - before) / Math.abs(before)) * 100;

export const goodWhenDown = (change: number | null): boolean | null => (change === null || change === 0 ? null : change < 0);

export const share = (part: number | null | undefined, total: number | null | undefined): number | null =>
  part === null || part === undefined || total === null || total === undefined || total === 0 ? null : (part / total) * 100;

export function pathwayStatus(actual: number | null, pathway: number | null): { status: TargetStatus; gap_pct: number | null } {
  if (actual === null || pathway === null || pathway <= 0) return { status: "no_data", gap_pct: null };
  const gap = ((actual - pathway) / pathway) * 100;
  const status: TargetStatus = actual <= pathway ? "on_track" : gap <= PATHWAY_AT_RISK_PCT ? "at_risk" : "off_track";
  return { status, gap_pct: gap };
}

const yearEnd = (y: number) => Date.UTC(y, 11, 31, 23, 59, 59);

/** % of the way (0–100) a straight line from baseline to target has gone at `today` (ISO date). */
export function expectedProgress(baselineYear: number, targetYear: number, today: string): number | null {
  if (!(targetYear > baselineYear)) return null;
  const t = Date.parse(`${today}T00:00:00Z`);
  const pct = ((t - yearEnd(baselineYear)) / (yearEnd(targetYear) - yearEnd(baselineYear))) * 100;
  return Math.min(100, Math.max(0, pct));
}

export function targetStatus(progress: number | null, expected: number | null): TargetStatus {
  if (progress === null) return "no_data";
  if (progress >= 100) return "reached";
  if (expected === null || progress >= expected) return "on_track";
  return expected - progress <= TARGET_AT_RISK_PP ? "at_risk" : "off_track";
}

export function combinedIntensity(sites: Array<{ emissions: number; production: number; units: string[] }>): { value: number | null; unit: string | null; combined: boolean } {
  const withOutput = sites.filter((s) => s.production > 0);
  const units = [...new Set(withOutput.flatMap((s) => s.units))].sort();
  if (!withOutput.length) return { value: null, unit: units[0] ?? null, combined: false };
  const e = withOutput.reduce((a, s) => a + s.emissions, 0);
  const q = withOutput.reduce((a, s) => a + s.production, 0);
  return { value: e / q, unit: units.length === 1 ? units[0] : units.length ? "mixed units" : null, combined: units.length > 1 };
}

/** Overall readiness: approved ÷ (approved + pending + missing) over all pillars, and each pillar's %. */
export function readinessOf(pillars: Array<{ pillar: Pillar; approved: number; pending: number; missing: number }>): { pct: number; by_pillar: Record<Pillar, number | null> } | null {
  const by = {} as Record<Pillar, number | null>;
  let a = 0;
  let counted = 0;
  for (const p of pillars) {
    const c = p.approved + p.pending + p.missing;
    by[p.pillar] = c ? (p.approved / c) * 100 : null;
    a += p.approved;
    counted += c;
  }
  return counted ? { pct: (a / counted) * 100, by_pillar: by } : null;
}

/** How many rows moved by more than `limitPct` % against `before` (matched by `key`). */
export function countAbove<T>(now: T[], before: T[], key: (r: T) => string | number, value: (r: T) => number, limitPct: number): number {
  const prev = new Map(before.map((r) => [key(r), value(r)]));
  let n = 0;
  for (const r of now) {
    const c = changePct(value(r), prev.get(key(r)));
    if (c !== null && Math.abs(c) > limitPct) n++;
  }
  return n;
}

// ── IN-2 (story panels) ──────────────────────────────────────────────────────
//   indexSeries(values, baseIdx)        each value ÷ the base value × 100; null when either is
//                                       missing or the base is 0
//   combinedOutputIndex(perSite, w, b)  I7: each site's output indexed in its own unit, then
//                                       averaged by base-year emission weight over the sites
//                                       that have a value that year (weights renormalised)
//   lastValue(series)                   the last non-null value, or null
//   towardsTarget(base, target, now)    % of the way from baseline to target (100 = reached,
//                                       whichever way is good); null without a span or a figure
//   wallOrder(a, b)                     the target wall's sort: status (worst first), then
//                                       (expected − progress) descending, unknown gaps last

export function indexSeries(values: Array<number | null>, baseIdx: number): Array<number | null> {
  const base = values[baseIdx];
  return values.map((v) => (v === null || v === undefined || base === null || base === undefined || base === 0 ? null : (v / base) * 100));
}

export function combinedOutputIndex(perSite: Array<Array<number | null>>, weights: number[], baseIdx: number): Array<number | null> {
  const indexed = perSite.map((s) => indexSeries(s, baseIdx));
  const len = perSite.reduce((m, s) => Math.max(m, s.length), 0);
  const out: Array<number | null> = [];
  for (let i = 0; i < len; i++) {
    let w = 0;
    let sum = 0;
    indexed.forEach((s, k) => {
      const v = s[i];
      const wk = weights[k] ?? 0;
      if (v === null || v === undefined || !(wk > 0)) return;
      w += wk;
      sum += wk * v;
    });
    out.push(w > 0 ? sum / w : null);
  }
  return out;
}

export const lastValue = (series: Array<number | null>): number | null => {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] !== null && series[i] !== undefined) return series[i];
  return null;
};

export function towardsTarget(baseline: number, target: number, now: number | null): number | null {
  if (now === null || baseline === target) return null;
  return ((now - baseline) / (target - baseline)) * 100 || 0;
}

const STATUS_RANK: Record<TargetStatus, number> = { off_track: 0, at_risk: 1, on_track: 2, reached: 3, no_data: 4 };
export function wallOrder(a: { status: TargetStatus; progress_pct: number | null; expected_pct: number | null; id: string }, b: typeof a): number {
  const s = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (s) return s;
  const gap = (x: typeof a) => (x.progress_pct === null || x.expected_pct === null ? null : x.expected_pct - x.progress_pct);
  const ga = gap(a);
  const gb = gap(b);
  if (ga !== null && gb !== null && ga !== gb) return gb - ga;
  if (ga === null && gb !== null) return 1;
  if (gb === null && ga !== null) return -1;
  return a.id.localeCompare(b.id);
}
