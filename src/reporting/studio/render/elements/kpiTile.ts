/** DS-1 · kpi_tile: label, figure, delta and an optional sparkline; plain / card / band. */
import { sparkline } from "../charts/line";
import { U } from "../charts/svg";
import { dataMarks, lookup } from "../data";
import { esc } from "../util";
import type { ElementRenderer } from "./types";
import { delta, figure } from "./values";

export const kpiTileElement: ElementRenderer<"kpi_tile"> = (el, ctx) => {
  const p = el.props;
  const v = lookup(ctx.data, p.binding);
  const spark =
    p.showSparkline && v && (v.series?.[0]?.values.length ?? 0) > 1
      ? `<div class="ds-tile-spark">${sparkline({ value: v, w: el.frame.w * U, h: Math.max(4, el.frame.h * 0.22) * U, theme: ctx.theme, options: {}, label: `${p.label ?? "Trend"} over time` })}</div>`
      : "";
  const html =
    `<div class="ds-tile ds-tile--${esc(p.variant)}">` +
    (p.label ? `<div class="ds-tile-label">${esc(p.label)}</div>` : "") +
    `<div class="ds-tile-value">${figure(v, "ds-tile-fig")}</div>` +
    (p.showDelta ? delta(v) : "") +
    spark +
    `</div>`;
  return { html, attrs: dataMarks(p.binding, v) };
};
