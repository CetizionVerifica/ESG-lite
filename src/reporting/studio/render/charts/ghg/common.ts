/**
 * DS-8 · shared pieces of the GHG chart kinds.
 *
 * Series shape (DS-2 sources/ghg.ts): a binding with a breakdown resolves to
 * one series per year (label = the year, ascending), keyed by the breakdown
 * (scope, category, site, gas, month); a binding without a breakdown and with
 * several years resolves to one series keyed by year. The current year is the
 * last series. `stacks` (months by scope) is an optional DS-8 addition.
 *
 * Labelling (RS research §2): every kind prints the total from the server's
 * `display` and labels only the biggest parts; the rest sit in the legend or
 * the axis. Value labels on marks are chart labels (format.ts), never a
 * reported headline figure.
 */
import { formatNumber } from "../../format";
import type { Theme } from "../../theme";
import type { RenderSeries, RenderValue } from "../../types";
import { textWidth } from "../metrics";
import { FONT, SMALL, rect, seriesColor, text, type ChartInput } from "../svg";

export interface Part {
  key: string;
  value: number;
}

/** The current year's series (the last one), or null. */
export const currentSeries = (v: RenderValue): RenderSeries | null => {
  const s = v.series ?? [];
  return s.length ? s[s.length - 1] : null;
};

/** The year before the current one, when the binding asked for several years. */
export const priorSeries = (v: RenderValue): RenderSeries | null => {
  const s = v.series ?? [];
  return s.length > 1 ? s[s.length - 2] : null;
};

/** Points with a value, in the source's order. */
export const partsOf = (s: RenderSeries | null): Part[] => (s ? s.values.filter((p) => p.value !== null).map((p) => ({ key: p.key, value: p.value as number })) : []);

/** Largest first; "Other" (the top-n fold) always last. */
export const ranked = (ps: Part[]): Part[] => {
  const other = ps.filter((p) => p.key === "Other");
  return [...ps.filter((p) => p.key !== "Other")].sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1)).concat(other);
};

/** Indexes of the `n` biggest positive parts (the ones that get a label). */
export const biggest = (ps: Part[], n = 3): Set<number> =>
  new Set(
    ps
      .map((p, i) => ({ i, v: p.value }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v || a.i - b.i)
      .slice(0, n)
      .map((x) => x.i),
  );

/** Colour of part i: scope colours for Scope 1/2/3 labels unless the chart asks for brand series. */
export const partColor = (input: Pick<ChartInput, "theme" | "options">, label: string, i: number): string =>
  input.options.colors === "brand" ? input.theme.series[i % input.theme.series.length] : seriesColor(input.theme, label, i);

export const pct = (x: number): string => `${formatNumber(x * 100, x * 100 < 10 ? "1dp" : "int")}%`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2025-01" → "Jan"; anything else as is. */
export const shortKey = (k: string): string => {
  const m = /^\d{4}-(\d{2})$/.exec(k);
  return m ? (MONTHS[Number(m[1]) - 1] ?? k) : k;
};

/** Shortens a label to about `chars` characters with an ellipsis. */
export const clip = (s: string, chars: number): string => (s.length > chars ? `${s.slice(0, Math.max(1, chars - 1))}…` : s);

/** Font steps the total line may take to fit the chart's width: 7.5 pt down to 6.4 pt. */
export const HEADLINE_STEPS = [1, 0.95, 0.9, 0.85];

/**
 * The total line along the top: "Total 12,480.000 tCO₂e" from the server's display
 * (never re-formatted). Returns the svg and the height it takes. #209 review: it fits the
 * chart's width `w` (measured, metrics.ts): one line, a font step smaller if needed; else
 * the figure and unit on a second line ("Total" / "12,480.000 tCO₂e"); else the unit on a
 * third. A line it adds costs the plot under it 1.2 lines of height, so a chart passes
 * `maxH`, the most the total line may take while its plot keeps the room it needs (#209
 * round 4): a layout of more lines than that is never chosen, and the one line is made
 * smaller instead. One line never takes more than production's (FONT × 1.6), so the plot is
 * never shorter than production's for the total line's sake. A figure is made smaller, never
 * cut. `steps` lets a chart short of height ask for the smaller sizes only (scope_split).
 */
export function headline(v: RenderValue, theme: Theme, label = "Total", w = Infinity, opts: { steps?: number[]; maxH?: number } = {}): { svg: string; h: number } {
  if (!v.display) return { svg: "", h: 0 };
  const unit = v.unit ? ` ${v.unit}` : "";
  const maxH = opts.maxH ?? Infinity;
  const sizes = (opts.steps ?? HEADLINE_STEPS).map((k) => FONT * k);
  const height = (lines: string[], size: number) => size * 1.6 + (lines.length - 1) * size * 1.2;
  const one = [`${label} ${v.display}${unit}`];
  const layouts = [one, [label, `${v.display}${unit}`], ...(v.unit ? [[label, v.display, v.unit]] : [])];
  const widest = (lines: string[], size: number) => Math.max(...lines.map((l) => textWidth(l, size, true)));
  let pick: { lines: string[]; size: number } | null = null;
  for (const lines of layouts) {
    const size = sizes.find((sz) => widest(lines, sz) <= w && (lines.length === 1 || height(lines, sz) <= maxH));
    if (size !== undefined) {
      pick = { lines, size };
      break;
    }
  }
  if (!pick) {
    // Nothing fits at the steps: the layout with the largest type that fits the width (each made smaller to fit) and,
    // past one line, the height the chart can spare; one line when nothing else does.
    const last = sizes[sizes.length - 1];
    const shrunk = layouts.map((lines) => ({ lines, size: Math.min(last, w / widest(lines, 1)) }));
    pick = shrunk.filter((c, i) => i === 0 || height(c.lines, c.size) <= maxH).reduce((a, b) => (b.size > a.size + 1e-9 ? b : a));
  }
  const { lines, size } = pick;
  const lh = size * 1.2;
  return {
    svg: lines.map((l, i) => text(0, size + i * lh, l, theme.colors.ink, { size, weight: 700 })).join(""),
    h: height(lines, size),
  };
}

/** A small legend that wraps onto as many lines as it needs; returns svg and height. */
export function wrapLegend(items: { label: string; color: string }[], w: number, y0: number, theme: Theme): { svg: string; h: number } {
  if (!items.length) return { svg: "", h: 0 };
  let x = 0;
  let line = 0;
  let out = "";
  const lh = SMALL * 1.5;
  for (const it of items) {
    const width = SMALL * 1.4 + it.label.length * SMALL * 0.55 + SMALL * 1.2;
    if (x > 0 && x + width > w) {
      x = 0;
      line += 1;
    }
    const y = y0 + line * lh + SMALL;
    out += rect(x, y - SMALL * 0.8, SMALL * 0.8, SMALL * 0.8, it.color);
    out += text(x + SMALL * 1.2, y, it.label, theme.colors.muted, { size: SMALL });
    x += width;
  }
  return { svg: out, h: (line + 1) * lh + SMALL * 0.4 };
}

/** The sum of a series' values (chart geometry and shares only). */
export const total = (ps: Part[]): number => ps.reduce((a, p) => a + p.value, 0);
