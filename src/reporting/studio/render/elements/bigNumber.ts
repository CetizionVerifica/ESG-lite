/** DS-1 §3 · big_number: a bound value + label + delta, in the big_number text style. */
import { dataMarks, lookup } from "../data";
import { esc } from "../util";
import type { ElementRenderer } from "./types";
import { delta, figure } from "./values";

export const bigNumberElement: ElementRenderer<"big_number"> = (el, ctx) => {
  const p = el.props;
  const v = lookup(ctx.data, p.binding);
  const html =
    `<div class="ds-big">` +
    `<div class="ds-big-value ts-big_number">${figure(v, "ds-big-fig")}</div>` +
    (p.label ? `<div class="ds-big-label">${esc(p.label)}</div>` : "") +
    (p.showDelta ? delta(v) : "") +
    `</div>`;
  return { html, attrs: `${dataMarks(p.binding, v)} data-measure="${esc(p.measure ?? "value")}"` };
};
