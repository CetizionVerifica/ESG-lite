/** DS-1 §3 · callout: an icon + text in a box tinted by tone. */
import { iconSvg } from "../icons";
import { renderTextDoc } from "../text";
import { tint } from "../theme";
import { esc, hex } from "../util";
import type { ElementRenderer } from "./types";

export const calloutElement: ElementRenderer<"callout"> = (el, ctx) => {
  const p = el.props;
  const c = ctx.theme.colors;
  const toneColor = hex(p.color) ?? ({ primary: c.primary, accent: c.accent, muted: c.muted, good: c.good, warn: c.bad }[p.tone ?? "primary"] ?? c.primary);
  const bg = ctx.theme.look === "night" ? c.surface : tint(toneColor, c.paper);
  const icon = p.icon ? `<div class="ds-callout-icon">${iconSvg(p.icon, toneColor)}</div>` : "";
  return {
    html: `<div class="ds-callout" style="background:${bg};border-left-color:${toneColor}">${icon}<div class="ds-callout-text ts-body">${renderTextDoc(p.doc, ctx)}</div></div>`,
    attrs: ` data-tone="${esc(p.tone ?? "primary")}"`,
  };
};
