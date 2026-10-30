/**
 * DS-1 · shared SVG pieces for charts. Units: a chart's viewBox is its frame
 * in quarter-millimetres (U = 4 per mm), so text sizes are physical.
 */
import type { Theme } from "../theme";
import type { RenderSeries, RenderValue } from "../types";
import { esc, n3 } from "../util";
import { TEXT_MARGIN_EM, textWidth } from "./metrics";

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

/** Safety margin on every label width (em): kerning, hinting and rounding never make a label wider than this estimate. */
export const LABEL_MARGIN_EM = TEXT_MARGIN_EM;
/** Glyph box of a label above and below its baseline (em): the tallest digit (Fraunces bold 0.74) and the comma's tail (0.20), rounded up. */
export const LABEL_ASCENT = 0.75;
export const LABEL_DESCENT = 0.21;

/**
 * A label's width in viewBox units, on the wide side (#209 review): every studio face fits
 * inside it, bold too (`bold` for weight 700). Measured per character (metrics.ts).
 */
export const labelWidth = (s: string, size = SMALL, bold = false): number => textWidth(s, size, bold);

/** A label's estimated box in viewBox units. */
export interface LabelBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The box of a label drawn at x, y with `anchor` and `baseline` (alphabetic, or "middle"). */
export const labelBox = (x: number, y: number, s: string, size = SMALL, opts: { anchor?: "start" | "middle" | "end"; bold?: boolean; baseline?: string } = {}): LabelBox => {
  const lw = labelWidth(s, size, opts.bold);
  const x0 = opts.anchor === "middle" ? x - lw / 2 : opts.anchor === "end" ? x - lw : x;
  const mid = opts.baseline === "middle" || opts.baseline === "central";
  return { x0, x1: x0 + lw, y0: mid ? y - size / 2 : y - LABEL_ASCENT * size, y1: mid ? y + size / 2 : y + LABEL_DESCENT * size };
};

/** Whether two label boxes meet (touching counts, with `gap` of air around them). */
export const boxesMeet = (a: LabelBox, b: LabelBox, gap = 0): boolean => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/**
 * x for a label centred on `x` that keeps it inside `x0..w` (the chart, or its plot): a long
 * value over the first or last band (a 3-decimal tCO₂e figure, #209) would otherwise be cut
 * at the SVG edge or run into the axis. Bold-aware (#209 review). A label that fits stays
 * where it was.
 */
export const insideX = (x: number, s: string, w: number, size = SMALL, bold = false, x0 = 0): number => {
  const half = labelWidth(s, size, bold) / 2;
  return half * 2 >= w - x0 ? (x0 + w) / 2 : Math.min(Math.max(x, x0 + half), w - half);
};

/**
 * The plot width that keeps value labels drawn after horizontal bar ends
 * (at x0 + t·pw + gap, t the bar's end on the scale) inside the chart: `pw`
 * itself when they fit, else just narrow enough, never below 60 % of `pw`.
 */
export const fitBarEnds = (pw: number, x0: number, w: number, ends: { t: number; label: string; bold?: boolean }[], gap = SMALL * 0.4): number => {
  let fit = pw;
  for (const e of ends) if (e.t > 0) fit = Math.min(fit, (w - x0 - gap - labelWidth(e.label, SMALL, e.bold)) / e.t);
  return Math.max(pw * 0.6, fit);
};

/** A value label a chart wants centred over its mark: x, baseline y, text; bold labels and higher priority are kept first. */
export interface RowLabel {
  x: number;
  y: number;
  text: string;
  bold?: boolean;
  priority?: number;
}
/**
 * Something a row label may not meet (#209 review): a bar, a tick label, a target's words. A bar
 * names the label it carries (`owner`, the label's index in the row); that label may sit on it.
 */
export interface Obstacle extends LabelBox {
  owner?: number;
}
/** What a chart hands fitLabelRow for a plot whose top is `extraTop` lower: its labels and their obstacles. */
export interface LabelRow {
  labels: RowLabel[];
  obstacles?: Obstacle[];
}
/** Where a row label is drawn (null: left out), its font size, and the extra room the chart reserves at its top. */
export interface LabelFit {
  extraTop: number;
  size: number;
  labels: ({ x: number; y: number } | null)[];
}

/** Air between a label and anything it keeps clear of (em). */
const LABEL_GAP = 0.15;
/** The room a staggered row reserves at its top (em): one label's height and its air. */
export const LABEL_LIFT = LABEL_ASCENT + LABEL_DESCENT + LABEL_GAP + 0.04;
/** The label font steps a row may take, down to 80 % (6.5 pt labels: 5.2 pt at the smallest). */
export const LABEL_STEPS = [1, 0.95, 0.9, 0.85, 0.8];
/** How far a staggered label may rise above its mark (em): two lines, so it still reads as its mark's. */
const MAX_RISE = 2 * LABEL_LIFT;

/** A bar's rect as an obstacle box. */
export const rectBox = (x: number, y: number, w: number, h: number, owner?: number): Obstacle => ({ x0: x, x1: x + Math.max(0, w), y0: y, y1: y + Math.max(0, h), owner });

/**
 * Places one row of centred value labels (bar totals, waterfall steps, target bars, gas
 * columns, line end points) so that no two meet, none meets an obstacle (a tick label, a
 * bar other than its own, a target's words) and each stays inside the plot, x0..w (#209
 * review: 3-decimal tCO₂e labels are wider than their bands). Tried in order, the first
 * that fits wins:
 *   1. as drawn, at each font step (LABEL_STEPS, down to 80 %), each label moved inside
 *      x0..w by its (bold-aware) width;
 *   2. staggered, at each font step: one line is reserved at the top of the plot and,
 *      left to right, a label that would meet a label or obstacle goes up just above it
 *      (at most two lines above its mark);
 *   3. at the smallest step and staggered, a label that still meets something is left out
 *      (bold, then `priority`, then left to right keep their place first). Never an overlap.
 * `make(extraTop, size)` builds the row for a plot whose top is `extraTop` lower (the
 * chart's own geometry, so a staggered row takes room from the bars, not from the page);
 * the chart draws with the returned `extraTop` and `size`. `minY` is the top labels may
 * reach (a headline above the plot).
 */
export function fitLabelRow(make: (extraTop: number, size: number) => LabelRow, w: number, h: number, opts: { x0?: number; minY?: number; size0?: number } = {}): LabelFit {
  const x0 = opts.x0 ?? 0;
  const minY = opts.minY ?? 0;
  const size0 = opts.size0 ?? SMALL;
  const attempt = (size: number, stagger: boolean, drop: boolean): LabelFit | null => {
    const extraTop = stagger ? LABEL_LIFT * size : 0;
    const { labels: row, obstacles = [] } = make(extraTop, size);
    const order = row.map((_, i) => i);
    if (drop) order.sort((a, b) => Number(!!row[b].bold) - Number(!!row[a].bold) || (row[b].priority ?? 0) - (row[a].priority ?? 0) || row[a].x - row[b].x || a - b);
    else order.sort((a, b) => row[a].x - row[b].x || a - b);
    const placed: LabelBox[] = [];
    const out: ({ x: number; y: number } | null)[] = row.map(() => null);
    const top = minY + LABEL_ASCENT * size;
    const bottom = h - LABEL_DESCENT * size;
    const gap = LABEL_GAP * size;
    for (const i of order) {
      const l = row[i];
      let spot: { x: number; y: number; box: LabelBox } | null = null;
      if (labelWidth(l.text, size, l.bold) <= w - x0) {
        const x = insideX(l.x, l.text, w, size, l.bold, x0);
        const y0 = Math.min(Math.max(l.y, top), bottom);
        let y = y0;
        for (let tries = 0; tries < 6 && y >= top && y0 - y <= MAX_RISE * size; tries++) {
          const box = labelBox(x, y, l.text, size, { anchor: "middle", bold: l.bold });
          const hits: LabelBox[] = [...placed.filter((p) => boxesMeet(p, box, gap)), ...obstacles.filter((o) => o.owner !== i && boxesMeet(o, box, gap))];
          if (!hits.length) {
            spot = { x, y, box };
            break;
          }
          if (!stagger) break;
          // Stagger: just above what it would meet.
          y = Math.min(...hits.map((p) => p.y0)) - gap - LABEL_DESCENT * size - 1e-6;
        }
      }
      if (!spot) {
        if (drop) continue;
        return null;
      }
      placed.push(spot.box);
      out[i] = { x: spot.x, y: spot.y };
    }
    return { extraTop, size, labels: out };
  };
  const steps = LABEL_STEPS.map((k) => size0 * k);
  for (const stagger of [false, true])
    for (const size of steps) {
      const fit = attempt(size, stagger, false);
      if (fit) return fit;
    }
  return attempt(steps[steps.length - 1], true, true) as LabelFit;
}

/**
 * The first of `layouts` (each a list of lines, best first) whose every line fits `w` at one of
 * `sizes` (largest first), measured (metrics.ts); when none does, the last layout at the size
 * that makes its widest line fit, so a figure is made smaller, never cut (#209 review).
 */
export function fitLines(layouts: string[][], w: number, sizes: number[], bold = false): { lines: string[]; size: number } {
  for (const lines of layouts) {
    const size = sizes.find((sz) => lines.every((l) => textWidth(l, sz, bold) <= w));
    if (size !== undefined) return { lines, size };
  }
  const lines = layouts[layouts.length - 1];
  return { lines, size: Math.min(sizes[sizes.length - 1], w / Math.max(...lines.map((l) => textWidth(l, 1, bold)))) };
}

/** Words of `s` on as few lines as fit `w` at `size` (a word wider than `w` keeps a line of its own). */
export function wrapWords(s: string, w: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && textWidth(`${last} ${word}`, size, bold) <= w) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

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
