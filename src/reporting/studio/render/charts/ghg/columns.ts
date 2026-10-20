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
import { formatNumber } from "../../format";
import { mix } from "../../theme";
import type { RenderSeries } from "../../types";
import { esc, n3 } from "../../util";
import { axisWidth, valueGridY } from "../axis";
import { linearScale } from "../scale";
import { FONT, SMALL, emptyChart, keysOf, rect, svgOpen, text, valueAt, type ChartInput } from "../svg";
import { biggest, currentSeries, headline, partColor, partsOf, shortKey, wrapLegend } from "./common";

export const GAS_UNIT_NOTE = "Tonnes of each gas, not CO₂e.";

export function gasSplitChart(input: ChartInput): string {
  const { value, w, h, theme, options } = input;
  const series = value.series ?? [];
  const cur = currentSeries(value);
  const ps = partsOf(cur);
  if (!cur || !ps.length) return emptyChart(w, h, "No data", theme);
  const years = series.slice(-3);
  const head = headline(value, theme, "Total emissions");
  const priorColor = (i: number) => (options.greyPrior === false ? mix(theme.colors.primary, theme.colors.paper, 0.3 + 0.2 * i) : mix(theme.colors.prior, theme.colors.paper, 0.25 * i));
  const legendItems = years.length > 1 ? years.map((s, i) => ({ label: s.label, color: i === years.length - 1 ? theme.colors.primary : priorColor(years.length - 2 - i) })) : [];
  const leg = options.showLegend === false ? { svg: "", h: 0 } : wrapLegend(legendItems, w, 0, theme);
  const all = years.flatMap((s) => s.values.map((v) => v.value ?? 0));
  const scale = linearScale(Math.min(0, ...all), Math.max(...all), 4);
  const x0 = axisWidth(scale);
  const pw = w - x0;
  const top = head.h + FONT * 1.2;
  const noteH = SMALL * 1.6;
  const ph = h - top - FONT * 1.8 - leg.h - noteH;
  const band = pw / ps.length;
  const labelled = biggest(ps, 3);
  let body = head.svg + valueGridY(scale, x0, top, pw, ph, theme);
  ps.forEach((p, ki) => {
    const x = x0 + band * ki;
    const sub = (band * 0.7) / years.length;
    years.forEach((s, si) => {
      const v = valueAt(s, p.key) ?? 0;
      const isCur = si === years.length - 1;
      const color = isCur ? partColor(input, p.key, ki) : priorColor(years.length - 2 - si);
      const t = top + ph - scale.t(Math.max(0, v)) * ph;
      const b = top + ph - scale.t(Math.min(0, v)) * ph;
      body += rect(x + band * 0.15 + sub * si, t, sub * 0.9, b - t, color, ` data-part="${esc(p.key)}" data-year="${esc(s.label)}"`);
      if (isCur && options.showValues !== false && labelled.has(ki)) body += text(x + band * 0.15 + sub * si + sub * 0.45, t - SMALL * 0.5, formatNumber(v), theme.colors.ink, { size: SMALL, anchor: "middle" });
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
  const head = headline(value, theme);
  const colors = stacks.map((s, i) => (value.stacks?.length ? partColor(input, s.label, i) : theme.colors.primary));
  const leg = options.showLegend === false || stacks.length < 2 ? { svg: "", h: 0 } : wrapLegend(stacks.map((s, i) => ({ label: s.label, color: colors[i] })), w, 0, theme);
  const scale = linearScale(0, Math.max(...totals), 4);
  const x0 = axisWidth(scale);
  const pw = w - x0;
  const top = head.h + FONT * 1.2;
  const ph = h - top - FONT * 1.8 - leg.h;
  const band = pw / keys.length;
  let peak = 0;
  totals.forEach((t, i) => {
    if (t > totals[peak]) peak = i;
  });
  let body = head.svg + valueGridY(scale, x0, top, pw, ph, theme);
  keys.forEach((k, ki) => {
    const x = x0 + band * ki;
    let acc = 0;
    stacks.forEach((s, si) => {
      const v = Math.max(0, valueAt(s, k) ?? 0);
      const t = top + ph - scale.t(acc + v) * ph;
      const b = top + ph - scale.t(acc) * ph;
      body += rect(x + band * 0.16, t, band * 0.68, b - t, colors[si], ` data-part="${esc(s.label)}" data-key="${esc(k)}"`);
      acc += v;
    });
    if (ki === peak && options.showValues !== false && totals[ki] > 0) body += text(x + band / 2, top + ph - scale.t(totals[ki]) * ph - SMALL * 0.5, formatNumber(totals[ki]), theme.colors.ink, { size: SMALL, anchor: "middle", weight: 700 });
    body += text(x + band / 2, top + ph + FONT * 1.2, shortKey(k), theme.colors.muted, { size: SMALL, anchor: "middle" });
  });
  body += `<g transform="translate(0 ${n3(h - leg.h)})">${leg.svg}</g>`;
  return `${svgOpen(w, h, input.label)}<g data-ghg-chart="monthly_stack" data-stacks="${stacks.length}" data-keys="${keys.length}">${body}</g></svg>`;
}
