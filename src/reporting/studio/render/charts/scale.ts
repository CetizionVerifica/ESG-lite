/**
 * DS-1 · chart scales: nice ticks, and value axes that start at zero for bars
 * (no truncated axes, research.md §2).
 */

const niceStep = (raw: number): number => {
  if (raw <= 0 || !Number.isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
};

export interface Scale {
  min: number;
  max: number;
  ticks: number[];
  /** Maps a value to 0..1 along the axis. */
  t: (v: number) => number;
}

/** A linear scale with about `count` nice ticks covering [lo, hi]; `zero` forces 0 into the domain. */
export function linearScale(lo: number, hi: number, count = 5, zero = true): Scale {
  let a = Number.isFinite(lo) ? lo : 0;
  let b = Number.isFinite(hi) ? hi : 1;
  if (zero) {
    a = Math.min(0, a);
    b = Math.max(0, b);
  }
  if (a === b) b = a + 1;
  const step = niceStep((b - a) / Math.max(1, count));
  const min = Math.floor(a / step) * step;
  const max = Math.ceil(b / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { min, max, ticks, t: (v: number) => (v - min) / (max - min || 1) };
}
