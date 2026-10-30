/**
 * DS-1 · part-of-whole charts: `donut`, `share_bar` and `dot_grid` (100 units).
 * Parts come from the first series' values (key = part), or from one value
 * per series. Labels under 4 % share are dropped (collision avoidance).
 */
import { formatNumber, sharedUnit } from "../format";
import type { Theme } from "../theme";
import type { RenderValue } from "../types";
import { esc, n3 } from "../util";
import { FONT, SMALL, boxesMeet, emptyChart, fitLines, labelBox, labelWidth, legend, rect, seriesColor, svgOpen, text, type ChartInput, type LabelBox } from "./svg";

export const parts = (v: RenderValue, theme: Theme): { label: string; value: number; color: string }[] => {
  const series = v.series ?? [];
  const raw =
    series.length === 1
      ? series[0].values.map((p) => ({ label: p.key, value: p.value ?? 0 }))
      : series.map((s) => ({ label: s.label, value: s.values.reduce((a, p) => a + (p.value ?? 0), 0) }));
  return raw.filter((p) => p.value > 0).map((p, i) => ({ ...p, color: seriesColor(theme, p.label, i) }));
};

const pct = (x: number): string => `${formatNumber(x * 100, x * 100 < 10 ? "1dp" : "int")}%`;

/**
 * A ring's outer radius in a w × plotH plot: FONT × 1.6 of room above and below for the share labels, and at the sides
 * room for the widest of them (`labels`) after a FONT gap, so a narrow, tall donut's side labels aren't cut (#209 review).
 */
export const ringRadius = (w: number, plotH: number, labels: string[]): number =>
  Math.min(labels.length ? w / 2 - FONT - Math.max(...labels.map((l) => labelWidth(l))) - SMALL * 0.2 : w / 2 - FONT * 1.6, plotH / 2 - FONT * 1.6);

/**
 * #209 review: where a ring's share labels go (outside the ring, at each part's middle angle), biggest share first; a
 * label that would meet one already placed (two thin neighbouring parts) is left out, never drawn over it. `parts`
 * are in ring order with their share and whether the chart labels them.
 */
export function ringLabels(parts: { share: number; show: boolean }[], cx: number, cy: number, r: number): ({ x: number; y: number; anchor: "start" | "middle" | "end"; text: string } | null)[] {
  let a0 = -Math.PI / 2;
  const spots = parts.map((p) => {
    const mid = a0 + p.share * Math.PI;
    a0 += p.share * Math.PI * 2;
    const anchor: "start" | "middle" | "end" = Math.cos(mid) > 0.2 ? "start" : Math.cos(mid) < -0.2 ? "end" : "middle";
    return { x: cx + (r + FONT) * Math.cos(mid), y: cy + (r + FONT) * Math.sin(mid), anchor, text: pct(p.share) };
  });
  const out: ({ x: number; y: number; anchor: "start" | "middle" | "end"; text: string } | null)[] = parts.map(() => null);
  const placed: LabelBox[] = [];
  const order = parts.map((_, i) => i).filter((i) => parts[i].show).sort((a, b) => parts[b].share - parts[a].share || a - b);
  for (const i of order) {
    const box = labelBox(spots[i].x, spots[i].y, spots[i].text, SMALL, { anchor: spots[i].anchor, baseline: "middle" });
    if (placed.some((q) => boxesMeet(q, box, SMALL * 0.15))) continue;
    placed.push(box);
    out[i] = spots[i];
  }
  return out;
}

/** Sizes the figure in a donut's hole may take: 10.5 pt (FONT × 1.4) down to 6.5 pt (SMALL). */
export const CENTRE_STEPS = [1.4, 1.3, 1.2, 1.1, 1].map((k) => FONT * k).concat(SMALL);

/**
 * #209 review: the figure in a donut's hole (the server's display, bold) and its unit under it, at
 * the largest size whose boxes (measured, metrics.ts) stay inside the hole of radius `inner` with
 * some air; null when even the smallest doesn't fit, and the chart prints the figure under the donut
 * (`underDonut`). Never drawn over the ring.
 */
export function donutCentre(figure: string, unit: string | null | undefined, cx: number, cy: number, inner: number, theme: Theme): string | null {
  const room = inner - Math.max(1, inner * 0.06);
  const inside = (b: LabelBox) => [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].every(([x, y]) => Math.hypot(x - cx, y - cy) <= room);
  for (const size of CENTRE_STEPS) {
    const uy = cy + Math.max(size, (size + SMALL) / 2 + SMALL * 0.2);
    if (figure && !inside(labelBox(cx, cy, figure, size, { anchor: "middle", bold: true, baseline: "middle" }))) continue;
    if (unit && !inside(labelBox(cx, uy, unit, SMALL, { anchor: "middle", baseline: "middle" }))) continue;
    return (
      (figure ? text(cx, cy, figure, theme.colors.ink, { anchor: "middle", baseline: "middle", weight: 700, size }) : "") +
      (unit ? text(cx, uy, unit, theme.colors.muted, { anchor: "middle", baseline: "middle", size: SMALL }) : "")
    );
  }
  return null;
}

/**
 * The figure and unit under a donut whose hole is too small for them: "12,480.000 tCO₂e" in bold,
 * centred on one line at FONT (a step smaller, or the unit on a second line, when the chart is
 * narrow). `h` is the height to take from the plot; `svg(y)` draws it from y down.
 */
export function underDonut(figure: string, unit: string | null | undefined, w: number, theme: Theme): { h: number; svg: (y: number) => string } {
  const layouts = unit && figure ? [[`${figure} ${unit}`], [figure, unit]] : [[figure || unit || ""]];
  const { lines, size } = fitLines(layouts, w, [FONT, FONT * 0.9, SMALL], true);
  const lh = size * 1.2;
  return {
    h: size * 1.4 + (lines.length - 1) * lh,
    svg: (y) => lines.map((l, i) => text(w / 2, y + size + i * lh, l, theme.colors.ink, { anchor: "middle", weight: 700, size })).join(""),
  };
}

export function donutChart(input: ChartInput): string {
  const { value, w, h, theme } = input;
  const ps = parts(value, theme);
  const total = ps.reduce((a, p) => a + p.value, 0);
  if (!ps.length || total <= 0) return emptyChart(w, h, "No data", theme);
  const legendH = SMALL * 2;
  const figure = value.display || formatNumber(total, "auto", sharedUnit(value.series ?? [], value.unit));
  // #209 review: the figure goes in the hole when it fits there (donutCentre), else under the donut.
  const sideLabels = ps.filter((p) => p.value / total >= 0.04).map((p) => pct(p.value / total));
  const geom = (underH: number) => {
    const r = ringRadius(w, h - legendH - underH, sideLabels);
    return { r, cx: w / 2, cy: (h - legendH - underH) / 2, inner: r * 0.62 };
  };
  let { r, cx, cy, inner } = geom(0);
  let centre = donutCentre(figure, value.unit, cx, cy, inner, theme);
  let under = "";
  if (centre === null) {
    const u = underDonut(figure, value.unit, w, theme);
    ({ r, cx, cy, inner } = geom(u.h));
    under = u.svg(h - legendH - u.h);
    centre = "";
  }
  const shareLabels = ringLabels(ps.map((p) => ({ share: p.value / total, show: p.value / total >= 0.04 })), cx, cy, r);
  let a0 = -Math.PI / 2;
  let body = "";
  for (const [pi, p] of ps.entries()) {
    const a1 = a0 + (p.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const pt = (rad: number, a: number) => `${n3(cx + rad * Math.cos(a))} ${n3(cy + rad * Math.sin(a))}`;
    const d =
      ps.length === 1
        ? `M${pt(r, 0)}A${n3(r)} ${n3(r)} 0 1 1 ${pt(r, Math.PI)}A${n3(r)} ${n3(r)} 0 1 1 ${pt(r, 0)}ZM${pt(inner, 0)}A${n3(inner)} ${n3(inner)} 0 1 0 ${pt(inner, Math.PI)}A${n3(inner)} ${n3(inner)} 0 1 0 ${pt(inner, 0)}Z`
        : `M${pt(r, a0)}A${n3(r)} ${n3(r)} 0 ${large} 1 ${pt(r, a1)}L${pt(inner, a1)}A${n3(inner)} ${n3(inner)} 0 ${large} 0 ${pt(inner, a0)}Z`;
    body += `<path d="${d}" fill="${p.color}" fill-rule="evenodd" stroke="${theme.colors.paper}" stroke-width="1"><title>${esc(p.label)}</title></path>`;
    const sl = shareLabels[pi];
    if (sl) body += text(sl.x, sl.y, sl.text, theme.colors.ink, { size: SMALL, anchor: sl.anchor, baseline: "middle" });
    a0 = a1;
  }
  body += centre + under;
  body += legend(ps, w, h - SMALL * 0.3, theme);
  return `${svgOpen(w, h, input.label)}${body}</svg>`;
}

export function shareBarChart(input: ChartInput): string {
  const { value, w, h, theme } = input;
  const ps = parts(value, theme);
  const total = ps.reduce((a, p) => a + p.value, 0);
  if (!ps.length || total <= 0) return emptyChart(w, h, "No data", theme);
  const barH = Math.min(h * 0.45, FONT * 3);
  let x = 0;
  let body = "";
  for (const p of ps) {
    const pw = (p.value / total) * w;
    body += rect(x, 0, pw, barH, p.color, ` stroke="${theme.colors.paper}" stroke-width="1"`);
    if (p.value / total >= 0.04) body += text(x + pw / 2, barH / 2, pct(p.value / total), "#FFFFFF", { size: SMALL, anchor: "middle", baseline: "middle", weight: 700 });
    x += pw;
  }
  body += legend(ps, w, barH + SMALL * 2.2, theme);
  return `${svgOpen(w, h, input.label)}${body}</svg>`;
}

export function dotGridChart(input: ChartInput): string {
  const { value, w, h, theme } = input;
  let share: number | null = null;
  if (value.progress !== undefined && value.progress !== null) share = value.progress;
  else if (value.value !== null && value.value >= 0 && value.value <= 1) share = value.value;
  else {
    const ps = parts(value, theme);
    const total = ps.reduce((a, p) => a + p.value, 0);
    if (ps.length && total > 0) share = ps[0].value / total;
  }
  if (share === null) return emptyChart(w, h, "No data", theme);
  const filled = Math.round(Math.min(1, Math.max(0, share)) * 100);
  const cell = Math.min(w, h) / 10;
  const ox = (w - cell * 10) / 2;
  const oy = (h - cell * 10) / 2;
  let body = "";
  for (let i = 0; i < 100; i++) {
    const cx = ox + (i % 10) * cell + cell / 2;
    const cy = oy + Math.floor(i / 10) * cell + cell / 2;
    body += `<circle cx="${n3(cx)}" cy="${n3(cy)}" r="${n3(cell * 0.38)}" fill="${i < filled ? theme.colors.primary : theme.colors.border}"/>`;
  }
  return `${svgOpen(w, h, input.label)}<g data-filled="${filled}">${body}</g></svg>`;
}
