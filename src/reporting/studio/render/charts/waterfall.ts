/**
 * DS-1 · `waterfall`: base → drivers → current. The first and last keys of the
 * first series are absolute values; the keys between are changes. The last
 * bar is drawn at the resolved end value, so start and end always equal the
 * data (a driver gap shows as a visible step, never a re-computed total).
 */
import { formatNumber, seriesUnit } from "../format";
import { n3 } from "../util";
import { axisWidth, bandLabels, tickBoxes, tickRoom, valueGridY } from "./axis";
import { linearScale } from "./scale";
import { FONT, SMALL, emptyChart, fitLabelRow, plotSpan, rect, rectBox, svgOpen, text, type ChartInput } from "./svg";

export function waterfallChart(input: ChartInput): string {
  const { value, w, h, theme } = input;
  const pts = value.series?.[0]?.values ?? [];
  const unit = seriesUnit(value.series?.[0], value.unit); // #209 review: the series' own unit
  if (pts.length < 2 || pts[0].value === null || pts[pts.length - 1].value === null) return emptyChart(w, h, "No data", theme);
  const start = pts[0].value as number;
  const end = pts[pts.length - 1].value as number;
  const steps: { key: string; from: number; to: number; kind: "abs" | "up" | "down" }[] = [{ key: pts[0].key, from: 0, to: start, kind: "abs" }];
  let acc = start;
  for (const p of pts.slice(1, -1)) {
    const d = p.value ?? 0;
    steps.push({ key: p.key, from: acc, to: acc + d, kind: d >= 0 ? "up" : "down" });
    acc += d;
  }
  steps.push({ key: pts[pts.length - 1].key, from: 0, to: end, kind: "abs" });
  const scale = linearScale(Math.min(0, ...steps.map((s) => Math.min(s.from, s.to))), Math.max(...steps.map((s) => Math.max(s.from, s.to))));
  const x0 = axisWidth(scale);
  const pw = w - x0;
  const band = pw / steps.length;
  const labels = steps.map((s) => (s.kind === "abs" ? formatNumber(s.to, "auto", unit) : `${s.to - s.from >= 0 ? "+" : "−"}${formatNumber(Math.abs(s.to - s.from), "auto", unit)}`));
  // A step's bar over a plot [top, top + ph].
  const stepRect = (i: number, top: number, ph: number) => {
    const s = steps[i];
    const y1 = top + ph - scale.t(Math.max(s.from, s.to)) * ph;
    const y2 = top + ph - scale.t(Math.min(s.from, s.to)) * ph;
    return { x: x0 + band * i + band * 0.15, y: y1, w: band * 0.7, h: y2 - y1 };
  };
  // #209 review: step labels may not meet each other, the tick labels or another step (svg.ts fitLabelRow); the start and end totals are kept first.
  const fit = fitLabelRow(
    (extra) => {
      const { top: te, ph: phe } = plotSpan(FONT * 1.2 + extra, h - FONT * 1.8);
      const obstacles = [...tickBoxes(scale, x0, te, phe), ...steps.map((_, i) => {
        const r = stepRect(i, te, phe);
        return rectBox(r.x, r.y, r.w, r.h, i);
      })];
      return { labels: steps.map((s, i) => ({ x: x0 + band * (i + 0.5), y: te + phe - scale.t(Math.max(s.from, s.to)) * phe - SMALL * 0.5, text: labels[i], priority: s.kind === "abs" ? 1 : 0 })), obstacles };
    },
    w,
    h,
    // #209 round 4: a staggered row takes only the height the plot can spare; the plot never goes under PLOT_FLOOR.
    { x0, maxLift: h - FONT * 3 - tickRoom(scale) },
  );
  const { top, ph } = plotSpan(FONT * 1.2 + fit.extraTop, h - FONT * 1.8);
  let body = valueGridY(scale, x0, top, pw, ph, theme);
  steps.forEach((s, i) => {
    const r = stepRect(i, top, ph);
    // Emissions: a rise is bad, a fall is good.
    const fill = s.kind === "abs" ? theme.colors.primary : s.kind === "up" ? theme.colors.bad : theme.colors.good;
    body += rect(r.x, r.y, r.w, r.h, fill, ` data-step="${s.kind}" data-from="${n3(s.from)}" data-to="${n3(s.to)}"`);
    const at = fit.labels[i];
    if (at) body += text(at.x, at.y, labels[i], theme.colors.ink, { size: fit.size, anchor: "middle" });
  });
  body += bandLabels(steps.map((s) => s.key), x0, band, top + ph + FONT * 1.2, theme);
  return `${svgOpen(w, h, input.label)}${body}</svg>`;
}
