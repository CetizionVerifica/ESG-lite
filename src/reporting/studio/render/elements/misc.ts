/**
 * DS-1 · sdg, page_number, placeholder and qr.
 */
import { SDG } from "../icons";
import { qrSvg } from "../qr";
import { esc, hex } from "../util";
import type { ElementRenderer } from "./types";

export const sdgElement: ElementRenderer<"sdg"> = (el) => {
  const g = Math.min(17, Math.max(1, Math.round(el.props.goal)));
  const s = SDG[g - 1];
  const label = el.props.variant === "full" ? `<span class="ds-sdg-label">${esc(s.label)}</span>` : "";
  return { html: `<div class="ds-sdg ds-sdg--${esc(el.props.variant)}" style="background:${s.color}" role="img" aria-label="SDG ${g}: ${esc(s.label)}"><span class="ds-sdg-n">${g}</span>${label}</div>`, attrs: ` data-goal="${g}"` };
};

/**
 * Sheet modes print the page's position among visible pages. In paged and
 * print modes html.ts fills `.ds-pn` after pagination, since flow sections
 * before a page change its number.
 */
export const pageNumberElement: ElementRenderer<"page_number"> = (el, ctx) => {
  const p = el.props;
  const color = hex(p.color);
  const fmt = p.format ?? "n";
  const paged = ctx.mode === "paged" || ctx.mode === "print";
  const n = paged ? "" : String(ctx.pageNo);
  const total = paged ? "" : String(ctx.pageCount);
  const inner = fmt === "n_of_m" ? `<span class="ds-pn">${n}</span> of <span class="ds-pn-total">${total}</span>` : `<span class="ds-pn">${n}</span>`;
  return { html: `<div class="ds-page-number ts-caption" style="text-align:${esc(p.align ?? "right")};${color ? `color:${color};` : ""}">${inner}</div>`, attrs: ` data-format="${esc(fmt)}"` };
};

export const placeholderElement: ElementRenderer<"placeholder"> = (el) => ({
  html: `<div class="ds-placeholder"><span>${esc(el.props.hint ?? `Add ${el.props.accepts.join(" or ").replace(/_/g, " ")}`)}</span></div>`,
  attrs: ` data-accepts="${esc(el.props.accepts.join(","))}" data-placeholder="true"`,
});

export const qrElement: ElementRenderer<"qr"> = (el, ctx) => {
  const color = hex(el.props.color) ?? "#000000";
  try {
    return { html: qrSvg(el.props.url, color, ctx.theme.look === "night" ? "#FFFFFF" : ctx.theme.colors.paper), attrs: ` data-url="${esc(el.props.url)}"` };
  } catch {
    return { html: `<div class="ds-placeholder"><span>Link too long for a QR code</span></div>`, attrs: ' data-reason="QR_TOO_LONG"' };
  }
};
