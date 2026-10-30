/**
 * DS-1 · part-of-whole charts: `donut`, `share_bar` and `dot_grid` (100 units).
 * Parts come from the first series' values (key = part), or from one value
 * per series. Labels under 4 % share are dropped (collision avoidance).
 */
import { formatNumber, sharedUnit } from "../format";
import type { Theme } from "../theme";
import type { RenderValue } from "../types";
import { esc, n3 } from "../util";
import { FONT, INK_GAP, SMALL, boxesMeet, emptyChart, fitLines, inkBox, labelBox, legend, rect, seriesColor, svgOpen, text, type ChartInput, type LabelBox } from "./svg";

export const parts = (v: RenderValue, theme: Theme): { label: string; value: number; color: string }[] => {
  const series = v.series ?? [];
  const raw =
    series.length === 1
      ? series[0].values.map((p) => ({ label: p.key, value: p.value ?? 0 }))
      : series.map((s) => ({ label: s.label, value: s.values.reduce((a, p) => a + (p.value ?? 0), 0) }));
  return raw.filter((p) => p.value > 0).map((p, i) => ({ ...p, color: seriesColor(theme, p.label, i) }));
};

const pct = (x: number): string => `${formatNumber(x * 100, x * 100 < 10 ? "1dp" : "int")}%`;

/** A part of a ring: its share of the whole, and whether the chart labels it. */
export interface RingPart {
  share: number;
  show: boolean;
}
type Anchor = "start" | "middle" | "end";
/** The middle angle of each part (radians, from 12 o'clock clockwise, as the arcs are drawn). */
const midAngles = (parts: RingPart[]): number[] => {
  let a0 = -Math.PI / 2;
  return parts.map((p) => {
    const mid = a0 + p.share * Math.PI;
    a0 += p.share * Math.PI * 2;
    return mid;
  });
};
const anchorAt = (a: number): Anchor => (Math.cos(a) > 0.2 ? "start" : Math.cos(a) < -0.2 ? "end" : "middle");

/**
 * #209 round 4: where a ring goes in a w × plotH plot: the largest radius `fit` at which the ring and its share labels (at
 * FONT outside the ring, their ink boxes: svg.ts inkBox) stay inside the plot, its centre moved off the middle only as far as
 * that takes, so room is kept only on the sides that carry a label. `fit` is 0 when no ring leaves room for every label.
 */
export function ringFit(w: number, plotH: number, parts: RingPart[]): { fit: number; cx: number; cy: number } {
  const angles = midAngles(parts);
  const shown = parts.map((p, i) => ({ p, a: angles[i], text: pct(p.share) })).filter((x) => x.p.show);
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  // Labels keep EDGE (0.02 units) inside the plot, so the 3-decimal coordinates never round them onto the legend under it.
  const EDGE = 0.02;
  const place = (r: number): { cx: number; cy: number } | null => {
    let [xlo, xhi, ylo, yhi] = [r, w - r, r, plotH - r];
    for (const l of shown) {
      const b = inkBox((r + FONT) * Math.cos(l.a), (r + FONT) * Math.sin(l.a), l.text, SMALL, { anchor: anchorAt(l.a), baseline: "middle" });
      [xlo, xhi, ylo, yhi] = [Math.max(xlo, EDGE - b.x0), Math.min(xhi, w - EDGE - b.x1), Math.max(ylo, EDGE - b.y0), Math.min(yhi, plotH - EDGE - b.y1)];
    }
    return xlo <= xhi + 1e-9 && ylo <= yhi + 1e-9 ? { cx: clamp(w / 2, xlo, xhi), cy: clamp(plotH / 2, ylo, yhi) } : null;
  };
  let lo = 0;
  let hi = place(0) ? Math.max(0, Math.min(w, plotH) / 2) : 0;
  for (let i = 0; i < 40 && hi - lo > 1e-4; i++) {
    const mid = (lo + hi) / 2;
    if (place(mid)) lo = mid;
    else hi = mid;
  }
  return { fit: lo, ...(place(lo) ?? { cx: w / 2, cy: plotH / 2 }) };
}

/**
 * #209 round 4: the ring of a plot too small for a ring with every share label: the one production drew (the plot's middle,
 * FONT × 1.6 of room a side), never under `rMin` or SMALL × 0.5 (FONT where production's had no size) nor over what the plot
 * holds. ringLabels then leaves out the labels without room, never drawing one outside the plot.
 */
export function looseRing(w: number, plotH: number, rMin = 0): { r: number; cx: number; cy: number } {
  const most = Math.max(0, Math.min(w, plotH) / 2);
  const prod = most - FONT * 1.6;
  return { r: Math.min(most, prod > 0 ? Math.max(rMin, prod, SMALL * 0.5) : Math.max(rMin, FONT)), cx: w / 2, cy: plotH / 2 };
}

/**
 * #209 review: where a ring's share labels go (outside the ring, at each part's middle angle), biggest share first; a
 * label that would meet one already placed (two thin neighbouring parts) is left out, never drawn over it. `parts`
 * are in ring order with their share and whether the chart labels them. #209 round 4: decided on the labels' ink
 * (inkBox); a label that would meet one already placed first moves (out along its angle, up to SMALL × 2, or up or down, up
 * to SMALL; the smallest move first, never onto the ring) before it is left out, and a label that would leave the plot
 * (`w` × `plotH`) is left out too.
 */
export function ringLabels(parts: RingPart[], cx: number, cy: number, r: number, w = Infinity, plotH = Infinity): ({ x: number; y: number; anchor: Anchor; text: string } | null)[] {
  const angles = midAngles(parts);
  const out: ({ x: number; y: number; anchor: Anchor; text: string } | null)[] = parts.map(() => null);
  const placed: LabelBox[] = [];
  const order = parts.map((_, i) => i).filter((i) => parts[i].show).sort((a, b) => parts[b].share - parts[a].share || a - b);
  const moves = [
    ...[0, 0.25, 0.5, 0.75, 1, 1.5, 2].map((k) => ({ d: k * SMALL, dy: 0 })),
    ...[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].flatMap((k) => [{ d: 0, dy: k * SMALL }, { d: 0, dy: -k * SMALL }]),
  ].sort((a, b) => Math.max(a.d, Math.abs(a.dy)) - Math.max(b.d, Math.abs(b.dy)));
  const offRing = (b: LabelBox) => Math.hypot(Math.max(b.x0 - cx, 0, cx - b.x1), Math.max(b.y0 - cy, 0, cy - b.y1)) >= r;
  for (const i of order) {
    const a = angles[i];
    const anchor = anchorAt(a);
    const label = pct(parts[i].share);
    for (const { d, dy } of moves) {
      const spot = { x: cx + (r + FONT + d) * Math.cos(a), y: cy + (r + FONT + d) * Math.sin(a) + dy, anchor, text: label };
      const box = inkBox(spot.x, spot.y, label, SMALL, { anchor, baseline: "middle" });
      if (box.x0 < -1e-6 || box.x1 > w + 1e-6 || box.y0 < -1e-6 || box.y1 > plotH + 1e-6 || !offRing(box)) continue;
      if (placed.some((q) => boxesMeet(q, box, SMALL * INK_GAP))) continue;
      placed.push(box);
      out[i] = spot;
      break;
    }
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
  // #209 review: the figure goes in the hole when it fits there (donutCentre), else under the donut. #209 round 4: the ring
  // is as big as its share labels leave room for (ringFit: room only on the sides that carry one): at least FONT with every
  // label, else at least FONT × 0.5 with every label. A frame too small for that takes production's ring (looseRing) and
  // leaves out the labels without room; there the figure goes under the donut only when that leaves out
  // no label and keeps the ring at FONT, else it is left out (it didn't fit production's hole either: production drew it
  // over the ring).
  const rings = ps.map((p) => ({ share: p.value / total, show: p.value / total >= 0.04 }));
  const plan = (tier: number, withFigure = true) => {
    const geom = (underH: number) => {
      const plotH = Math.max(0, h - legendH - underH);
      const f = tier > 0 ? ringFit(w, plotH, rings) : null;
      const g = f ? { r: f.fit, ...f } : { fit: 0, ...looseRing(w, plotH) };
      return { plotH, ...g, inner: g.r * 0.62 };
    };
    const ok = (g: ReturnType<typeof geom>) => tier <= 0 || g.fit >= tier;
    let g = geom(0);
    if (!ok(g)) return null;
    let centre = withFigure ? donutCentre(figure, value.unit, g.cx, g.cy, g.inner, theme) : "";
    let under = "";
    if (centre === null) {
      const u = underDonut(figure, value.unit, w, theme);
      g = geom(u.h);
      if (!ok(g)) return null;
      under = u.svg(h - legendH - u.h);
      centre = "";
    }
    return { ...g, centre, under, labels: ringLabels(rings, g.cx, g.cy, g.r, w, g.plotH) };
  };
  const loose = () => {
    const a = plan(0) as NonNullable<ReturnType<typeof plan>>;
    const b = plan(0, false) as NonNullable<ReturnType<typeof plan>>;
    return a.r >= Math.min(FONT, b.r) - 1e-9 && b.labels.every((l, i) => !l || a.labels[i]) ? a : b;
  };
  const { r, cx, cy, inner, centre, under, labels: shareLabels } = plan(FONT) ?? plan(FONT * 0.5) ?? loose();
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
