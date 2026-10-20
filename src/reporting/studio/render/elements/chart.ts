/**
 * DS-1 · chart: title, subtitle, a static SVG chart sized to what's left of the
 * frame, and a caption. Custom (typed) data is drawn too, with the
 * "Typed data, not linked" badge (01-contracts rule 2.3).
 */
import { chartRenderer } from "../charts/registry";
import { FONT, U, emptyChart } from "../charts/svg";
import { dataMarks, lookup, NOT_REPORTED, unavailableReason } from "../data";
import type { RenderBinding, RenderValue } from "../types";
import { esc } from "../util";
import type { ElementRenderer } from "./types";

/** Custom data → a RenderValue: column 0 is the category, the others are series. */
export const customToValue = (b: RenderBinding): RenderValue => {
  const cols = b.columns ?? [];
  const rows = b.rows ?? [];
  return {
    display: "",
    value: null,
    unit: null,
    source: "custom",
    series: cols.slice(1).map((label, ci) => ({
      label,
      values: rows.map((r) => ({ key: String(r[0] ?? ""), value: typeof r[ci + 1] === "number" ? (r[ci + 1] as number) : Number.isFinite(Number(r[ci + 1])) ? Number(r[ci + 1]) : null })),
    })),
  };
};

export const UNLINKED_BADGE = `<span class="ds-unlinked">Typed data, not linked</span>`;

export const chartElement: ElementRenderer<"chart"> = (el, ctx) => {
  const p = el.props;
  const custom = p.binding?.source === "custom";
  const v = custom ? customToValue(p.binding) : lookup(ctx.data, p.binding);
  const titleH = (p.title ? 6 : 0) + (p.subtitle ? 4.5 : 0);
  const captionH = (p.caption ? 4.5 : 0) + (custom ? 4.5 : 0);
  const w = el.frame.w * U;
  const h = Math.max(8, el.frame.h - titleH - captionH) * U;
  const label = p.title ?? `${p.kind} chart`;
  const reason = custom ? null : unavailableReason(v);
  const render = chartRenderer(p.kind);
  let svg: string;
  let extra = "";
  if (reason || !v) {
    svg = emptyChart(w, h, NOT_REPORTED, ctx.theme);
    extra = ` data-reason="${esc(reason ?? "NOT_RESOLVED")}"`;
  } else if (!render) {
    svg = emptyChart(w, h, "Chart not available", ctx.theme);
    extra = ` data-chart-unsupported="${esc(p.kind)}"`;
  } else {
    svg = render({ value: v, w, h, theme: ctx.theme, options: p.options ?? {}, label });
  }
  const html =
    `<figure class="ds-chart" style="--chart-font:${FONT}px">` +
    (p.title ? `<figcaption class="ds-chart-title ts-subheading">${esc(p.title)}</figcaption>` : "") +
    (p.subtitle ? `<div class="ds-chart-sub ts-caption">${esc(p.subtitle)}</div>` : "") +
    `<div class="ds-chart-plot">${svg}</div>` +
    (p.caption ? `<div class="ds-chart-caption ts-caption">${esc(p.caption)}</div>` : "") +
    (custom ? UNLINKED_BADGE : "") +
    `</figure>`;
  return { html, attrs: `${dataMarks(p.binding, v)} data-chart-kind="${esc(p.kind)}"${extra}` };
};
