/** DS-1 · text: a TextDoc in a text style, aligned, with data chips. PE-2: effects and a per-box font (textEffects.ts). */
import { renderTextDoc } from "../text";
import { curveAngle, curveSvg, fontOverride, textEffectStyle } from "../textEffects";
import { esc, hex } from "../util";
import type { ElementRenderer } from "./types";

const VALIGN = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

export const textElement: ElementRenderer<"text"> = (el, ctx) => {
  const p = el.props;
  const color = hex(p.color);
  const style = `text-align:${esc(p.align ?? "left")};justify-content:${VALIGN[p.valign ?? "top"] ?? "flex-start"};${color ? `color:${color};` : ""}`;
  // PE-2: a box without effects or font renders exactly as before.
  if (!p.effects && !p.font) return { html: `<div class="ds-text ts-${esc(p.style)}" style="${style}"><div class="ds-text-in">${renderTextDoc(p.doc, ctx)}</div></div>`, attrs: ` data-text-style="${esc(p.style)}"` };
  const family = fontOverride(p.font, ctx);
  const fontCss = family ? `font-family:${esc(family)};` : "";
  const fontAttr = p.font ? ` data-font="${esc(p.font)}"` : "";
  if (p.effects && curveAngle(p.effects) !== 0) {
    const fx = textEffectStyle({ ...p.effects, highlight: undefined });
    return {
      html: `<div class="ds-text ds-text--curve ts-${esc(p.style)}" style="${style}${fontCss}">${curveSvg(el, ctx, p.effects)}</div>`,
      attrs: ` data-text-style="${esc(p.style)}" data-effects="${["curve", ...fx.names].join(" ")}"${fontAttr}`,
    };
  }
  const fx = textEffectStyle(p.effects);
  const fxAttr = fx.names.length ? ` data-effects="${fx.names.join(" ")}"` : "";
  return {
    html: `<div class="ds-text ts-${esc(p.style)}${fx.cls}" style="${style}${fontCss}${fx.style}"><div class="ds-text-in">${renderTextDoc(p.doc, ctx, fx.wrap ? { wrap: fx.wrap } : {})}</div></div>`,
    attrs: ` data-text-style="${esc(p.style)}"${fxAttr}${fontAttr}`,
  };
};
