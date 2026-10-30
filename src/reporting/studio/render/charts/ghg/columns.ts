/**
 * DS-8 · column charts:
 *   gas_split      bars by gas (CO₂, CH₄, N₂O) for the current year, prior
 *                  years beside them (grey with greyPrior). Gas figures are
 *                  tonnes of each gas (DS-2), said under the chart.
 *                  Binding: ghg · breakdown gas.
 *   monthly_stack  months (or quarters) stacked by scope from `stacks` (one
 *                  series per scope, DS-8 addition to /resolve); without
 *                  stacks, the current year's months as plain bars. Only the
 *                  peak month carries a value label.
 *                  Binding: ghg · metric total (or one scope) · breakdown month | quarter.
 */
import { formatNumber, seriesUnit, sharedUnit } from "../../format";
import { mix } from "../../theme";
import type { RenderSeries } from "../../types";
import { esc, n3 } from "../../util";
import { axisWidth, tickBoxes, tickRoom, valueGridY } from "../axis";
import { linearScale } from "../scale";
import { FONT, SMALL, emptyChart, fitLabelRow, keysOf, plotSpan, rect, rectBox, svgOpen, text, valueAt, type ChartInput, type Obstacle } from "../svg";
import { biggest, currentSeries, headline, partColor, partsOf, shortKey, wrapLegend } from "./common";

export const GAS_UNIT_NOTE = "Tonnes of each gas, not CO₂e.";

export function gasSplitChart(input: ChartInput): string {
  const { value, w, h, theme, options } = input;
  const series = value.series ?? [];
  const cur = currentSeries(value);
  const ps = partsOf(cur);
  if (!cur || !ps.length) return emptyChart(w, h, "No data", theme);
  const years = series.slice(-3);
  const priorColor = (i: number) => (options.greyPrior === false ? mix(theme.colors.primary, theme.colors.paper, 0.3 + 0.2 * i) : mix(theme.colors.prior, theme.colors.paper, 0.25 * i));
  const legendItems = years.length > 1 ? years.map((s, i) => ({ label: s.label, color: i === years.length - 1 ? theme.colors.primary : priorColor(years.length - 2 - i) })) : [];
  const leg = options.showLegend === false ? { svg: "", h: 0 } : wrapLegend(legendItems, w, 0, theme);
  const all = years.flatMap((s) => s.values.map((v) => v.value ?? 0));
  const scale = linearScale(Math.min(0, ...all), Math.max(...all), 4);
  const x0 = axisWidth(scale);
  const pw = w - x0;
  const noteH = SMALL * 1.6;
  // #209 round 4: the total line is chosen with the plot: more lines only while the plot keeps its axis room; the plot
  // never goes under PLOT_FLOOR (svg.ts plotSpan: never an upside-down axis), and a staggered label row takes only height
  // it can spare.
  const below = FONT * 1.2 + FONT * 1.8 + leg.h + noteH;
  const head = headline(value, theme, "Total emissions", w, { maxH: h - below - tickRoom(scale) });
  const maxLift = h - head.h - below - tickRoom(scale);
  const band = pw / ps.length;
  const labelled = biggest(ps, 3);
  const sub = (band * 0.7) / years.length;
  // #209 review: gas parts are tonnes of each gas (the series' unit), not tCO₂e. The current year is the last series.
  const labelOf = (v: number) => formatNumber(v, "auto", seriesUnit(cur, value.unit));
  const shown = ps.map((p, ki) => ({ p, ki })).filter(({ ki }) => options.showValues !== false && labelled.has(ki));
  // A gas column of year si over a plot [top, top + ph].
  const colRect = (ki: number, si: number, top: number, ph: number) => {
    const v = valueAt(years[si], ps[ki].key) ?? 0;
    const t = top + ph - scale.t(Math.max(0, v)) * ph;
    const b = top + ph - scale.t(Math.min(0, v)) * ph;
    return { x: x0 + band * ki + band * 0.15 + sub * si, y: t, w: sub * 0.9, h: b - t };
  };
  // #209 review: labels over the gases may not meet each other, the tick labels or another column (svg.ts fitLabelRow).
  const fit = fitLabelRow(
    (extra) => {
      const { top: te, ph: phe } = plotSpan(head.h + FONT * 1.2 + extra, h - FONT * 1.8 - leg.h - noteH, head.h);
      const obstacles: Obstacle[] = [...tickBoxes(scale, x0, te, phe)];
      ps.forEach((_, ki) =>
        years.forEach((__, si) => {
          const r = colRect(ki, si, te, phe);
          const li = si === years.length - 1 ? shown.findIndex((e) => e.ki === ki) : -1;
          obstacles.push(rectBox(r.x, r.y, r.w, r.h, li >= 0 ? li : undefined));
        }),
      );
      const labels = shown.map(({ p, ki }) => {
        const v = valueAt(cur, p.key) ?? 0;
        return { x: x0 + band * ki + band * 0.15 + sub * (years.length - 1) + sub * 0.45, y: te + phe - scale.t(Math.max(0, v)) * phe - SMALL * 0.5, text: labelOf(v), priority: v };
      });
      return { labels, obstacles };
    },
    w,
    h,
    { x0, minY: head.h, maxLift },
  );
  const { top, ph } = plotSpan(head.h + FONT * 1.2 + fit.extraTop, h - FONT * 1.8 - leg.h - noteH, head.h);
  let body = head.svg + valueGridY(scale, x0, top, pw, ph, theme);
  ps.forEach((p, ki) => {
    const x = x0 + band * ki;
    years.forEach((s, si) => {
      const v = valueAt(s, p.key) ?? 0;
      const isCur = si === years.length - 1;
      const color = isCur ? partColor(input, p.key, ki) : priorColor(years.length - 2 - si);
      const r = colRect(ki, si, top, ph);
      body += rect(r.x, r.y, r.w, r.h, color, ` data-part="${esc(p.key)}" data-year="${esc(s.label)}"`);
      const li = isCur ? shown.findIndex((e) => e.ki === ki) : -1;
      const at = li >= 0 ? fit.labels[li] : null;
      if (at) body += text(at.x, at.y, labelOf(v), theme.colors.ink, { size: fit.size, anchor: "middle" });
    });
    body += text(x + band / 2, top + ph + FONT * 1.2, p.key, theme.colors.ink, { size: SMALL, anchor: "middle" });
  });
  body += text(0, top + ph + FONT * 1.8 + noteH * 0.7, GAS_UNIT_NOTE, theme.colors.muted, { size: SMALL });
  body += `<g transform="translate(0 ${n3(h - leg.h)})">${leg.svg}</g>`;
  return `${svgOpen(w, h, input.label)}<g data-ghg-chart="gas_split">${body}</g></svg>`;
}

export function monthlyStackChart(input: ChartInput): string {
  const { value, w, h, theme, options } = input;
  const stacks: RenderSeries[] = value.stacks?.length ? value.stacks : currentSeries(value) ? [currentSeries(value) as RenderSeries] : [];
  const keys = keysOf(stacks);
  if (!stacks.length || !keys.length) return emptyChart(w, h, "No data", theme);
  const totals = keys.map((k) => stacks.reduce((a, s) => a + Math.max(0, valueAt(s, k) ?? 0), 0));
  const colors = stacks.map((s, i) => (value.stacks?.length ? partColor(input, s.label, i) : theme.colors.primary));
  const leg = options.showLegend === false || stacks.length < 2 ? { svg: "", h: 0 } : wrapLegend(stacks.map((s, i) => ({ label: s.label, color: colors[i] })), w, 0, theme);
  const scale = linearScale(0, Math.max(...totals), 4);
  const x0 = axisWidth(scale);
  const pw = w - x0;
  const band = pw / keys.length;
  // #209 round 4: as gas_split, the total line is chosen with the plot, which never goes under PLOT_FLOOR.
  const below = FONT * 1.2 + FONT * 1.8 + leg.h;
  const head = headline(value, theme, "Total", w, { maxH: h - below - tickRoom(scale) });
  const maxLift = h - head.h - below - tickRoom(scale);
  let peak = 0;
  totals.forEach((t, i) => {
    if (t > totals[peak]) peak = i;
  });
  const peakLabel = formatNumber(totals[peak], "auto", sharedUnit(stacks, value.unit));
  // The stacked segments of month ki over a plot [top, top + ph].
  const segRects = (ki: number, top: number, ph: number) => {
    let acc = 0;
    return stacks.map((s) => {
      const v = Math.max(0, valueAt(s, keys[ki]) ?? 0);
      const t = top + ph - scale.t(acc + v) * ph;
      const b = top + ph - scale.t(acc) * ph;
      acc += v;
      return { x: x0 + band * ki + band * 0.16, y: t, w: band * 0.68, h: b - t };
    });
  };
  // #209 review: the peak label stays inside the plot, bold-aware, clear of the tick labels and the other months (svg.ts fitLabelRow).
  const fit = fitLabelRow(
    (extra) => {
      if (options.showValues === false || !(totals[peak] > 0)) return { labels: [] };
      const { top: te, ph: phe } = plotSpan(head.h + FONT * 1.2 + extra, h - FONT * 1.8 - leg.h, head.h);
      const obstacles: Obstacle[] = [...tickBoxes(scale, x0, te, phe), ...keys.flatMap((_, ki) => segRects(ki, te, phe).map((r) => rectBox(r.x, r.y, r.w, r.h, ki === peak ? 0 : undefined)))];
      return { labels: [{ x: x0 + band * (peak + 0.5), y: te + phe - scale.t(totals[peak]) * phe - SMALL * 0.5, text: peakLabel, bold: true }], obstacles };
    },
    w,
    h,
    { x0, minY: head.h, maxLift },
  );
  const { top, ph } = plotSpan(head.h + FONT * 1.2 + fit.extraTop, h - FONT * 1.8 - leg.h, head.h);
  let body = head.svg + valueGridY(scale, x0, top, pw, ph, theme);
  keys.forEach((k, ki) => {
    const x = x0 + band * ki;
    segRects(ki, top, ph).forEach((r, si) => {
      body += rect(r.x, r.y, r.w, r.h, colors[si], ` data-part="${esc(stacks[si].label)}" data-key="${esc(k)}"`);
    });
    const at = ki === peak ? fit.labels[0] : null;
    if (at) body += text(at.x, at.y, peakLabel, theme.colors.ink, { size: fit.size, anchor: "middle", weight: 700 });
    body += text(x + band / 2, top + ph + FONT * 1.2, shortKey(k), theme.colors.muted, { size: SMALL, anchor: "middle" });
  });
  body += `<g transform="translate(0 ${n3(h - leg.h)})">${leg.svg}</g>`;
  return `${svgOpen(w, h, input.label)}<g data-ghg-chart="monthly_stack" data-stacks="${stacks.length}" data-keys="${keys.length}">${body}</g></svg>`;
}
