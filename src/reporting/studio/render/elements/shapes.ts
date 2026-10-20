/**
 * DS-1 · shape, line (start/end points, arrowheads, dash), divider and icon.
 */
import { iconSvg } from "../icons";
import { esc, hex, idPart, mm, n3 } from "../util";
import type { ElementRenderer } from "./types";

const DASH = { solid: "", dashed: "3 2", dotted: "0.1 1.6" } as const;

export const shapeElement: ElementRenderer<"shape"> = (el, ctx) => {
  const p = el.props;
  const fill = hex(p.fill) ?? (p.shape === "line" ? "none" : ctx.theme.colors.primary);
  const stroke = hex(p.stroke);
  const sw = p.strokeWidth ?? (p.shape === "line" ? 0.5 : 0);
  const op = p.opacity !== undefined ? `opacity:${n3(p.opacity)};` : "";
  if (p.shape === "line") {
    return { html: `<svg viewBox="0 0 ${n3(el.frame.w)} ${n3(el.frame.h)}" width="100%" height="100%" preserveAspectRatio="none" style="${op}overflow:visible"><line x1="0" y1="${n3(el.frame.h / 2)}" x2="${n3(el.frame.w)}" y2="${n3(el.frame.h / 2)}" stroke="${stroke ?? ctx.theme.colors.ink}" stroke-width="${n3(sw)}"/></svg>`, attrs: p.bleed ? ' data-bleed="true"' : "" };
  }
  const radius = p.shape === "ellipse" ? "border-radius:50%;" : p.radius ? `border-radius:${mm(p.radius)};` : "";
  const border = stroke && sw ? `border:${mm(sw)} solid ${stroke};` : "";
  return { html: `<div class="ds-shape" style="background:${fill};${radius}${border}${op}"></div>`, attrs: ` data-shape="${esc(p.shape)}"${p.bleed ? ' data-bleed="true"' : ""}` };
};

export const lineElement: ElementRenderer<"line"> = (el, ctx) => {
  const p = el.props;
  const color = hex(p.stroke) ?? ctx.theme.colors.ink;
  const id = idPart(el.id);
  const sw = Math.max(0.1, p.strokeWidth);
  const marker = (name: string, flip: boolean) =>
    `<marker id="${name}-${id}" viewBox="0 0 10 10" refX="${flip ? 1 : 9}" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0 0L10 5L0 10z" fill="${color}"/></marker>`;
  const defs = p.startArrow || p.endArrow ? `<defs>${p.startArrow ? marker("ds-a0", true) : ""}${p.endArrow ? marker("ds-a1", false) : ""}</defs>` : "";
  const dash = DASH[p.dash] ? ` stroke-dasharray="${DASH[p.dash]}"` : "";
  const cap = p.dash === "dotted" ? "round" : "butt";
  return {
    html:
      `<svg viewBox="0 0 ${n3(el.frame.w)} ${n3(el.frame.h)}" width="100%" height="100%" style="overflow:visible">${defs}` +
      `<line x1="${n3(p.x1)}" y1="${n3(p.y1)}" x2="${n3(p.x2)}" y2="${n3(p.y2)}" stroke="${color}" stroke-width="${n3(sw)}" stroke-linecap="${cap}"${dash}` +
      `${p.startArrow ? ` marker-start="url(#ds-a0-${id})"` : ""}${p.endArrow ? ` marker-end="url(#ds-a1-${id})"` : ""}/></svg>`,
    attrs: ` data-dash="${esc(p.dash)}"`,
  };
};

export const dividerElement: ElementRenderer<"divider"> = (el, ctx) => {
  const p = el.props;
  const color = hex(p.color) ?? ctx.theme.colors.border;
  return { html: `<div class="ds-divider" style="border-top:${mm(p.strokeWidth ?? 0.3)} ${esc(p.style ?? "solid")} ${color}"></div>` };
};

export const iconElement: ElementRenderer<"icon"> = (el, ctx) => ({ html: iconSvg(el.props.name, hex(el.props.color) ?? ctx.theme.colors.primary), attrs: ` data-icon="${esc(el.props.name)}"` });
