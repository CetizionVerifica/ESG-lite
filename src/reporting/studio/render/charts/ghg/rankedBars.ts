/**
 * DS-8 · ranked horizontal bars: `category_bars` (Scope 3 categories, top n +
 * "Other") and `site_bars` (sites). Sorted largest first with "Other" last,
 * the current year in colour; with several years the prior year is a thin
 * bar under each (grey with `greyPrior`, the default). The total comes from
 * the server's display; only the three biggest bars carry a value label.
 * Binding: ghg · breakdown scope3_category (category_bars) or site (site_bars) · top n.
 */
import { formatNumber } from "../../format";
import { esc, n3 } from "../../util";
import { valueGridX } from "../axis";
import { linearScale } from "../scale";
import { SMALL, emptyChart, rect, svgOpen, text, type ChartInput } from "../svg";
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

  const head = headline(value, theme);
  const legendItems = prior
    ? [
        { label: cur?.label ?? "", color: options.colors === "brand" ? theme.series[0] : kind === "category_bars" ? theme.colors.s3 : theme.colors.primary },
        { label: prior.label, color: options.greyPrior === false ? mix(theme.colors.primary, theme.colors.paper, 0.55) : theme.colors.prior },
      ]
    : [];
  const leg = options.showLegend === false ? { svg: "", h: 0 } : wrapLegend(legendItems, w, 0, theme);
  const all = [...ps.map((p) => p.value), ...ps.map((p) => priorOf(p.key) ?? 0)];
  const scale = linearScale(Math.min(0, ...all), Math.max(...all), 4);
  const labelChars = Math.max(6, Math.floor((w * 0.34) / (SMALL * 0.55)));
  const labelW = Math.min(w * 0.36, Math.max(...ps.map((p) => Math.min(p.key.length, labelChars))) * SMALL * 0.55 + SMALL);
  const x0 = labelW;
  const pw = w - x0 - (showValues ? SMALL * 4.5 : SMALL);
  const top = head.h;
  const ph = h - top - leg.h - SMALL * 2;
  const band = ph / ps.length;
  let body = head.svg + valueGridX(scale, x0, top, pw, ph, theme);
  ps.forEach((p, i) => {
    const y = top + band * i;
    const color = kind === "category_bars" && options.colors !== "brand" ? (p.key === "Other" ? theme.colors.muted : theme.colors.s3) : partColor({ theme, options: { ...options, colors: "brand" } }, p.key, 0);
    body += text(x0 - SMALL * 0.5, y + band / 2, clip(p.key, labelChars), theme.colors.ink, { size: SMALL, anchor: "end", baseline: "middle" });
    const a = x0 + scale.t(Math.min(0, p.value)) * pw;
    const b = x0 + scale.t(Math.max(0, p.value)) * pw;
    const pv = priorOf(p.key);
    const mainH = prior ? band * 0.5 : band * 0.66;
    body += rect(a, y + band * 0.14, b - a, mainH, color, ` data-part="${esc(p.key)}"`);
    if (prior && pv !== null) {
      const pa = x0 + scale.t(Math.min(0, pv)) * pw;
      const pb = x0 + scale.t(Math.max(0, pv)) * pw;
      body += rect(pa, y + band * 0.14 + mainH + band * 0.04, pb - pa, band * 0.18, legendItems[1].color, ` data-prior="${esc(prior.label)}"`);
    }
    if (showValues && labelled.has(i)) body += text(b + SMALL * 0.4, y + band * 0.14 + mainH / 2, formatNumber(p.value), theme.colors.ink, { size: SMALL, baseline: "middle", weight: i === 0 ? 700 : undefined });
  });
  body += `<g transform="translate(0 ${n3(h - leg.h)})">${leg.svg}</g>`;
  return `${svgOpen(w, h, input.label)}<g data-ghg-chart="${kind}" data-bars="${ps.length}">${body}</g></svg>`;
}

export const categoryBarsChart = (input: ChartInput): string => rankedBars(input, "category_bars");
export const siteBarsChart = (input: ChartInput): string => rankedBars(input, "site_bars");
