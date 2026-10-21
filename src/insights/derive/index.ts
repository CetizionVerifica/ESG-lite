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
