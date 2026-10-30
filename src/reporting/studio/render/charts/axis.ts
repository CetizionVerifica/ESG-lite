/**
 * DS-1 · value axis with gridlines and category labels.
 */
import type { Theme } from "../theme";
import { tickLabel } from "../format";
import type { Scale } from "./scale";
import { FONT, LABEL_STEPS, SMALL, inkBox, text, type Obstacle } from "./svg";
import { n3 } from "../util";

/** Width the value labels need on a vertical axis. */
export const axisWidth = (s: Scale): number => Math.max(...s.ticks.map((t) => tickLabel(t).length)) * SMALL * 0.6 + SMALL;

/**
 * #209 round 4: the height a vertical value axis needs for its tick labels not to meet (a tick label's height and its air
 * per step), and never under 2 × SMALL. A chart gives the plot this much before it takes height for anything new (a
 * total line's extra lines, a staggered label row).
 */
export const tickRoom = (s: Scale): number => Math.max(SMALL * 2, (s.ticks.length - 1) * SMALL * 0.9);

/** Horizontal gridlines + labels for a vertical value axis over plot [x0, x0+w] × [y0, y0+h]. */
export function valueGridY(s: Scale, x0: number, y0: number, w: number, h: number, theme: Theme): string {
  return s.ticks
    .map((t) => {
      const y = y0 + h - s.t(t) * h;
      return `<line x1="${n3(x0)}" x2="${n3(x0 + w)}" y1="${n3(y)}" y2="${n3(y)}" stroke="${t === 0 ? theme.colors.muted : theme.colors.border}" stroke-width="${t === 0 ? 1 : 0.6}"/>${text(x0 - SMALL * 0.4, y, tickLabel(t), theme.colors.muted, { size: SMALL, anchor: "end", baseline: "middle" })}`;
    })
    .join("");
}

/** The boxes of valueGridY's tick labels, for value labels to keep clear of (#209 review; #209 round 4: their ink, inkBox). */
export const tickBoxes = (s: Scale, x0: number, y0: number, h: number): Obstacle[] =>
  s.ticks.map((t) => inkBox(x0 - SMALL * 0.4, y0 + h - s.t(t) * h, tickLabel(t), SMALL, { anchor: "end", baseline: "middle" }));

/** Air between neighbouring tick labels' ink on a horizontal value axis (#209 round 4). */
const TICK_AIR = SMALL * 0.1;

/**
 * #209 round 4: the least plot width at which a horizontal value axis prints as many tick labels (tickLabelsX) as it does at
 * `pw`. A chart narrowing its plot for labels after its bar ends (fitBarEnds) never goes under it, so tick labels production
 * printed apart stay.
 */
export function tickFloorX(s: Scale, pw: number): number {
  const count = (w: number) => tickLabelsX(s, w).keep.filter(Boolean).length;
  const want = count(pw);
  let lo = 0;
  let hi = pw;
  for (let i = 0; i < 30 && hi - lo > 0.01; i++) {
    const mid = (lo + hi) / 2;
    if (count(mid) >= want) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * #209 round 4: the tick labels of a horizontal value axis `w` wide: the largest size (SMALL × LABEL_STEPS) at which each
 * label's ink keeps TICK_AIR from its neighbour's; when even the smallest doesn't, the labels left to right, each left out
 * that would meet the last one kept, at the size that keeps the most (the larger of equals). Every gridline stays; a
 * narrowed plot never prints tick labels over each other.
 */
export function tickLabelsX(s: Scale, w: number): { size: number; keep: boolean[] } {
  const labels = s.ticks.map((t) => tickLabel(t));
  let best: { size: number; keep: boolean[]; n: number } | null = null;
  for (const k of LABEL_STEPS) {
    const size = SMALL * k;
    const keep: boolean[] = [];
    let last: { x1: number } | null = null;
    for (const [i, t] of s.ticks.entries()) {
      const box = inkBox(s.t(t) * w, 0, labels[i], size, { anchor: "middle" });
      keep.push(!last || box.x0 - last.x1 >= TICK_AIR);
      if (keep[i]) last = box;
    }
    const n = keep.filter(Boolean).length;
    if (!best || n > best.n) best = { size, keep, n };
    if (n === labels.length) break;
  }
  return best ?? { size: SMALL, keep: [] };
}

/** Vertical gridlines + labels for a horizontal value axis (#209 round 4: tick labels by tickLabelsX). */
export function valueGridX(s: Scale, x0: number, y0: number, w: number, h: number, theme: Theme): string {
  const { size, keep } = tickLabelsX(s, w);
  return s.ticks
    .map((t, i) => {
      const x = x0 + s.t(t) * w;
      const label = keep[i] ? text(x, y0 + h + SMALL * 1.3, tickLabel(t), theme.colors.muted, { size, anchor: "middle" }) : "";
      return `<line x1="${n3(x)}" x2="${n3(x)}" y1="${n3(y0)}" y2="${n3(y0 + h)}" stroke="${t === 0 ? theme.colors.muted : theme.colors.border}" stroke-width="${t === 0 ? 1 : 0.6}"/>${label}`;
    })
    .join("");
}

/** Category labels under a band axis; long labels are shortened with an ellipsis. */
export function bandLabels(keys: string[], x0: number, band: number, y: number, theme: Theme): string {
  const max = Math.max(3, Math.floor(band / (FONT * 0.5)));
  return keys.map((k, i) => text(x0 + band * (i + 0.5), y, k.length > max ? `${k.slice(0, max - 1)}…` : k, theme.colors.muted, { size: SMALL, anchor: "middle" })).join("");
}
