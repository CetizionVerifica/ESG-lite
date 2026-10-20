/** DS-1 · text: a TextDoc in a text style, aligned, with data chips. */
import { renderTextDoc } from "../text";
import { esc, hex } from "../util";
import type { ElementRenderer } from "./types";

const VALIGN = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

export const textElement: ElementRenderer<"text"> = (el, ctx) => {
  const p = el.props;
  const color = hex(p.color);
  const style = `text-align:${esc(p.align ?? "left")};justify-content:${VALIGN[p.valign ?? "top"] ?? "flex-start"};${color ? `color:${color};` : ""}`;
  return { html: `<div class="ds-text ts-${esc(p.style)}" style="${style}"><div class="ds-text-in">${renderTextDoc(p.doc, ctx)}</div></div>`, attrs: ` data-text-style="${esc(p.style)}"` };
};
