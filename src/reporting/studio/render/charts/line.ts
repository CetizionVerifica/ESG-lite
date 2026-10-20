/**
 * DS-1 · `line` (one line per series over the keys) and `sparkline` (no axes).
 */
import { n3 } from "../util";
import { axisWidth, bandLabels, valueGridY } from "./axis";
import { linearScale } from "./scale";
import { FONT, SMALL, emptyChart, keysOf, legend, seriesColor, svgOpen, valueAt, type ChartInput } from "./svg";

/** Line width in viewBox units. */
const U2 = 2;

export function lineChart(input: ChartInput): string {
  const { value, w, h, theme } = input;
  const series = value.series ?? [];
  const keys = keysOf(series);
  if (!series.length || !keys.length) return emptyChart(w, h, "No data", theme);
  const vals = series.flatMap((s) => s.values.map((v) => v.value).filter((v): v is number => v !== null));
  const scale = linearScale(Math.min(...vals), Math.max(...vals), 5, true);
  const legendH = series.length > 1 ? SMALL * 2 : 0;
  const x0 = axisWidth(scale);
  const pw = w - x0;
  const top = SMALL;
  const ph = h - legendH - FONT * 1.8 - top;
  const band = pw / keys.length;
  let body = valueGridY(scale, x0, top, pw, ph, theme);
  series.forEach((s, si) => {
    const color = seriesColor(theme, s.label, si);
    let d = "";
    let pen = false;
    keys.forEach((k, ki) => {
      const v = valueAt(s, k);
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${n3(x0 + band * (ki + 0.5))} ${n3(top + ph - scale.t(v) * ph)}`;
      pen = true;
    });
    body += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n3(U2)}" stroke-linejoin="round" stroke-linecap="round"/>`;
    keys.forEach((k, ki) => {
      const v = valueAt(s, k);
      if (v !== null) body += `<circle cx="${n3(x0 + band * (ki + 0.5))}" cy="${n3(top + ph - scale.t(v) * ph)}" r="${n3(U2 * 1.2)}" fill="${color}"/>`;
    });
  });
  body += bandLabels(keys, x0, band, top + ph + FONT * 1.2, theme);
  if (series.length > 1) body += legend(series.map((s, i) => ({ label: s.label, color: seriesColor(theme, s.label, i) })), w, h - SMALL * 0.3, theme);
  return `${svgOpen(w, h, input.label)}${body}</svg>`;
}


export function sparkline(input: ChartInput): string {
  const { value, w, h, theme } = input;
  const s = value.series?.[0];
  const pts = (s?.values ?? []).filter((v) => v.value !== null) as { key: string; value: number }[];
  if (pts.length < 2) return `${svgOpen(w, h, input.label)}</svg>`;
  const lo = Math.min(...pts.map((p) => p.value));
  const hi = Math.max(...pts.map((p) => p.value));
  const span = hi - lo || 1;
  const pad = h * 0.15;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * (w - pad * 2) + pad, h - pad - ((p.value - lo) / span) * (h - pad * 2)]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${n3(x)} ${n3(y)}`).join("");
  const [lx, ly] = xy[xy.length - 1];
  return `${svgOpen(w, h, input.label)}<path d="${d}" fill="none" stroke="${theme.colors.primary}" stroke-width="${n3(Math.max(1.5, h / 20))}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${n3(lx)}" cy="${n3(ly)}" r="${n3(Math.max(2, h / 12))}" fill="${theme.colors.accent}"/></svg>`;
}
