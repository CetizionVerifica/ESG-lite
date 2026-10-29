/**
 * DS-1 · bar charts: `bar` (one series, or grouped series) and `stacked_bar`.
 * Prior years are grey and the latest is highlighted (greyPrior); bars start
 * at zero; `horizontal` lays categories down the side.
 */
import { formatNumber, sharedUnit } from "../format";
import { n3 } from "../util";
import { axisWidth, bandLabels, valueGridX, valueGridY } from "./axis";
import { linearScale } from "./scale";
import { FONT, SMALL, emptyChart, fitBarEnds, fitLabelRow, isYearKey, keysOf, legend, rect, seriesColor, svgOpen, text, valueAt, type ChartInput } from "./svg";

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
  // #209 review: a label is one series' value or a stacked total; it prints in the series' unit, a total only in the unit every summed series shares.
  const labelUnit = sharedUnit(series, value.unit);
  const valueText = (v: number) => formatNumber(v, "auto", labelUnit);
  const colorFor = (si: number, key: string): string => {
    if (!multi && options.greyPrior !== false && isYearKey(key) && keys.length > 1 && key !== latest) return theme.colors.prior;
    return seriesColor(theme, series[si].label, si);
  };
  let body = "";
  if (options.horizontal) {
    const labelW = Math.min(w * 0.35, Math.max(...keys.map((k) => k.length)) * SMALL * 0.55 + SMALL);
    const x0 = labelW;
    // Totals sit after the bar end; a long one (a 3-decimal tCO₂e figure, #209) narrows the plot so it isn't cut.
    const pw0 = w - x0 - SMALL * 3;
    const pw = options.showValues !== false && (stacked || !multi) ? fitBarEnds(pw0, x0, w, totals.map((t) => ({ t: scale.t(t), label: valueText(t) }))) : pw0;
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
        if (options.showValues !== false) body += text(x0 + scale.t(totals[ki]) * pw + SMALL * 0.4, y + band / 2, valueText(totals[ki]), theme.colors.ink, { size: SMALL, baseline: "middle" });
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
    const band = pw / keys.length;
    const labelled = options.showValues !== false && (stacked || !multi);
    // #209 review: totals over neighbouring bars may not meet; a row that doesn't fit staggers (taking a line from the plot) or steps down a size.
    const fit = fitLabelRow(
      (extra) => {
        if (!labelled) return [];
        const y0e = FONT * 1.2 + extra;
        const phe = h - legendH - FONT * 1.8 - FONT * 1.2 - extra;
        return keys.map((k, ki) => ({ x: x0 + band * (ki + 0.5), y: y0e + phe - scale.t(totals[ki]) * phe - SMALL * 0.5, text: valueText(totals[ki]), bold: k === latest }));
      },
      w,
      h,
    );
    const ph = h - legendH - FONT * 1.8 - (options.showValues !== false ? FONT * 1.2 + fit.extraTop : 0);
    const y0 = options.showValues !== false ? FONT * 1.2 + fit.extraTop : 0;
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
        const at = fit.labels[ki];
        if (options.showValues !== false && at) body += text(at.x, at.y, valueText(totals[ki]), theme.colors.ink, { size: fit.size, anchor: "middle", weight: k === latest ? 700 : undefined });
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
