/**
 * DS-8 · change over time:
 *   base_year_waterfall  base year total → the change in Scope 1, 2 and 3 →
 *                        current total. Series per year keyed by scope (the
 *                        first series is the base year, the last the current
 *                        year). Rises are red, falls green (emissions).
 *                        Binding: ghg · metric total · breakdown scope · years [base, current] (or last n).
 *   intensity_line       one line over the years with the first and last
 *                        points labelled and the unit above.
 *                        Binding: ghg · metric intensity_* · years last n.
 */
import { formatNumber, seriesUnit, sharedUnit } from "../../format";
import { esc, n3 } from "../../util";
import { axisWidth, bandLabels, tickBoxes, tickRoom, valueGridY } from "../axis";
import { linearScale } from "../scale";
import { FONT, SMALL, emptyChart, fitLabelRow, plotSpan, rect, rectBox, svgOpen, text, valueAt, type ChartInput } from "../svg";
import { clip, partsOf, total, type Part } from "./common";

type Step = { key: string; from: number; to: number; kind: "abs" | "up" | "down" };

/**
 * The bridge's steps. Three shapes of data:
 *   by scope   series per year keyed by scope → base, Δ Scope 1/2/3, current;
 *   compare    no breakdown, `compare` against the base year → base, change, current;
 *   by year    no breakdown, one series keyed by year → first year, change, last year.
 */
export function bridgeSteps(value: ChartInput["value"]): Step[] | null {
  const series = value.series ?? [];
  const bridge = (baseLabel: string, base: number, drivers: Part[], endLabel: string, end: number): Step[] => {
    const steps: Step[] = [{ key: baseLabel, from: 0, to: base, kind: "abs" }];
    let acc = base;
    for (const d of drivers) {
      steps.push({ key: d.key, from: acc, to: acc + d.value, kind: d.value >= 0 ? "up" : "down" });
      acc += d.value;
    }
    steps.push({ key: endLabel, from: 0, to: end, kind: "abs" });
    return steps;
  };
  if (series.length >= 2) {
    const base = series[0];
    const cur = series[series.length - 1];
    const keys = partsOf(cur).map((p) => p.key);
    const drivers = keys.map((k) => ({ key: k, value: (valueAt(cur, k) ?? 0) - (valueAt(base, k) ?? 0) }));
    return bridge(base.label, total(partsOf(base)), drivers, cur.label, total(partsOf(cur)));
  }
  const c = value.compare;
  if (c && c.value !== null && c.value !== undefined && value.value !== null) {
    const pts = series[0]?.values ?? [];
    const end = pts.length ? pts[pts.length - 1].key : "Now";
    return bridge(c.year ? String(c.year) : "Base", c.value, [{ key: "Change", value: value.value - c.value }], end, value.value);
  }
  const pts = partsOf(series[0] ?? null);
  if (pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    return bridge(a.key, a.value, [{ key: "Change", value: b.value - a.value }], b.key, b.value);
  }
  return null;
}

/**
 * #209 review: the unit of the bridge's figures, read from the same data as `bridgeSteps`: by
 * scope, the unit both years' series share; compare, the bound value's; by year, the series'.
 */
export function bridgeUnit(value: ChartInput["value"]): string | null {
  const series = value.series ?? [];
  if (series.length >= 2) return sharedUnit([series[0], series[series.length - 1]], value.unit);
  const c = value.compare;
  if (c && c.value !== null && c.value !== undefined && value.value !== null) return value.unit ?? null;
  return seriesUnit(series[0], value.unit);
}

export function baseYearWaterfallChart(input: ChartInput): string {
  const { value, w, h, theme, options } = input;
  const steps = bridgeSteps(value);
  const unit = bridgeUnit(value);
  if (!steps) return emptyChart(w, h, "Needs the base year and the current year", theme);
  const scale = linearScale(Math.min(0, ...steps.map((s) => Math.min(s.from, s.to))), Math.max(...steps.map((s) => Math.max(s.from, s.to))), 4);
  const x0 = axisWidth(scale);
  const pw = w - x0;
  const band = pw / steps.length;
  const labels = steps.map((s) => {
    const d = s.to - s.from;
    return s.kind === "abs" ? formatNumber(s.to, "auto", unit) : `${d >= 0 ? "+" : "−"}${formatNumber(Math.abs(d), "auto", unit)}`;
  });
  // A step's bar over a plot [top, top + ph].
  const stepRect = (i: number, top: number, ph: number) => {
    const s = steps[i];
    const y1 = top + ph - scale.t(Math.max(s.from, s.to)) * ph;
    const y2 = top + ph - scale.t(Math.min(s.from, s.to)) * ph;
    return { x: x0 + band * i + band * 0.15, y: y1, w: band * 0.7, h: Math.max(0.5, y2 - y1) };
  };
  // #209 review: step labels may not meet each other, the tick labels or another step (svg.ts fitLabelRow); the bold base and current totals are kept first.
  const fit = fitLabelRow(
    (extra) => {
      if (options.showValues === false) return { labels: [] };
      const { top: te, ph: phe } = plotSpan(FONT * 1.4 + extra, h - FONT * 1.8);
      const obstacles = [...tickBoxes(scale, x0, te, phe), ...steps.map((_, i) => {
        const r = stepRect(i, te, phe);
        return rectBox(r.x, r.y, r.w, r.h, i);
      })];
      return { labels: steps.map((s, i) => ({ x: x0 + band * (i + 0.5), y: te + phe - scale.t(Math.max(s.from, s.to)) * phe - SMALL * 0.5, text: labels[i], bold: s.kind === "abs" })), obstacles };
    },
    w,
    h,
    // #209 round 4: a staggered row takes only the height the plot can spare; the plot never goes under PLOT_FLOOR.
    { x0, maxLift: h - FONT * 3.2 - tickRoom(scale) },
  );
  const { top, ph } = plotSpan(FONT * 1.4 + fit.extraTop, h - FONT * 1.8);
  let body = valueGridY(scale, x0, top, pw, ph, theme);
  steps.forEach((s, i) => {
    const r = stepRect(i, top, ph);
    const fill = s.kind === "abs" ? (i === 0 ? theme.colors.prior : theme.colors.primary) : s.kind === "up" ? theme.colors.bad : theme.colors.good;
    body += rect(r.x, r.y, r.w, r.h, fill, ` data-step="${s.kind}" data-key="${esc(s.key)}"`);
    if (i > 0 && i < steps.length - 1) {
      // A connector from the previous step's end.
      const yc = top + ph - scale.t(s.from) * ph;
      body += `<line x1="${n3(x0 + band * (i - 1) + band * 0.85)}" x2="${n3(x0 + band * i + band * 0.15)}" y1="${n3(yc)}" y2="${n3(yc)}" stroke="${theme.colors.muted}" stroke-width="0.6" stroke-dasharray="2 2"/>`;
    }
    const at = fit.labels[i];
    if (options.showValues !== false && at) body += text(at.x, at.y, labels[i], theme.colors.ink, { size: fit.size, anchor: "middle", weight: s.kind === "abs" ? 700 : undefined });
  });
  body += bandLabels(steps.map((s) => s.key), x0, band, top + ph + FONT * 1.2, theme);
  return `${svgOpen(w, h, input.label)}<g data-ghg-chart="base_year_waterfall" data-steps="${steps.length}">${body}</g></svg>`;
}

export function intensityLineChart(input: ChartInput): string {
  const { value, w, h, theme, options } = input;
  const s = value.series?.[value.series.length - 1];
  const pts = (s?.values ?? []).filter((v) => v.value !== null) as { key: string; value: number }[];
  if (!s || !pts.length) return emptyChart(w, h, "No data", theme);
  const vals = pts.map((p) => p.value);
  const scale = linearScale(Math.min(...vals), Math.max(...vals), 4, false);
  const unitH = value.unit ? SMALL * 1.6 : 0;
  const x0 = axisWidth(scale);
  const pw = w - x0 - SMALL * 2;
  const keys = s.values.map((v) => v.key);
  const band = pw / keys.length;
  const lineUnit = seriesUnit(s, value.unit);
  const ends = pts.map((p, i) => ({ p, i })).filter(({ i }) => options.showValues !== false && (i === 0 || i === pts.length - 1));
  // #209 review: the two end labels may not meet each other or the tick labels, or leave the plot (svg.ts fitLabelRow); the latest is kept first.
  const fit = fitLabelRow(
    (extra) => {
      const { top: te, ph: phe } = plotSpan(unitH + FONT * 1.2 + extra, h - FONT * 1.8, unitH);
      const labels = ends.map(({ p, i }) => ({ x: x0 + band * (keys.indexOf(p.key) + 0.5), y: te + phe - scale.t(p.value) * phe - SMALL * 0.9, text: formatNumber(p.value, "auto", lineUnit), bold: i === pts.length - 1 }));
      return { labels, obstacles: tickBoxes(scale, x0, te, phe) };
    },
    w,
    h,
    { x0, minY: unitH, maxLift: h - unitH - FONT * 3 - tickRoom(scale) },
  );
  const { top, ph } = plotSpan(unitH + FONT * 1.2 + fit.extraTop, h - FONT * 1.8, unitH);
  const xy = (k: string, v: number) => [x0 + band * (keys.indexOf(k) + 0.5), top + ph - scale.t(v) * ph] as const;
  let body = value.unit ? text(0, SMALL, clip(value.unit, Math.floor(w / (SMALL * 0.55))), theme.colors.muted, { size: SMALL }) : "";
  body += valueGridY(scale, x0, top, pw, ph, theme);
  const color = options.colors === "brand" ? theme.series[0] : theme.colors.primary;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${n3(xy(p.key, p.value)[0])} ${n3(xy(p.key, p.value)[1])}`).join("");
  body += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  pts.forEach((p, i) => {
    const [x, y] = xy(p.key, p.value);
    const last = i === pts.length - 1;
    body += `<circle cx="${n3(x)}" cy="${n3(y)}" r="${last ? 3 : 2.2}" fill="${last ? theme.colors.accent : color}" data-key="${esc(p.key)}"/>`;
    const li = ends.findIndex((e) => e.i === i);
    const at = li >= 0 ? fit.labels[li] : null;
    if (at) body += text(at.x, at.y, formatNumber(p.value, "auto", lineUnit), theme.colors.ink, { size: fit.size, anchor: "middle", weight: last ? 700 : undefined });
  });
  body += bandLabels(keys, x0, band, top + ph + FONT * 1.2, theme);
  return `${svgOpen(w, h, input.label)}<g data-ghg-chart="intensity_line" data-points="${pts.length}">${body}</g></svg>`;
}
