/**
 * DS-8 · `scope_split`: Scope 1, 2 and 3 of the current year as a 100 % bar
 * (default) or a donut (`options.variant: 'donut'`). The total comes from the
 * server's display; each segment shows its share; the legend names the scope
 * and its tCO₂e. `options.basisNote` (default on) adds "Scope 2:
 * location-based" (market-based isn't recorded, D7).
 * Binding: ghg · metric total · breakdown scope.
 */
import { formatNumber, seriesUnit } from "../../format";
import type { Theme } from "../../theme";
import { esc, n3 } from "../../util";
import { donutCentre, ringLabels, ringRadius, underDonut } from "../donut";
import { textWidth } from "../metrics";
import { FONT, SMALL, emptyChart, rect, svgOpen, text, wrapWords, type ChartInput } from "../svg";
import { HEADLINE_STEPS, biggest, currentSeries, headline, partColor, partsOf, pct, total } from "./common";

export const SCOPE2_BASIS_NOTE = "Scope 2: location-based. Market-based isn't recorded.";
/** The note's first sentence: what a frame too small for the whole note keeps (a last resort, #209 review). */
export const SCOPE2_BASIS_NOTE_SHORT = "Scope 2: location-based.";
/** Steps the legend and note text may take before anything is left out: 6.5 pt down to 5.2 pt. */
export const SMALL_TEXT_STEPS = [1, 0.95, 0.9, 0.85, 0.8];

type Item = { label: string; color: string };

/** The note's lines at `size` in `w`: one line; else a line per sentence; else wrapped words; null when a line still doesn't fit. */
export function noteLines(note: string, w: number, size: number): string[] | null {
  const fits = (lines: string[]) => lines.every((l) => textWidth(l, size) <= w);
  if (fits([note])) return [note];
  const sentences = (note.match(/[^.]+\.(?=\s|$)/g) ?? [note]).map((x) => x.trim());
  if (sentences.length > 1 && fits(sentences)) return sentences;
  const words = wrapWords(note, w, size);
  return fits(words) ? words : null;
}

/**
 * Text metrics of the legend and note blocks (em): a swatch's top and the tallest glyph above the baseline, the
 * deepest glyph under it (the eight studio faces measured in Chromium: ascent 0.79, descent 0.25 with "g", "j"),
 * the row and line pitch, and the air between blocks.
 */
const SWATCH = 0.8;
const ASCENT = 0.8;
const DEPTH = 0.26;
const PITCH = 1.25;
const AIR = 0.3;
/** Air between legend items (em, after the measured, generous text width). */
const ITEM_GAP = 0.9;

/** A legend laid out on rows that fit `w` at `size`, measured (metrics.ts); null when one item alone is wider than `w`. `h`: its swatch tops to its last glyph's foot. */
function legendRows(items: Item[], w: number, size: number): { rows: (Item & { x: number })[][]; h: number; size: number } | null {
  const rows: (Item & { x: number })[][] = [];
  let x = 0;
  for (const it of items) {
    const iw = size * 1.2 + textWidth(it.label, size);
    if (iw > w) return null;
    if (!rows.length || (x > 0 && x + iw > w)) {
      rows.push([]);
      x = 0;
    }
    rows[rows.length - 1].push({ ...it, x });
    x += iw + size * ITEM_GAP;
  }
  return { rows, h: rows.length ? (SWATCH + (rows.length - 1) * PITCH + DEPTH) * size : 0, size };
}

/** A note block's height: its first line's ascent to its last line's foot. */
const noteHeight = (lines: string[], size: number): number => (lines.length ? (ASCENT + (lines.length - 1) * PITCH + DEPTH) * size : 0);

const drawLegend = (lg: { rows: (Item & { x: number })[][]; size: number }, y0: number, theme: Theme): string =>
  lg.rows
    .map((row, li) =>
      row
        .map((it) => {
          const y = y0 + (SWATCH + li * PITCH) * lg.size;
          return rect(it.x, y - lg.size * SWATCH, lg.size * SWATCH, lg.size * SWATCH, it.color) + text(it.x + lg.size * 1.2, y, it.label, theme.colors.muted, { size: lg.size });
        })
        .join(""),
    )
    .join("");

/** The note's lines from the block's top `y0`. */
const drawNote = (lines: string[], y0: number, size: number, theme: Theme): string => lines.map((l, i) => text(0, y0 + (ASCENT + i * PITCH) * size, l, theme.colors.muted, { size })).join("");

export function scopeSplitChart(input: ChartInput): string {
  const { value, w, h, theme, options } = input;
  const cur = currentSeries(value);
  const ps = partsOf(cur).filter((p) => p.value > 0);
  const sum = total(ps);
  if (!ps.length || sum <= 0) return emptyChart(w, h, "No data", theme);
  const colors = ps.map((p, i) => partColor(input, p.key, i));
  const labelled = biggest(ps, 3);
  const note = options.basisNote !== false;
  const valueItems = ps.map((p, i) => ({ label: `${p.key} ${formatNumber(p.value, "auto", seriesUnit(cur, value.unit))}`, color: colors[i] }));
  let body = "";

  const nameItems = valueItems.map((it, i) => ({ ...it, label: ps[i].key }));
  const legendModes: Item[][] = options.showLegend === false ? [[]] : [valueItems, nameItems, []];
  const noteModes = note ? [SCOPE2_BASIS_NOTE, SCOPE2_BASIS_NOTE_SHORT, ""] : [""];

  if (options.variant === "donut") {
    // #209 review: as the bar's plan below: the legend (measured, wrapping onto rows) and the whole basis note (wrapped) keep
    // their place, stepping their text down to 5.2 pt, as long as the donut keeps a radius of at least FONT × 1.2; the total sits
    // in the hole when it fits there, else under the donut, never over the ring. Only a frame too small for that gives something
    // up, in the bar's order.
    const figure = value.display ?? "";
    const minR = FONT * 1.2;
    const sideLabels = ps.filter((p, i) => labelled.has(i) && p.value / sum >= 0.04).map((p) => pct(p.value / sum));
    const donutPlan = (items: Item[], noteText: string, k: number, strict: boolean) => {
      const size = SMALL * k;
      const leg = items.length ? legendRows(items, w, size) : null;
      if (items.length && !leg) return null;
      const lines = noteText ? noteLines(noteText, w, size) : [];
      if (!lines) return null;
      const legH = leg ? leg.h + SMALL * 0.4 : 0;
      const noteH = lines.length ? noteHeight(lines, size) + SMALL * 0.4 : 0;
      const geom = (underH: number) => {
        const plotH = h - legH - noteH - underH;
        const r = Math.max(strict ? 0 : FONT, ringRadius(w, plotH, sideLabels));
        return { plotH, r, cx: w / 2, cy: plotH / 2, inner: r * 0.62 };
      };
      let g = geom(0);
      if (strict && g.r < minR) return null;
      let centre = figure || value.unit ? donutCentre(figure, value.unit, g.cx, g.cy, g.inner, theme) : "";
      let under = "";
      let underH = 0;
      if (centre === null) {
        const u = underDonut(figure, value.unit, w, theme);
        g = geom(u.h);
        if (strict && g.r < minR) return null;
        under = u.svg(g.plotH);
        underH = u.h;
        centre = "";
      }
      return { ...g, leg, lines, ns: size, noteH, centre, under, underH };
    };
    let dp: ReturnType<typeof donutPlan> = null;
    search: for (const items of legendModes)
      for (const noteText of noteModes)
        for (const k of SMALL_TEXT_STEPS) {
          dp = donutPlan(items, noteText, k, true);
          if (dp) break search;
        }
    const { plotH, r, cx, cy, inner, leg, lines, ns, noteH, centre, under, underH } = dp ?? (donutPlan([], "", 1, false) as NonNullable<typeof dp>);
    const shareLabels = ringLabels(ps.map((p, i) => ({ share: p.value / sum, show: labelled.has(i) && p.value / sum >= 0.04 })), cx, cy, r);
    let a0 = -Math.PI / 2;
    const pt = (rad: number, a: number) => `${n3(cx + rad * Math.cos(a))} ${n3(cy + rad * Math.sin(a))}`;
    ps.forEach((p, i) => {
      const a1 = a0 + (p.value / sum) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d =
        ps.length === 1
          ? `M${pt(r, 0)}A${n3(r)} ${n3(r)} 0 1 1 ${pt(r, Math.PI)}A${n3(r)} ${n3(r)} 0 1 1 ${pt(r, 0)}ZM${pt(inner, 0)}A${n3(inner)} ${n3(inner)} 0 1 0 ${pt(inner, Math.PI)}A${n3(inner)} ${n3(inner)} 0 1 0 ${pt(inner, 0)}Z`
          : `M${pt(r, a0)}A${n3(r)} ${n3(r)} 0 ${large} 1 ${pt(r, a1)}L${pt(inner, a1)}A${n3(inner)} ${n3(inner)} 0 ${large} 0 ${pt(inner, a0)}Z`;
      body += `<path d="${d}" fill="${colors[i]}" fill-rule="evenodd" stroke="${theme.colors.paper}" stroke-width="1" data-part="${esc(p.key)}"><title>${esc(p.key)}</title></path>`;
      const sl = shareLabels[i];
      if (sl) body += text(sl.x, sl.y, sl.text, theme.colors.ink, { size: SMALL, anchor: sl.anchor, baseline: "middle" });
      a0 = a1;
    });
    body += centre + under;
    if (leg) body += drawLegend(leg, plotH + underH, theme);
    if (lines.length) body += drawNote(lines, h - noteH, ns, theme);
    return `${svgOpen(w, h, input.label)}<g data-ghg-chart="scope_split" data-variant="donut">${body}</g></svg>`;
  }

  // 100 % bar. #209 review: what is reported is kept. The bar is never thinner than its share labels need; the legend
  // (scope and tCO₂e) and the whole Scope 2 basis note keep their place by wrapping onto rows and lines, stepping their text
  // down to 5.2 pt, then the total line a step down too. Only a frame too small for all of that gives something up, in this
  // order: the note's second sentence, the note, the legend's figures, the legend. Nothing overlaps or leaves the chart.
  const gap = SMALL * 0.35;
  const shares = ps.map((p, i) => labelled.has(i) && p.value / sum >= 0.08);
  const minBar = shares.some(Boolean) ? SMALL * 1.1 : SMALL * 0.5;
  // #209 round 4: the last resort is one smaller line, never a cut figure (production drew one line).
  const heads = [headline(value, theme, "Total", w), headline(value, theme, "Total", w, { steps: HEADLINE_STEPS.slice(-1) }), headline(value, theme, "Total", w, { maxH: 0 })];
  type Plan = { head: { svg: string; h: number }; leg: ReturnType<typeof legendRows>; lines: string[]; ns: number; room: number };
  const planFor = (head: Plan["head"], items: Item[], noteText: string, k: number): Plan | null => {
    const size = SMALL * k;
    const leg = items.length ? legendRows(items, w, size) : null;
    if (items.length && !leg) return null;
    const lines = noteText ? noteLines(noteText, w, size) : [];
    if (!lines) return null;
    const below = (leg ? leg.h : 0) + (leg && lines.length ? AIR * size : 0) + noteHeight(lines, size);
    return { head, leg, lines, ns: size, room: h - head.h - SMALL * 0.4 - (below ? gap + below : 0) };
  };
  let plan: Plan | null = null;
  search: for (const items of legendModes)
    for (const noteText of noteModes)
      for (const head of heads)
        for (const k of SMALL_TEXT_STEPS) {
          const pl = planFor(head, items, noteText, k);
          if (pl && pl.room >= minBar) {
            plan = pl;
            break search;
          }
        }
  const head = plan?.head ?? heads[heads.length - 1];
  const barY = head.h + SMALL * 0.4;
  const want = Math.min(FONT * 3, Math.max(FONT * 1.5, (h - head.h) * 0.35));
  // A frame too small for even the bar and its share labels: the bar alone, as tall as it can be.
  const barH = plan ? Math.min(want, plan.room) : Math.max(SMALL * 0.5, Math.min(want, h - barY));
  const sharesFit = barH >= SMALL * 1.1;
  let x = 0;
  ps.forEach((p, i) => {
    const pw = (p.value / sum) * w;
    body += rect(x, barY, pw, barH, colors[i], ` stroke="${theme.colors.paper}" stroke-width="1" data-part="${esc(p.key)}"`);
    // A share label fits its segment (a size smaller if it must); one that fits nowhere is left out, never drawn over a neighbour.
    const sz = sharesFit && shares[i] ? [SMALL, SMALL * 0.9, SMALL * 0.8].find((z) => textWidth(pct(p.value / sum), z, true) + z * 0.3 <= pw) : undefined;
    if (sz) body += text(x + pw / 2, barY + barH / 2, pct(p.value / sum), "#FFFFFF", { size: sz, anchor: "middle", baseline: "middle", weight: 700 });
    x += pw;
  });
  body += head.svg;
  if (plan) {
    const y0 = barY + barH + gap;
    if (plan.leg) body += drawLegend(plan.leg, y0, theme);
    if (plan.lines.length) body += drawNote(plan.lines, y0 + (plan.leg ? plan.leg.h + AIR * plan.ns : 0), plan.ns, theme);
  }
  return `${svgOpen(w, h, input.label)}<g data-ghg-chart="scope_split" data-variant="bar">${body}</g></svg>`;
}
