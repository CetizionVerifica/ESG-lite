/**
 * PE-1 · photo edits for image and frame elements: filter presets, the
 * adjustment sliders, brand duotone. Element transparency is the element's
 * `opacity` (sheet.ts), not something drawn here.
 *
 * Two layers, in this order (docs/design-studio/pro/PE-1.md):
 *  1. CSS filter functions on the <img>: the preset first, then brightness,
 *     contrast, saturation and blur (`imageFilterCss`);
 *  2. an inline SVG filter on a wrapper around the <img>, only when warmth or
 *     duotone is set (`imageSvgFilter`): warmth as an feColorMatrix channel
 *     scale, then duotone as luminance (feColorMatrix) mapped to the two
 *     colours by an feComponentTransfer table.
 * Both are plain HTML/SVG, so the editor's shadow root, Page view, PNG and
 * the Chromium PDF draw the same pixels. Slider units are integers (contracts
 * IMAGE_ADJUST_RANGE); out-of-range values are clamped, unknown presets ignored.
 */
import type { ImageAdjust, ImageEditProps, ImageFilter } from "./types";
import { clamp, esc, fnv1a, hex, idPart, n3 } from "./util";

/** The CSS of each preset (applied before the sliders). */
export const IMAGE_FILTER_CSS: Record<Exclude<ImageFilter, "none">, string> = {
  vivid: "saturate(1.4) contrast(1.1)",
  mono: "grayscale(1) contrast(1.1)",
  warm: "sepia(0.3) saturate(1.2) brightness(1.03)",
  cool: "saturate(0.9) hue-rotate(-12deg) brightness(1.03)",
  fade: "contrast(0.85) saturate(0.75) brightness(1.1)",
};

const num = (v: unknown, lo: number, hi: number): number => (typeof v === "number" && Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : 0);

/** The sliders, clamped to their ranges (0 when absent). */
export function adjustValues(a: ImageAdjust | undefined): Required<ImageAdjust> {
  return {
    brightness: num(a?.brightness, -100, 100),
    contrast: num(a?.contrast, -100, 100),
    saturation: num(a?.saturation, -100, 100),
    warmth: num(a?.warmth, -100, 100),
    blur: num(a?.blur, 0, 100),
  };
}

/**
 * The CSS `filter` value for the preset and the brightness, contrast,
 * saturation and blur sliders; "" when nothing applies.
 *   brightness b → brightness(1 + b/200)   (0.5 … 1.5)
 *   contrast c   → contrast(1 + c/200)     (0.5 … 1.5)
 *   saturation s → saturate(1 + s/100)     (0 … 2)
 *   blur v       → blur(v × 0.03 mm)       (0 … 3 mm)
 */
export function imageFilterCss(p: Pick<ImageEditProps, "adjust" | "filter">): string {
  const parts: string[] = [];
  const preset = p.filter && p.filter !== "none" ? IMAGE_FILTER_CSS[p.filter] : undefined;
  if (preset) parts.push(preset);
  const a = adjustValues(p.adjust);
  if (a.brightness) parts.push(`brightness(${n3(1 + a.brightness / 200)})`);
  if (a.contrast) parts.push(`contrast(${n3(1 + a.contrast / 200)})`);
  if (a.saturation) parts.push(`saturate(${n3(1 + a.saturation / 100)})`);
  if (a.blur) parts.push(`blur(${n3(a.blur * 0.03)}mm)`);
  return parts.join(" ");
}

const channels = (c: string): [number, number, number] => [0, 2, 4].map((i) => parseInt(c.slice(1 + i, 3 + i), 16) / 255) as [number, number, number];

/** True when the element needs the SVG layer (warmth or duotone). */
export function needsSvgFilter(p: Pick<ImageEditProps, "adjust" | "duotone">): boolean {
  return adjustValues(p.adjust).warmth !== 0 || !!(p.duotone && hex(p.duotone.dark) && hex(p.duotone.light));
}

/** The filter id for an element (stable, safe in an HTML id, unique per element id). */
export const imageFilterId = (elementId: string): string => `ds-fx-${idPart(elementId).slice(0, 40)}-${fnv1a(elementId)}`;

/**
 * The <filter> markup for warmth and duotone, or "" when neither is set.
 *   warmth w → R × (1 + w/100 × 0.15), B × (1 − w/100 × 0.15)
 *   duotone  → luminance (Rec. 709) → R, G, B tables [dark, light]
 */
export function imageSvgFilter(id: string, p: Pick<ImageEditProps, "adjust" | "duotone">): string {
  const prims: string[] = [];
  const w = adjustValues(p.adjust).warmth;
  if (w) {
    const k = (w / 100) * 0.15;
    prims.push(`<feColorMatrix type="matrix" values="${n3(1 + k)} 0 0 0 0 0 1 0 0 0 0 0 ${n3(1 - k)} 0 0 0 0 0 1 0"/>`);
  }
  const dark = p.duotone ? hex(p.duotone.dark) : null;
  const light = p.duotone ? hex(p.duotone.light) : null;
  if (dark && light) {
    const d = channels(dark);
    const l = channels(light);
    prims.push(`<feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/>`);
    prims.push(
      `<feComponentTransfer><feFuncR type="table" tableValues="${n3(d[0])} ${n3(l[0])}"/><feFuncG type="table" tableValues="${n3(d[1])} ${n3(l[1])}"/><feFuncB type="table" tableValues="${n3(d[2])} ${n3(l[2])}"/></feComponentTransfer>`,
    );
  }
  if (!prims.length) return "";
  return `<filter id="${esc(id)}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">${prims.join("")}</filter>`;
}

/**
 * Wraps a picture's <img> with the photo edits of `p`. Without edits the
 * markup is returned unchanged (docs saved before PE-1 render byte for byte
 * as before). The CSS filter goes at the end of the img's style attribute
 * (`img.style`), so the tag is split around it.
 */
export function withImageFx(img: { before: string; style: string; after: string }, elementId: string, p: ImageEditProps): string {
  const css = imageFilterCss(p);
  const tag = `${img.before}${img.style}${css ? `filter:${css};` : ""}${img.after}`;
  if (!needsSvgFilter(p)) return tag;
  const id = imageFilterId(elementId);
  const defs = `<svg class="ds-fx-defs" aria-hidden="true" focusable="false" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden;">${imageSvgFilter(id, p)}</svg>`;
  return `${defs}<div class="ds-fx" style="position:absolute;left:0;top:0;width:100%;height:100%;filter:url(#${esc(id)});">${tag}</div>`;
}
