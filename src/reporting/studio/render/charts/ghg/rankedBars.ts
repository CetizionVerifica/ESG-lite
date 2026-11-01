/**
 * DS-8 · ranked horizontal bars: `category_bars` (Scope 3 categories, top n +
 * "Other") and `site_bars` (sites). Sorted largest first with "Other" last,
 * the current year in colour; with several years the prior year is a thin
 * bar under each (grey with `greyPrior`, the default). The total comes from
 * the server's display; only the three biggest bars carry a value label.
 * Binding: ghg · breakdown scope3_category (category_bars) or site (site_bars) · top n.
 */
import { formatNumber, seriesUnit } from "../../format";
import { esc, n3 } from "../../util";
import { tickFloorX, valueGridX } from "../axis";
import { linearScale } from "../scale";
import { INK_GAP, LABEL_STEPS, PLOT_FLOOR, SMALL, barEndsPlot, boxesMeet, emptyChart, fitBarEnds, inkBox, rect, rectBox, svgOpen, text, type ChartInput, type LabelBox, type Obstacle } from "../svg";
import { biggest, clip, currentSeries, headline, partColor, partsOf, priorSeries, ranked, wrapLegend } from "./common";
import { mix } from "../../theme";

function rankedBars(input: ChartInput, kind: "category_bars" | "site_bars"): string {
  const { value, w, h, theme, options } = input;
  const cur = currentSeries(value);
  const ps = ranked(partsOf(cur));
  if (!ps.length) return emptyChart(w, h, "No data", theme);
  const prior = priorSeries(value);
  const priorOf = (k: string): number | null => prior?.values.find((p) => p.key === k)?.value ?? null;
  const showValues = options.showValues !== false;
  const labelled = biggest(ps, 3);

  const legendItems = prior
    ? [
        { label: cur?.label ?? "", color: options.colors === "brand" ? theme.series[0] : kind === "category_bars" ? theme.colors.s3 : theme.colors.primary },
        { label: prior.label, color: options.greyPrior === false ? mix(theme.colors.primary, theme.colors.paper, 0.55) : theme.colors.prior },
      ]
    : [];
  const leg = options.showLegend === false ? { svg: "", h: 0 } : wrapLegend(legendItems, w, 0, theme);
  // #209 round 4: the total line is chosen with the plot: more lines only while every bar keeps a band its name fits (a
  // SMALL line), and the plot never goes under PLOT_FLOOR.
  const head = headline(value, theme, "Total", w, { maxH: h - leg.h - SMALL * 2 - Math.max(SMALL * 2, ps.length * SMALL * 1.1) });
  const all = [...ps.map((p) => p.value), ...ps.map((p) => priorOf(p.key) ?? 0)];
  const scale = linearScale(Math.min(0, ...all), Math.max(...all), 4);
  const labelChars = Math.max(6, Math.floor((w * 0.34) / (SMALL * 0.55)));
  const labelW = Math.min(w * 0.36, Math.max(...ps.map((p) => Math.min(p.key.length, labelChars))) * SMALL * 0.55 + SMALL);
  const x0 = labelW;
  // Value labels sit after the bar end; a long one (a 3-decimal tCO₂e figure, #209) narrows the plot so it isn't cut.
  const unit = seriesUnit(cur, value.unit); // #209 review: the series' own unit
  const valueText = (v: number) => formatNumber(v, "auto", unit);
  const top = head.h;
  const ph = Math.max(PLOT_FLOOR, h - top - leg.h - SMALL * 2);
  const band = ph / ps.length;
  const mainH = prior ? band * 0.5 : band * 0.66;
  // #209 review: a value label sits after its own bar's end, centred on it. #209 round 5: always its own bar's end (never after
  // the longer prior-year bar under it, where it read as that year's value); in a thin band it steps down a size or moves up or
  // down within its bar's height (labelFit) to clear the prior bar or a neighbour, and is left out only when nothing clears.
  const endOf = (p: (typeof ps)[number]): number => scale.t(Math.max(0, p.value));
  // #209 round 4: no narrower than its tick labels need while the labels can step down instead (barEndsPlot). A frame too narrow for
  // the label gutter keeps a plot of SMALL × 2 (production's went negative there).
  const pw0 = Math.max(w - x0 - (showValues ? SMALL * 4.5 : SMALL), Math.min(SMALL * 2, w - x0));
  const steps = LABEL_STEPS.map((k) => SMALL * k);
  const ends = ps.map((p, i) => ({ p, i })).filter(({ i }) => labelled.has(i)).map(({ p, i }) => ({ t: endOf(p), label: valueText(p.value), bold: i === 0 }));
  const pw = showValues ? barEndsPlot(tickFloorX(scale, pw0), steps, (sz) => fitBarEnds(pw0, x0, w, ends, SMALL * 0.4, sz)) : pw0;
  // #209 review: the labels (after the bar ends, centred on the bars) may not meet each other or a bar other than their own:
  // in thin bands they step down a size, down to 80 %; at that size a label that still meets one is left out, the
  // biggest bars' labels kept first. #209 round 4: decided on the labels' ink (inkBox), so a label production drew clear
  // of the next bar stays.
  const bars: Obstacle[] = ps.flatMap((p, i) => {
    const y = top + band * i;
    const out = [rectBox(x0 + scale.t(Math.min(0, p.value)) * pw, y + band * 0.14, (scale.t(Math.max(0, p.value)) - scale.t(Math.min(0, p.value))) * pw, mainH, i)];
    const pv = priorOf(p.key);
    if (prior && pv !== null) out.push(rectBox(x0 + scale.t(Math.min(0, pv)) * pw, y + band * 0.14 + mainH + band * 0.04, (scale.t(Math.max(0, pv)) - scale.t(Math.min(0, pv))) * pw, band * 0.18));
    return out;
  });
  const shown = showValues ? ps.map((_, i) => i).filter((i) => labelled.has(i)) : [];
  // #209 round 5: a label at its own bar's end, centred on the bar or moved up or down within the bar's height (its middle never
  // past the bar's top or bottom edge), the smallest move first: the exact moves that clear what it meets, then quarter steps.
  // Only at the smallest step, and only when the prior-year bar under it ends within SMALL of its own (so the label still
  // starts right after its own bar), it may start after the prior bar's end instead; else it is left out.
  type Fit = { size: number; at: Map<number, { x: number; y: number }> };
  const labelFit = (size: number, drop: boolean): Fit | null => {
    const placed: LabelBox[] = [];
    const at = new Map<number, { x: number; y: number }>();
    for (const i of shown) {
      const own = x0 + endOf(ps[i]) * pw + SMALL * 0.4;
      const pv = priorOf(ps[i].key);
      const past = prior && pv !== null ? x0 + scale.t(Math.max(0, pv)) * pw + SMALL * 0.4 : own;
      const xs = drop && past > own && past - own <= SMALL ? [own, past] : [own];
      const yMid = top + band * i + band * 0.14 + mainH / 2;
      const s = valueText(ps[i].value);
      const hits = (box: LabelBox) => [...placed, ...bars.filter((b) => b.owner !== i)].filter((b) => boxesMeet(b, box, size * INK_GAP));
      const gap = size * INK_GAP + 0.01;
      let spot: { x: number; y: number } | null = null;
      for (const x of xs) {
        const boxAt = (y: number) => inkBox(x, y, s, size, { baseline: "middle", bold: i === 0 });
        const box0 = boxAt(yMid);
        const moves = [...hits(box0).flatMap((b) => [box0.y1 - b.y0 + gap, -(b.y1 - box0.y0 + gap)]), ...[1, 2, 3, 4].flatMap((k) => [1, -1].map((u) => (u * mainH * k) / 8))]
          .filter((d) => d !== 0 && Math.abs(d) <= mainH / 2 + 1e-9)
          .sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
        const y = [yMid, ...moves.map((d) => yMid - d)].find((yy) => {
          const box = boxAt(yy);
          return box.x1 <= w + 1e-6 && !hits(box).length;
        });
        if (y !== undefined) {
          spot = { x, y };
          break;
        }
      }
      if (!spot && !drop) return null;
      if (!spot) continue;
      placed.push(inkBox(spot.x, spot.y, s, size, { baseline: "middle", bold: i === 0 }));
      at.set(i, spot);
    }
    return { size, at };
  };
  const fit = steps.map((sz) => labelFit(sz, false)).find(Boolean) ?? (labelFit(steps[steps.length - 1], true) as Fit);
  let body = head.svg + valueGridX(scale, x0, top, pw, ph, theme);
  ps.forEach((p, i) => {
    const y = top + band * i;
    const color = kind === "category_bars" && options.colors !== "brand" ? (p.key === "Other" ? theme.colors.muted : theme.colors.s3) : partColor({ theme, options: { ...options, colors: "brand" } }, p.key, 0);
    body += text(x0 - SMALL * 0.5, y + band / 2, clip(p.key, labelChars), theme.colors.ink, { size: SMALL, anchor: "end", baseline: "middle" });
    const a = x0 + scale.t(Math.min(0, p.value)) * pw;
    const b = x0 + scale.t(Math.max(0, p.value)) * pw;
    const pv = priorOf(p.key);
    body += rect(a, y + band * 0.14, b - a, mainH, color, ` data-part="${esc(p.key)}"`);
    if (prior && pv !== null) {
      const pa = x0 + scale.t(Math.min(0, pv)) * pw;
      const pb = x0 + scale.t(Math.max(0, pv)) * pw;
      body += rect(pa, y + band * 0.14 + mainH + band * 0.04, pb - pa, band * 0.18, legendItems[1].color, ` data-prior="${esc(prior.label)}"`);
    }
    const at = fit.at.get(i);
    if (at) body += text(at.x, at.y, valueText(p.value), theme.colors.ink, { size: fit.size, baseline: "middle", weight: i === 0 ? 700 : undefined });
  });
  body += `<g transform="translate(0 ${n3(h - leg.h)})">${leg.svg}</g>`;
  return `${svgOpen(w, h, input.label)}<g data-ghg-chart="${kind}" data-bars="${ps.length}">${body}</g></svg>`;
}

export const categoryBarsChart = (input: ChartInput): string => rankedBars(input, "category_bars");
export const siteBarsChart = (input: ChartInput): string => rankedBars(input, "site_bars");
