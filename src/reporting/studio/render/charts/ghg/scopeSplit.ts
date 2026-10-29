/**
 * DS-8 · `scope_split`: Scope 1, 2 and 3 of the current year as a 100 % bar
 * (default) or a donut (`options.variant: 'donut'`). The total comes from the
 * server's display; each segment shows its share; the legend names the scope
 * and its tCO₂e. `options.basisNote` (default on) adds "Scope 2:
 * location-based" (market-based isn't recorded, D7).
 * Binding: ghg · metric total · breakdown scope.
 */
import { formatNumber } from "../../format";
import { esc, n3 } from "../../util";
import { FONT, SMALL, emptyChart, rect, svgOpen, text, type ChartInput } from "../svg";
import { biggest, currentSeries, headline, partColor, partsOf, pct, total, wrapLegend } from "./common";

export const SCOPE2_BASIS_NOTE = "Scope 2: location-based. Market-based isn't recorded.";

export function scopeSplitChart(input: ChartInput): string {
  const { value, w, h, theme, options } = input;
  const ps = partsOf(currentSeries(value)).filter((p) => p.value > 0);
  const sum = total(ps);
  if (!ps.length || sum <= 0) return emptyChart(w, h, "No data", theme);
  const colors = ps.map((p, i) => partColor(input, p.key, i));
  const labelled = biggest(ps, 3);
  const note = options.basisNote !== false;
  const legendItems = ps.map((p, i) => ({ label: `${p.key} ${formatNumber(p.value, "auto", value.unit)}`, color: colors[i] }));
  let body = "";

  if (options.variant === "donut") {
    const leg = options.showLegend === false ? { svg: "", h: 0 } : wrapLegend(legendItems, w, 0, theme);
    const noteH = note ? SMALL * 1.6 : 0;
    const plotH = h - leg.h - noteH;
    const r = Math.max(FONT, Math.min(w, plotH) / 2 - FONT * 1.6);
    const cx = w / 2;
    const cy = plotH / 2;
    const inner = r * 0.62;
    let a0 = -Math.PI / 2;
    const pt = (rad: number, a: number) => `${n3(cx + rad * Math.cos(a))} ${n3(cy + rad * Math.sin(a))}`;
    ps.forEach((p, i) => {
      const a1 = a0 + (p.value / sum) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d =
        ps.length === 1
          ? `M${pt(r, 0)}A${n3(r)} ${n3(r)} 0 1 1 ${pt(r, Math.PI)}A${n3(r)} ${n3(r)} 0 1 1 ${pt(r, 0)}ZM${pt(inner, 0)}A${n3(inner)} ${n3(inner)} 0 1 0 ${pt(inner, Math.PI)}A${n3(inner)} ${n3(inner)} 0 1 0 ${pt(inner, 0)}Z`
          : `M${pt(r, a0)}A${n3(r)} ${n3(r)} 0 ${large} 1 ${pt(r, a1)}L${pt(inner, a1)}A${n3(inner)} ${n3(inner)} 0 ${large} 0 ${pt(inner, a0)}Z`;
      body += `<path d="${d}" fill="${colors[i]}" fill-rule="evenodd" stroke="${theme.colors.paper}" stroke-width="1" data-part="${esc(p.key)}"><title>${esc(p.key)}</title></path>`;
      const share = p.value / sum;
      if (labelled.has(i) && share >= 0.04) {
        const mid = (a0 + a1) / 2;
        body += text(cx + (r + FONT) * Math.cos(mid), cy + (r + FONT) * Math.sin(mid), pct(share), theme.colors.ink, { size: SMALL, anchor: Math.cos(mid) > 0.2 ? "start" : Math.cos(mid) < -0.2 ? "end" : "middle", baseline: "middle" });
      }
      a0 = a1;
    });
    if (value.display) body += text(cx, cy, value.display, theme.colors.ink, { anchor: "middle", baseline: "middle", weight: 700, size: FONT * 1.4 });
    if (value.unit) body += text(cx, cy + FONT * 1.4, value.unit, theme.colors.muted, { anchor: "middle", baseline: "middle", size: SMALL });
    body += `<g transform="translate(0 ${n3(plotH)})">${leg.svg}</g>`;
    if (note) body += text(0, h - SMALL * 0.4, SCOPE2_BASIS_NOTE, theme.colors.muted, { size: SMALL });
    return `${svgOpen(w, h, input.label)}<g data-ghg-chart="scope_split" data-variant="donut">${body}</g></svg>`;
  }

  // 100 % bar.
  const head = headline(value, theme);
  const barY = head.h + SMALL * 0.4;
  const barH = Math.min(FONT * 3, Math.max(FONT * 1.5, (h - head.h) * 0.35));
  let x = 0;
  ps.forEach((p, i) => {
    const pw = (p.value / sum) * w;
    body += rect(x, barY, pw, barH, colors[i], ` stroke="${theme.colors.paper}" stroke-width="1" data-part="${esc(p.key)}"`);
    const share = p.value / sum;
    if (labelled.has(i) && share >= 0.08) body += text(x + pw / 2, barY + barH / 2, pct(share), "#FFFFFF", { size: SMALL, anchor: "middle", baseline: "middle", weight: 700 });
    x += pw;
  });
  const leg = options.showLegend === false ? { svg: "", h: 0 } : wrapLegend(legendItems, w, barY + barH + SMALL * 0.6, theme);
  body += head.svg + leg.svg;
  if (note) body += text(0, Math.min(h - SMALL * 0.4, barY + barH + SMALL * 0.6 + leg.h + SMALL * 1.2), SCOPE2_BASIS_NOTE, theme.colors.muted, { size: SMALL });
  return `${svgOpen(w, h, input.label)}<g data-ghg-chart="scope_split" data-variant="bar">${body}</g></svg>`;
}
