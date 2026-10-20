/**
 * DS-1 · image, frame (an image clipped by a mask) and grid (n frames with a
 * gap). Crop is in the frame's coordinates: the image box's x/y/w/h in mm
 * inside the frame. Without a crop the image fills by `fit`.
 */
import { assetUrl, type RenderContext } from "../context";
import type { Crop, FrameMask } from "../types";
import { esc, mm, n3 } from "../util";
import type { ElementRenderer } from "./types";

/** A deterministic organic outline as a CSS polygon (percentages). */
const BLOB = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r = 0.44 + 0.04 * Math.sin(3 * a) + 0.03 * Math.cos(5 * a + 1);
    pts.push(`${n3(50 + r * 100 * Math.cos(a))}% ${n3(50 + r * 100 * Math.sin(a))}%`);
  }
  return `polygon(${pts.join(",")})`;
})();

export const maskStyle = (mask: FrameMask | undefined, wMm: number): string => {
  switch (mask) {
    case "rounded":
      return `border-radius:${mm(Math.min(6, wMm * 0.08))};`;
    case "circle":
      return "border-radius:50%;";
    case "arch":
      return `border-radius:${mm(wMm / 2)} ${mm(wMm / 2)} 0 0;`;
    case "blob":
      return `clip-path:${BLOB};`;
    default:
      return "";
  }
};

export function picture(ctx: RenderContext, assetId: string | undefined, alt: string, fit: "cover" | "contain", crop?: Crop): string {
  const url = assetUrl(ctx, assetId);
  if (!url) return `<div class="ds-img-missing" role="img" aria-label="${esc(alt)}" data-asset-id="${esc(assetId ?? "")}"></div>`;
  const style = crop ? `position:absolute;left:${mm(crop.x)};top:${mm(crop.y)};width:${mm(crop.w)};height:${mm(crop.h)};object-fit:fill;` : `width:100%;height:100%;object-fit:${fit === "contain" ? "contain" : "cover"};`;
  return `<img src="${esc(url)}" alt="${esc(alt)}" style="${style}" data-asset-id="${esc(assetId ?? "")}">`;
}

export const imageElement: ElementRenderer<"image"> = (el, ctx) => {
  const p = el.props;
  const radius = p.radius ? `border-radius:${mm(p.radius)};` : "";
  return { html: `<div class="ds-media" style="${radius}">${picture(ctx, p.assetId, p.alt, p.fit, p.crop)}</div>`, attrs: p.bleed ? ' data-bleed="true"' : "" };
};

export const frameElement: ElementRenderer<"frame"> = (el, ctx) => {
  const p = el.props;
  return { html: `<div class="ds-media ds-frame" style="${maskStyle(p.mask, el.frame.w)}">${picture(ctx, p.assetId, p.alt, p.fit, p.crop)}</div>`, attrs: ` data-mask="${esc(p.mask)}"${p.bleed ? ' data-bleed="true"' : ""}` };
};

export const gridElement: ElementRenderer<"grid"> = (el, ctx) => {
  const p = el.props;
  const cols = Math.max(1, Math.min(6, Math.floor(p.columns)));
  const rows = Math.ceil(p.cells.length / cols);
  const gap = Math.max(0, p.gap);
  const cw = (el.frame.w - gap * (cols - 1)) / cols;
  const ch = (el.frame.h - gap * (rows - 1)) / rows;
  const cells = p.cells
    .map((c, i) => {
      const x = (i % cols) * (cw + gap);
      const y = Math.floor(i / cols) * (ch + gap);
      return `<div class="ds-media ds-grid-cell" style="left:${mm(x)};top:${mm(y)};width:${mm(cw)};height:${mm(ch)};${maskStyle(p.mask, cw)}">${picture(ctx, c.assetId, c.alt, "cover", c.crop)}</div>`;
    })
    .join("");
  return { html: `<div class="ds-grid">${cells}</div>`, attrs: ` data-cells="${p.cells.length}"` };
};
