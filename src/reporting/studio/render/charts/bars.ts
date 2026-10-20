/**
 * DS-1 · bar charts: `bar` (one series, or grouped series) and `stacked_bar`.
 * Prior years are grey and the latest is highlighted (greyPrior); bars start
 * at zero; `horizontal` lays categories down the side.
 */
import { formatNumber } from "../format";
import { n3 } from "../util";
import { axisWidth, bandLabels, valueGridX, valueGridY } from "./axis";
import { linearScale } from "./scale";
import { FONT, SMALL, emptyChart, isYearKey, keysOf, legend, rect, seriesColor, svgOpen, text, valueAt, type ChartInput } from "./svg";

function draw(input: ChartInput, stacked: boolean): string {
  const { value, w, h, theme, options } = input;
  const series = value.series ?? [];
  const keys = keysOf(series);
  if (!series.length || !keys.length) return emptyChart(w, h, "No data", theme);
  const multi = series.length > 1;
  const totals = keys.map((k) => series.reduce((a, s) => a + Math.max(0, valueAt(s, k) ?? 0), 0));
  const negs = keys.map((k) => series.reduce((a, s) => a + Math.min(0, valueAt(s, k) ?? 0), 0));
  const all = series.flatMap((s) => s.values.map((v) => v.value ?? 0));
  const scale = stacked ? linearScale(Math.min(...negs), Math.max(...totals)) : linearScale(Math.min(...all), Math.max(...all));
  const legendH = multi ? SMALL * 2 : 0;
  const latest = keys[keys.length - 1];
  const colorFor = (si: number, key: string): string => {
    if (!multi && options.greyPrior !== false && isYearKey(key) && keys.length > 1 && key !== latest) return theme.colors.prior;
    return seriesColor(theme, series[si].label, si);
  };
  let body = "";
  if (options.horizontal) {
    const labelW = Math.min(w * 0.35, Math.max(...keys.map((k) => k.length)) * SMALL * 0.55 + SMALL);
    const x0 = labelW;
    const pw = w - x0 - SMALL * 3;
    const ph = h - legendH - SMALL * 2;
    const band = ph / keys.length;
    body += valueGridX(scale, x0, 0, pw, ph, theme);
    keys.forEach((k, ki) => {
      const y = band * ki;
      body += text(x0 - SMALL * 0.5, y + band / 2, k, theme.colors.ink, { size: SMALL, anchor: "end", baseline: "middle" });
      if (stacked || !multi) {
        let acc = 0;
        series.forEach((s, si) => {
          const v = valueAt(s, k) ?? 0;
          const a = x0 + scale.t(Math.min(acc, acc + v)) * pw;
          const b = x0 + scale.t(Math.max(acc, acc + v)) * pw;
          body += rect(a, y + band * 0.18, b - a, band * 0.64, colorFor(si, k));
          acc += stacked ? v : 0;
        });
        if (options.showValues !== false) body += text(x0 + scale.t(totals[ki]) * pw + SMALL * 0.4, y + band / 2, formatNumber(totals[ki]), theme.colors.ink, { size: SMALL, baseline: "middle" });
      } else {
        const sub = (band * 0.7) / series.length;
        series.forEach((s, si) => {
          const v = valueAt(s, k) ?? 0;
          const a = x0 + scale.t(Math.min(0, v)) * pw;
          const b = x0 + scale.t(Math.max(0, v)) * pw;
          body += rect(a, y + band * 0.15 + sub * si, b - a, sub * 0.9, colorFor(si, k));
        });
      }
    });
  } else {
    const x0 = axisWidth(scale);
    const pw = w - x0;
    const ph = h - legendH - FONT * 1.8 - (options.showValues !== false ? FONT * 1.2 : 0);
    const y0 = options.showValues !== false ? FONT * 1.2 : 0;
    const band = pw / keys.length;
    body += valueGridY(scale, x0, y0, pw, ph, theme);
    keys.forEach((k, ki) => {
      const x = x0 + band * ki;
      if (stacked || !multi) {
        let acc = 0;
        series.forEach((s, si) => {
          const v = valueAt(s, k) ?? 0;
          const top = y0 + ph - scale.t(Math.max(acc, acc + v)) * ph;
          const bottom = y0 + ph - scale.t(Math.min(acc, acc + v)) * ph;
          body += rect(x + band * 0.18, top, band * 0.64, bottom - top, colorFor(si, k));
          acc += stacked ? v : 0;
        });
        if (options.showValues !== false) body += text(x + band / 2, y0 + ph - scale.t(totals[ki]) * ph - SMALL * 0.5, formatNumber(totals[ki]), theme.colors.ink, { size: SMALL, anchor: "middle", weight: k === latest ? 700 : undefined });
      } else {
        const sub = (band * 0.7) / series.length;
        series.forEach((s, si) => {
          const v = valueAt(s, k) ?? 0;
          const top = y0 + ph - scale.t(Math.max(0, v)) * ph;
          const bottom = y0 + ph - scale.t(Math.min(0, v)) * ph;
          body += rect(x + band * 0.15 + sub * si, top, sub * 0.9, bottom - top, colorFor(si, k));
        });
      }
    });
    body += bandLabels(keys, x0, band, y0 + ph + FONT * 1.2, theme);
  }
  if (multi) body += legend(series.map((s, i) => ({ label: s.label, color: seriesColor(theme, s.label, i) })), w, h - SMALL * 0.3, theme);
  return `${svgOpen(w, h, input.label)}<g data-bars="${n3(keys.length)}">${body}</g></svg>`;
}

export const barChart = (input: ChartInput): string => draw(input, input.options.stacked === true);
export const stackedBarChart = (input: ChartInput): string => draw(input, true);
