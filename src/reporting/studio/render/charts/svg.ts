/**
 * DS-1 · shared SVG pieces for charts. Units: a chart's viewBox is its frame
 * in quarter-millimetres (U = 4 per mm), so text sizes are physical.
 */
import type { Theme } from "../theme";
import type { RenderSeries, RenderValue } from "../types";
import { esc, n3 } from "../util";

export const U = 4;
/** 7.5 pt in viewBox units (1 pt = 0.3528 mm). */
export const FONT = 7.5 * 0.3528 * U;
export const SMALL = 6.5 * 0.3528 * U;

/**
 * Chart options (01-contracts §2 chart props). DS-8 adds: `colors` (scope
 * colours, the default, or the brand series), `showLegend`, `variant`
 * (scope_split: 100 % bar or donut) and `basisNote` (scope_split's Scope 2
 * basis line).
 */
export interface ChartOptions {
  greyPrior?: boolean;
  showValues?: boolean;
  horizontal?: boolean;
  stacked?: boolean;
  showTarget?: boolean;
  colors?: "scope" | "brand";
  showLegend?: boolean;
  variant?: "bar" | "donut";
  basisNote?: boolean;
}

export interface ChartInput {
  value: RenderValue;
  /** Plot box in viewBox units. */
  w: number;
  h: number;
  theme: Theme;
  options: ChartOptions;
  /** Accessible label stating the takeaway. */
  label: string;
}

export type ChartRenderer = (input: ChartInput) => string;

export const svgOpen = (w: number, h: number, label: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n3(w)} ${n3(h)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(label)}">`;

export const text = (x: number, y: number, s: string, fill: string, opts: { size?: number; anchor?: "start" | "middle" | "end"; weight?: number; baseline?: string } = {}): string =>
  `<text x="${n3(x)}" y="${n3(y)}" font-size="${n3(opts.size ?? FONT)}" fill="${fill}" text-anchor="${opts.anchor ?? "start"}"${opts.weight ? ` font-weight="${opts.weight}"` : ""}${opts.baseline ? ` dominant-baseline="${opts.baseline}"` : ""}>${esc(s)}</text>`;

export const rect = (x: number, y: number, w: number, h: number, fill: string, extra = ""): string =>
  `<rect x="${n3(x)}" y="${n3(y)}" width="${n3(Math.max(0, w))}" height="${n3(Math.max(0, h))}" fill="${fill}"${extra}/>`;

/**
 * A value label's width in viewBox units, on the wide side: digits and other
 * characters 0.6 em, separators (". , · space") 0.3 em, "%" 0.9 em.
 */
export const labelWidth = (s: string, size = SMALL): number => {
  let em = 0;
  for (const c of s) em += /[.,·\s]/.test(c) ? 0.3 : c === "%" ? 0.9 : 0.6;
  return em * size;
};

/**
 * x for a label centred on `x` that keeps it inside the chart's 0..w: a long
 * value over the first or last band (a 3-decimal tCO₂e figure, #209) would
 * otherwise be cut at the SVG edge. A label that fits stays where it was.
 */
export const insideX = (x: number, s: string, w: number, size = SMALL): number => {
  const half = labelWidth(s, size) / 2;
  return half * 2 >= w ? w / 2 : Math.min(Math.max(x, half), w - half);
};

/**
 * The plot width that keeps value labels drawn after horizontal bar ends
 * (at x0 + t·pw + gap, t the bar's end on the scale) inside the chart: `pw`
 * itself when they fit, else just narrow enough, never below 60 % of `pw`.
 */
export const fitBarEnds = (pw: number, x0: number, w: number, ends: { t: number; label: string }[], gap = SMALL * 0.4): number => {
  let fit = pw;
  for (const e of ends) if (e.t > 0) fit = Math.min(fit, (w - x0 - gap - labelWidth(e.label)) / e.t);
  return Math.max(pw * 0.6, fit);
};

/** Category keys in first-seen order across every series. */
export const keysOf = (series: RenderSeries[]): string[] => {
  const seen: string[] = [];
  for (const s of series) for (const v of s.values) if (!seen.includes(v.key)) seen.push(v.key);
  return seen;
};
export const valueAt = (s: RenderSeries, key: string): number | null => s.values.find((v) => v.key === key)?.value ?? null;

/** Series colour i: brand series first; Scope 1/2/3 labels get the scope colours. */
export const seriesColor = (theme: Theme, label: string, i: number): string => {
  const l = label.toLowerCase();
  if (/^scope\s*1\b/.test(l)) return theme.colors.s1;
  if (/^scope\s*2\b/.test(l)) return theme.colors.s2;
  if (/^scope\s*3\b/.test(l)) return theme.colors.s3;
  return theme.series[i % theme.series.length];
};

/** A year-like key ("2025", "FY2025", "2025-26"). */
export const isYearKey = (k: string): boolean => /^(FY\s?)?\d{4}(-\d{2,4})?$/.test(k);

/** A one-line legend along the bottom. Returns svg and its height. */
export function legend(items: { label: string; color: string }[], w: number, y: number, theme: Theme): string {
  if (items.length < 2) return "";
  let x = 0;
  let out = "";
  for (const it of items) {
    const width = 3 * U + it.label.length * SMALL * 0.55 + 4 * U;
    if (x + width > w) break;
    out += rect(x, y - SMALL * 0.8, SMALL * 0.8, SMALL * 0.8, it.color) + text(x + SMALL * 1.2, y, it.label, theme.colors.muted, { size: SMALL });
    x += width;
  }
  return out;
}

/** "Not reported" / "No data" box inside a chart frame. */
export const emptyChart = (w: number, h: number, msg: string, theme: Theme): string =>
  `${svgOpen(w, h, msg)}${rect(0, 0, w, h, theme.colors.surface)}${text(w / 2, h / 2, msg, theme.colors.muted, { anchor: "middle", baseline: "middle" })}</svg>`;
