/**
 * DS-8 · `scope_split`: Scope 1, 2 and 3 of the current year as a 100 % bar
 * (default) or a donut (`options.variant: 'donut'`). The total comes from the
 * server's display; each segment shows its share; the legend names the scope
 * and its tCO₂e. `options.basisNote` (default on) adds "Scope 2:
 * location-based" (market-based isn't recorded, D7).
 * Binding: ghg · metric total · breakdown scope.
 */
import { formatNumber, seriesUnit } from "../../format";
import { esc, n3 } from "../../util";
import { FONT, LABEL_ASCENT, SMALL, emptyChart, rect, svgOpen, text, type ChartInput } from "../svg";
import { biggest, currentSeries, headline, partColor, partsOf, pct, total, wrapLegend } from "./common";

export const SCOPE2_BASIS_NOTE = "Scope 2: location-based. Market-based isn't recorded.";
/** The note's short form, when the full one is wider than the chart. */
export const SCOPE2_BASIS_NOTE_SHORT = "Scope 2: location-based.";

export function scopeSplitChart(input: ChartInput): string {
  const { value, w, h, theme, options } = input;
  const cur = currentSeries(value);
  const ps = partsOf(cur).filter((p) => p.value > 0);
  const sum = total(ps);
  if (!ps.length || sum <= 0) return emptyChart(w, h, "No data", theme);
  const colors = ps.map((p, i) => partColor(input, p.key, i));
  const labelled = biggest(ps, 3);
  const note = options.basisNote !== false;
  const legendItems = ps.map((p, i) => ({ label: `${p.key} ${formatNumber(p.value, "auto", seriesUnit(cur, value.unit))}`, color: colors[i] }));
  // The basis note, short when the full one is wider than the chart (#209 review).
  const noteText = note ? (SCOPE2_BASIS_NOTE.length * SMALL * 0.55 <= w ? SCOPE2_BASIS_NOTE : SCOPE2_BASIS_NOTE_SHORT) : "";
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
    if (note) body += text(0, h - SMALL * 0.4, noteText, theme.colors.muted, { size: SMALL });
    return `${svgOpen(w, h, input.label)}<g data-ghg-chart="scope_split" data-variant="donut">${body}</g></svg>`;
  }

  // 100 % bar. #209 review: the legend's real height (3-decimal values wrap it onto more lines) is reserved before the note. When
  // they don't fit under the bar, in order: the bar gives up height (its share labels go when it is thinner than they are), the
  // note goes, the legend keeps the names without the values, then the legend goes. Nothing overlaps or leaves the chart.
  const head = headline(value, theme);
  const barY = head.h + SMALL * 0.4;
  // The note's baseline sits 1.2 lines under the legend, or higher up to the chart's bottom, but never closer to the legend's last
  // line (its text ends 0.69 SMALL above the legend's height) than a gap and the note's ascent.
  const noteMinGap = -0.69 * SMALL + 0.15 * SMALL + LABEL_ASCENT * SMALL;
  const noteH = noteMinGap + SMALL * 0.4;
  const MIN_BAR = SMALL * 0.5;
  const want = Math.min(FONT * 3, Math.max(FONT * 1.5, (h - head.h) * 0.35));
  const nameItems = legendItems.map((it, i) => ({ ...it, label: ps[i].key }));
  const legends = options.showLegend === false ? [[]] : [legendItems, nameItems, []];
  const room = (items: typeof legendItems, withNote: boolean) => h - barY - SMALL * 0.6 - (items.length ? wrapLegend(items, w, 0, theme).h : 0) - (withNote ? noteH : 0);
  const plans = legends.flatMap((items) => [...(note ? [{ items, withNote: true }] : []), { items, withNote: false }]);
  const plan = plans.find((pl) => room(pl.items, pl.withNote) >= MIN_BAR) ?? plans[plans.length - 1];
  const showNote = plan.withNote;
  const barH = Math.max(MIN_BAR, Math.min(want, room(plan.items, showNote)));
  const sharesFit = barH >= SMALL * 1.1;
  let x = 0;
  ps.forEach((p, i) => {
    const pw = (p.value / sum) * w;
    body += rect(x, barY, pw, barH, colors[i], ` stroke="${theme.colors.paper}" stroke-width="1" data-part="${esc(p.key)}"`);
    const share = p.value / sum;
    if (sharesFit && labelled.has(i) && share >= 0.08) body += text(x + pw / 2, barY + barH / 2, pct(share), "#FFFFFF", { size: SMALL, anchor: "middle", baseline: "middle", weight: 700 });
    x += pw;
  });
  const leg = plan.items.length ? wrapLegend(plan.items, w, barY + barH + SMALL * 0.6, theme) : { svg: "", h: 0 };
  body += head.svg + leg.svg;
  if (showNote) body += text(0, Math.min(h - SMALL * 0.4, barY + barH + SMALL * 0.6 + leg.h + SMALL * 1.2), noteText, theme.colors.muted, { size: SMALL });
  return `${svgOpen(w, h, input.label)}<g data-ghg-chart="scope_split" data-variant="bar">${body}</g></svg>`;
}
