/**
 * DS-2 (RS-2 `derived.ts`) · the only place derived figures are computed:
 * change vs prior or base, share of a total, progress from a baseline to a
 * target, and intensity. DS-8 charts, DS-9 prompts and DS-12 checks import
 * these instead of dividing on their own.
 *
 * Nothing here rounds (format.ts does, once). A missing input or a zero
 * denominator gives `{value: null, reason}`, never 0 or Infinity.
 */
export type DerivedReason = "MISSING_INPUT" | "DIVIDE_BY_ZERO";
export interface Derived {
  value: number | null;
  reason?: DerivedReason;
}

const ok = (value: number): Derived => ({ value: Number(value.toPrecision(12)) });
const missing = (...xs: Array<number | null | undefined>) => xs.some((x) => x === null || x === undefined || !Number.isFinite(x));

/** current − previous. */
export function changeAbs(current: number | null | undefined, previous: number | null | undefined): Derived {
  if (missing(current, previous)) return { value: null, reason: "MISSING_INPUT" };
  return ok((current as number) - (previous as number));
}

/** (current − previous) / |previous| × 100. */
export function changePct(current: number | null | undefined, previous: number | null | undefined): Derived {
  if (missing(current, previous)) return { value: null, reason: "MISSING_INPUT" };
  if (previous === 0) return { value: null, reason: "DIVIDE_BY_ZERO" };
  return ok((((current as number) - (previous as number)) / Math.abs(previous as number)) * 100);
}

/** part / whole × 100 (a site's share of the total, a category's share of Scope 3). */
export function share(part: number | null | undefined, whole: number | null | undefined): Derived {
  if (missing(part, whole)) return { value: null, reason: "MISSING_INPUT" };
  if (whole === 0) return { value: null, reason: "DIVIDE_BY_ZERO" };
  return ok(((part as number) / (whole as number)) * 100);
}

/** How far from baseline to target, in % (0 at the baseline, 100 at the target). Same rule as KPI-9 progress.ts. */
export function progressPct(current: number | null | undefined, baseline: number | null | undefined, target: number | null | undefined): Derived {
  if (missing(current, baseline) || missing(target)) return { value: null, reason: "MISSING_INPUT" };
  const span = (target as number) - (baseline as number);
  if (span === 0) return { value: null, reason: "DIVIDE_BY_ZERO" };
  return ok((((current as number) - (baseline as number)) / span) * 100);
}

/** numerator / denominator (tCO₂e per revenue, per unit of output, per employee). */
export function intensity(numerator: number | null | undefined, denominator: number | null | undefined): Derived {
  if (missing(numerator, denominator)) return { value: null, reason: "MISSING_INPUT" };
  if (denominator === 0) return { value: null, reason: "DIVIDE_BY_ZERO" };
  return ok((numerator as number) / (denominator as number));
}

/** Each point's share of the sum of the points (per-site share, per-category share). */
export function shares(points: Array<{ key: string; value: number | null }>): Array<{ key: string; value: number | null }> {
  const total = points.reduce((a, p) => a + (p.value ?? 0), 0);
  return points.map((p) => ({ key: p.key, value: share(p.value, total).value }));
}
