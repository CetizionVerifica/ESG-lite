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
 * Advance widths (em) of value-label characters: the widest of the eight studio faces
 * (render/fonts.ts, @fontsource Latin subsets) measured in Chromium, regular and bold
 * (#209 review). Digits: Fraunces 0.648 / 0.702; ", .": Source Serif 4 0.302 / 0.312;
 * "+ −": Archivo 0.625 / 0.641; "%": Archivo 0.950, IBM Plex Sans bold 0.974; "·": IBM Plex
 * Sans 0.333 / 0.358; space: Noto Sans 0.260. Other characters take the digit width.
 */
const EM_REGULAR = { digit: 0.65, sep: 0.31, sign: 0.63, pct: 0.95, dot: 0.34, space: 0.26 };
const EM_BOLD = { digit: 0.71, sep: 0.32, sign: 0.65, pct: 0.98, dot: 0.36, space: 0.26 };
/** Safety margin on every label width (em): kerning, hinting and rounding never make a label wider than this estimate. */
export const LABEL_MARGIN_EM = 0.1;
/** Glyph box of a label above and below its baseline (em): the tallest digit (Fraunces bold 0.74) and the comma's tail (0.20), rounded up. */
export const LABEL_ASCENT = 0.75;
export const LABEL_DESCENT = 0.21;

/**
 * A value label's width in viewBox units, on the wide side (#209 review): every studio
 * face fits inside it, bold too (`bold` for weight 700). Numeric labels only in practice:
 * digits, separators, signs, "%", "·".
 */
export const labelWidth = (s: string, size = SMALL, bold = false): number => {
  const m = bold ? EM_BOLD : EM_REGULAR;
  let em = LABEL_MARGIN_EM;
  for (const c of s) em += c === "," || c === "." ? m.sep : c === "·" ? m.dot : c === "%" ? m.pct : c === "+" || c === "−" || c === "-" ? m.sign : /\s/.test(c) ? m.space : m.digit;
  return em * size;
};

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
 * x for a label centred on `x` that keeps it inside the chart's 0..w: a long
 * value over the first or last band (a 3-decimal tCO₂e figure, #209) would
 * otherwise be cut at the SVG edge. Bold-aware (#209 review). A label that
 * fits stays where it was.
 */
export const insideX = (x: number, s: string, w: number, size = SMALL, bold = false): number => {
  const half = labelWidth(s, size, bold) / 2;
  return half * 2 >= w ? w / 2 : Math.min(Math.max(x, half), w - half);
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
/** Where a row label is drawn (null: left out), its font size, and the extra room the chart reserves at its top. */
export interface LabelFit {
  extraTop: number;
  size: number;
  labels: ({ x: number; y: number } | null)[];
}

/** Air between two labels (em). */
const LABEL_GAP = 0.15;
/** The room a staggered row reserves at its top (em): one label's height and its air. */
export const LABEL_LIFT = LABEL_ASCENT + LABEL_DESCENT + LABEL_GAP + 0.04;
/** The label font steps a row may take: as drawn, then one step smaller. */
export const LABEL_STEPS = [1, 0.85];

/**
 * Places one row of centred value labels (bar totals, waterfall steps, target bars,
 * gas columns, line end points) so that no two meet and each stays inside the chart
 * (#209 review: 3-decimal tCO₂e labels are wider than their bands). Tried in order, the
 * first that fits wins:
 *   1. as drawn, each moved inside 0..w by its (bold-aware) width;
 *   2. with one line reserved at the top: left to right, a label that would meet one
 *      already placed goes up just above it, so neighbours stagger;
 *   3. and 4. the same a font step smaller;
 *   5. at that step and stagger, a label that still meets one is left out (bold, then
 *      `priority`, then left to right keep their place first). Never an overlap.
 * `make(extraTop, size)` builds the row for a plot whose top is `extraTop` lower (the
 * chart's own geometry, so a staggered row takes room from the bars, not from the page);
 * the chart draws with the returned `extraTop` and `size`. `minY` is the top labels may
 * reach (a headline above the plot).
 */
export function fitLabelRow(make: (extraTop: number, size: number) => RowLabel[], w: number, h: number, minY = 0, size0 = SMALL): LabelFit {
  const attempt = (size: number, stagger: boolean, drop: boolean): LabelFit | null => {
    const extraTop = stagger ? LABEL_LIFT * size : 0;
    const row = make(extraTop, size);
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
      if (labelWidth(l.text, size, l.bold) <= w) {
        const x = insideX(l.x, l.text, w, size, l.bold);
        let y = Math.min(Math.max(l.y, top), bottom);
        for (let tries = 0; tries < 4 && y >= top; tries++) {
          const box = labelBox(x, y, l.text, size, { anchor: "middle", bold: l.bold });
          const hits = placed.filter((p) => boxesMeet(p, box, gap));
          if (!hits.length) {
            spot = { x, y, box };
            break;
          }
          if (!stagger) break;
          // Stagger: just above the labels it would meet.
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
  for (const size of steps) for (const stagger of [false, true]) {
    const fit = attempt(size, stagger, false);
    if (fit) return fit;
  }
  return attempt(steps[steps.length - 1], true, true) as LabelFit;
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
