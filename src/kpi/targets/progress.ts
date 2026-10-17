/**
 * KPI-9 · progress towards a target (pure).
 *
 *   progress(target, points)   points = approved annual figures [{year, value}]
 *     current        the latest approved figure after the baseline year (none → status no_data)
 *     progress_pct   how far from the baseline to the target, in % (0 at the baseline, 100 at the
 *                    target; below 0 means moving the wrong way, above 100 beyond the target).
 *                    Null for `maintain` and without a current figure.
 *     expected       the figure a straight line from baseline to target gives for the current year
 *     on_track       reduce: current ≤ expected; increase: current ≥ expected; maintain: within
 *                    ±MAINTAIN_TOLERANCE_PCT of the baseline
 *     status         on_track | behind | no_data
 *     achieved       the target is met (reduce: ≤ target; increase: ≥ target; maintain: on track)
 */
import type { TargetDirection } from "../contracts/enums";

export const MAINTAIN_TOLERANCE_PCT = 5;

export interface TargetLike {
  baseline_year: number;
  baseline_value: number;
  target_year: number;
  target_value: number;
  direction: TargetDirection;
}

export interface Progress {
  current_value: number | null;
  current_year: number | null;
  progress_pct: number | null;
  expected_value: number | null;
  change_pct: number | null;
  on_track: boolean | null;
  achieved: boolean;
  status: "on_track" | "behind" | "no_data";
}

const r = (n: number, d: number) => Number(n.toFixed(d));
const EPS = 1e-9;

/** The value on the straight line from baseline to target in `year` (held at the target after it). */
export const expectedAt = (t: TargetLike, year: number): number => {
  const share = Math.min(1, Math.max(0, (year - t.baseline_year) / (t.target_year - t.baseline_year)));
  return t.baseline_value + (t.target_value - t.baseline_value) * share;
};

export function progress(t: TargetLike, points: Array<{ year: number; value: number | null }>): Progress {
  const after = points.filter((p) => p.year > t.baseline_year && p.value !== null).sort((a, b) => a.year - b.year);
  const latest = after[after.length - 1];
  if (!latest) return { current_value: null, current_year: null, progress_pct: null, expected_value: null, change_pct: null, on_track: null, achieved: false, status: "no_data" };
  const current = latest.value as number;
  const expected = expectedAt(t, latest.year);
  const span = t.target_value - t.baseline_value;
  const change_pct = t.baseline_value === 0 ? null : r(((current - t.baseline_value) / Math.abs(t.baseline_value)) * 100, 1);
  let on_track: boolean;
  let achieved: boolean;
  let pct: number | null = null;
  if (t.direction === "maintain") {
    const band = (Math.abs(t.baseline_value) * MAINTAIN_TOLERANCE_PCT) / 100;
    on_track = Math.abs(current - t.baseline_value) <= band + EPS;
    achieved = on_track;
  } else {
    pct = span === 0 ? null : r(((current - t.baseline_value) / span) * 100, 1);
    on_track = t.direction === "reduce" ? current <= expected + EPS : current >= expected - EPS;
    achieved = t.direction === "reduce" ? current <= t.target_value + EPS : current >= t.target_value - EPS;
  }
  return {
    current_value: current,
    current_year: latest.year,
    progress_pct: pct,
    expected_value: Number(expected.toPrecision(12)),
    change_pct,
    on_track,
    achieved,
    status: on_track ? "on_track" : "behind",
  };
}
