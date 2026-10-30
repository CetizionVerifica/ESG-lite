/**
 * DS-1 · value axis with gridlines and category labels.
 */
import type { Theme } from "../theme";
import { tickLabel } from "../format";
import type { Scale } from "./scale";
import { FONT, SMALL, labelBox, text, type Obstacle } from "./svg";
import { n3 } from "../util";

/** Width the value labels need on a vertical axis. */
export const axisWidth = (s: Scale): number => Math.max(...s.ticks.map((t) => tickLabel(t).length)) * SMALL * 0.6 + SMALL;

/** Horizontal gridlines + labels for a vertical value axis over plot [x0, x0+w] × [y0, y0+h]. */
export function valueGridY(s: Scale, x0: number, y0: number, w: number, h: number, theme: Theme): string {
  return s.ticks
    .map((t) => {
      const y = y0 + h - s.t(t) * h;
      return `<line x1="${n3(x0)}" x2="${n3(x0 + w)}" y1="${n3(y)}" y2="${n3(y)}" stroke="${t === 0 ? theme.colors.muted : theme.colors.border}" stroke-width="${t === 0 ? 1 : 0.6}"/>${text(x0 - SMALL * 0.4, y, tickLabel(t), theme.colors.muted, { size: SMALL, anchor: "end", baseline: "middle" })}`;
    })
    .join("");
}

/** The boxes of valueGridY's tick labels, for value labels to keep clear of (#209 review). */
export const tickBoxes = (s: Scale, x0: number, y0: number, h: number): Obstacle[] =>
  s.ticks.map((t) => labelBox(x0 - SMALL * 0.4, y0 + h - s.t(t) * h, tickLabel(t), SMALL, { anchor: "end", baseline: "middle" }));

/** Vertical gridlines + labels for a horizontal value axis. */
export function valueGridX(s: Scale, x0: number, y0: number, w: number, h: number, theme: Theme): string {
  return s.ticks
    .map((t) => {
      const x = x0 + s.t(t) * w;
      return `<line x1="${n3(x)}" x2="${n3(x)}" y1="${n3(y0)}" y2="${n3(y0 + h)}" stroke="${t === 0 ? theme.colors.muted : theme.colors.border}" stroke-width="${t === 0 ? 1 : 0.6}"/>${text(x, y0 + h + SMALL * 1.3, tickLabel(t), theme.colors.muted, { size: SMALL, anchor: "middle" })}`;
    })
    .join("");
}

/** Category labels under a band axis; long labels are shortened with an ellipsis. */
export function bandLabels(keys: string[], x0: number, band: number, y: number, theme: Theme): string {
  const max = Math.max(3, Math.floor(band / (FONT * 0.5)));
  return keys.map((k, i) => text(x0 + band * (i + 0.5), y, k.length > max ? `${k.slice(0, max - 1)}…` : k, theme.colors.muted, { size: SMALL, anchor: "middle" })).join("");
}
