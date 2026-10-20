/**
 * DS-1 · `target_bars`: one bar per year (first series), a dashed baseline and
 * a target marker with its year, from `value.target`.
 */
import { formatNumber } from "../format";
import { n3 } from "../util";
import { axisWidth, bandLabels, valueGridY } from "./axis";
import { linearScale } from "./scale";
import { FONT, SMALL, emptyChart, rect, svgOpen, text, type ChartInput } from "./svg";

export function targetBarsChart(input: ChartInput): string {
  const { value, w, h, theme, options } = input;
  const pts = value.series?.[0]?.values ?? [];
  const target = value.target ?? null;
  if (!pts.length) return emptyChart(w, h, "No data", theme);
  const marks = [target?.baseline, target?.value].filter((v): v is number => typeof v === "number");
  const scale = linearScale(0, Math.max(...pts.map((p) => p.value ?? 0), ...marks));
  const x0 = axisWidth(scale);
  const pw = w - x0 - (target?.year ? FONT * 3 : 0);
  const top = FONT * 1.2;
  const ph = h - top - FONT * 1.8;
  const band = pw / pts.length;
  let body = valueGridY(scale, x0, top, pw, ph, theme);
  pts.forEach((p, i) => {
    if (p.value === null) return;
    const y = top + ph - scale.t(p.value) * ph;
    body += rect(x0 + band * i + band * 0.2, y, band * 0.6, top + ph - y, i === pts.length - 1 ? theme.colors.primary : theme.colors.prior);
    body += text(x0 + band * (i + 0.5), y - SMALL * 0.5, formatNumber(p.value), theme.colors.ink, { size: SMALL, anchor: "middle" });
  });
  if (options.showTarget !== false && typeof target?.baseline === "number") {
    const y = top + ph - scale.t(target.baseline) * ph;
    body += `<line x1="${n3(x0)}" x2="${n3(x0 + pw)}" y1="${n3(y)}" y2="${n3(y)}" stroke="${theme.colors.muted}" stroke-dasharray="4 3" stroke-width="1"/>`;
    body += text(x0 + pw, y - SMALL * 0.4, "Baseline", theme.colors.muted, { size: SMALL, anchor: "end" });
  }
  if (options.showTarget !== false && typeof target?.value === "number") {
    const y = top + ph - scale.t(target.value) * ph;
    body += `<line x1="${n3(x0)}" x2="${n3(w - FONT * 0.5)}" y1="${n3(y)}" y2="${n3(y)}" stroke="${theme.colors.accent}" stroke-width="1.6" data-target="${n3(target.value)}"/>`;
    body += text(w, y - SMALL * 0.4, `Target${target.year ? ` ${target.year}` : ""}`, theme.colors.accent, { size: SMALL, anchor: "end", weight: 700 });
  }
  body += bandLabels(pts.map((p) => p.key), x0, band, top + ph + FONT * 1.2, theme);
  return `${svgOpen(w, h, input.label)}${body}</svg>`;
}
