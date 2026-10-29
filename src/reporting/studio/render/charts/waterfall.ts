/**
 * DS-1 · `waterfall`: base → drivers → current. The first and last keys of the
 * first series are absolute values; the keys between are changes. The last
 * bar is drawn at the resolved end value, so start and end always equal the
 * data (a driver gap shows as a visible step, never a re-computed total).
 */
import { formatNumber } from "../format";
import { n3 } from "../util";
import { axisWidth, bandLabels, valueGridY } from "./axis";
import { linearScale } from "./scale";
import { FONT, SMALL, emptyChart, insideX, rect, svgOpen, text, type ChartInput } from "./svg";

export function waterfallChart(input: ChartInput): string {
  const { value, w, h, theme } = input;
  const pts = value.series?.[0]?.values ?? [];
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
  const top = FONT * 1.2;
  const ph = h - top - FONT * 1.8;
  const band = pw / steps.length;
  let body = valueGridY(scale, x0, top, pw, ph, theme);
  steps.forEach((s, i) => {
    const y1 = top + ph - scale.t(Math.max(s.from, s.to)) * ph;
    const y2 = top + ph - scale.t(Math.min(s.from, s.to)) * ph;
    // Emissions: a rise is bad, a fall is good.
    const fill = s.kind === "abs" ? theme.colors.primary : s.kind === "up" ? theme.colors.bad : theme.colors.good;
    body += rect(x0 + band * i + band * 0.15, y1, band * 0.7, y2 - y1, fill, ` data-step="${s.kind}" data-from="${n3(s.from)}" data-to="${n3(s.to)}"`);
    const label = s.kind === "abs" ? formatNumber(s.to, "auto", value.unit) : `${s.to - s.from >= 0 ? "+" : "−"}${formatNumber(Math.abs(s.to - s.from), "auto", value.unit)}`;
    body += text(insideX(x0 + band * (i + 0.5), label, w), y1 - SMALL * 0.5, label, theme.colors.ink, { size: SMALL, anchor: "middle" });
  });
  body += bandLabels(steps.map((s) => s.key), x0, band, top + ph + FONT * 1.2, theme);
  return `${svgOpen(w, h, input.label)}${body}</svg>`;
}
