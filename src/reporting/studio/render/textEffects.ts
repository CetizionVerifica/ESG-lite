/**
 * PE-2 · text effects and uploaded brand fonts (docs/design-studio/pro/PE-2.md).
 * Pure, mirrored with the rest of render/: the editor sheet, Page view, PNG and
 * both PDFs print the same HTML, so an effect looks the same everywhere.
 *
 * Slider units (contracts proProps.ts) → CSS, pinned by the DS goldens
 * (ci/golden/ds/pro-text/*):
 *   shadow     text-shadow: offsetX/Y −100..100 → ±3 mm, blur 0..100 → 0..4 mm, colour at opacity %
 *   lift       a soft shadow straight down: intensity 0..100 → 0.2..1 mm drop, 0.6..3.6 mm blur, 12..47 % ink
 *   outline    -webkit-text-stroke 0..100 → 0..1.2 mm (paint-order stroke first, so the fill stays whole);
 *              where the stroke isn't supported, a ring of eight text-shadows (css.ts @supports)
 *   highlight  a background on each line's run of text (box-decoration-break: clone),
 *              radius 0..100 → 0..0.5 em corners
 *   curve      single line on an SVG textPath: radius −100..100 → arc angle 0..180°
 *              (> 0 arcs upward, < 0 downward); outline becomes the SVG stroke and
 *              shadow/lift a drop-shadow filter; highlight is not drawn on a curve
 *
 * Uploaded fonts are `custom:<id>` in a text box's `font`. Their CSS family is
 * our own name ("DS Brand <id>"), never the uploaded name, so a font can't
 * collide with another face or inject CSS. A ref the render wasn't given (a
 * deleted font) falls back to the text style's font.
 */
import type { RenderContext } from "./context";
import { FONTS, fontStack } from "./fonts";
import { PX_PER_MM } from "./formats";
import { renderTextDocSvg } from "./text";
import { FORMAT_TYPE_SCALE, TEXT_STYLES } from "./textStyles";
import type { ElementOf, FontId, RenderCustomFont, RenderDoc, RenderTextEffects } from "./types";
import { esc, hex, mm, n3 } from "./util";

export const CUSTOM_FONT_FALLBACK = `"Noto Sans", sans-serif`;
const CUSTOM_RE = /^custom:([1-9][0-9]{0,9})$/;

/** The CSS family of an uploaded font ref, or null when the ref isn't one. */
export const customFontFamily = (ref: string | undefined): string | null => {
  const m = CUSTOM_RE.exec(ref ?? "");
  return m ? `DS Brand ${m[1]}` : null;
};

const FORMAT_CSS: Record<RenderCustomFont["files"][number]["format"], string> = { woff2: "woff2", ttf: "truetype", otf: "opentype" };

/** @font-face rules for uploaded fonts (html.ts in every server render; the editor loads them with FontFace). */
export function customFontFaceCss(fonts: RenderCustomFont[] | undefined): string {
  const out: string[] = [];
  for (const f of fonts ?? []) {
    const family = customFontFamily(f.ref);
    if (!family) continue;
    for (const file of f.files) {
      if (!/^(data:font\/(woff2|ttf|otf);base64,[A-Za-z0-9+/=]+|https?:\/\/[^"\s)]+|\/[^"\s)]*)$/.test(file.url)) continue;
      const weight = Number.isInteger(file.weight) && file.weight >= 100 && file.weight <= 900 ? file.weight : 400;
      out.push(`@font-face{font-family:"${family}";font-style:${file.style === "italic" ? "italic" : "normal"};font-weight:${weight};font-display:block;src:url("${file.url}") format("${FORMAT_CSS[file.format] ?? "woff2"}");}`);
    }
  }
  return out.join("\n");
}

/** Every `custom:<id>` a doc's text boxes use, sorted (server renders load only these). */
export function customFontRefs(doc: Pick<RenderDoc, "pages">): string[] {
  const refs = new Set<string>();
  for (const p of doc.pages) {
    if (p.kind !== "freeform") continue;
    for (const e of p.elements) if (e.type === "text" && customFontFamily(e.props.font)) refs.add(e.props.font as string);
  }
  return [...refs].sort();
}

/** The font-family a text box's `font` asks for, or "" (the style's font). */
export function fontOverride(font: string | undefined, ctx: RenderContext): string {
  if (!font) return "";
  if (font in FONTS) return fontStack(font as FontId);
  const family = customFontFamily(font);
  if (family && ctx.customFonts?.[font]) return `"${family}", ${CUSTOM_FONT_FALLBACK}`;
  return "";
}

const int = (v: unknown, lo: number, hi: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : 0);

/** "#rrggbb" at an alpha (0..1) as rgba(); null for anything that isn't a hex colour. */
export const rgba = (colour: unknown, alpha: number): string | null => {
  const h = hex(colour);
  if (!h) return null;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${n3(Math.min(1, Math.max(0, alpha)))})`;
};

/** shadow or lift → [x mm, y mm, blur mm, colour], or null. */
function shadowParts(e: RenderTextEffects): [number, number, number, string] | null {
  if (e.shadow) {
    const c = rgba(e.shadow.colour, int(e.shadow.opacity, 0, 100) / 100);
    if (!c) return null;
    return [int(e.shadow.offsetX, -100, 100) * 0.03, int(e.shadow.offsetY, -100, 100) * 0.03, int(e.shadow.blur, 0, 100) * 0.04, c];
  }
  if (e.lift) {
    const i = int(e.lift.intensity, 0, 100);
    return [0, 0.2 + i * 0.008, 0.6 + i * 0.03, `rgba(15,23,42,${n3(0.12 + i * 0.0035)})`];
  }
  return null;
}

const outlineMm = (e: RenderTextEffects): number => (e.outline && hex(e.outline.colour) ? int(e.outline.width, 0, 100) * 0.012 : 0);

export interface TextEffectStyle {
  /** Inline CSS for the text wrapper. */
  style: string;
  /** Extra classes for the text wrapper. */
  cls: string;
  /** The highlight run's opening tag (renderTextDoc `wrap`), or undefined. */
  wrap?: string;
  /** The effect names, for `data-effects` (editor, checks). */
  names: string[];
}

/** The HTML side of a text box's effects (everything but curve). */
export function textEffectStyle(e: RenderTextEffects | undefined): TextEffectStyle {
  const out: TextEffectStyle = { style: "", cls: "", names: [] };
  if (!e) return out;
  const shadows: string[] = [];
  const sh = shadowParts(e);
  if (sh) {
    shadows.push(`${mm(sh[0])} ${mm(sh[1])} ${mm(sh[2])} ${sh[3]}`);
    out.names.push(e.shadow ? "shadow" : "lift");
  }
  const ol = outlineMm(e);
  if (ol > 0) {
    const c = hex(e.outline?.colour) as string;
    const d = ol / 2;
    const ring = [
      [d, 0],
      [-d, 0],
      [0, d],
      [0, -d],
      [d, d],
      [-d, d],
      [d, -d],
      [-d, -d],
    ]
      .map(([x, y]) => `${mm(x)} ${mm(y)} 0 ${c}`)
      .join(",");
    out.style += `-webkit-text-stroke:${mm(ol)} ${c};paint-order:stroke fill;--ds-ol-fb:${ring}${shadows.length ? `,${shadows.join(",")}` : ""};`;
    out.cls += " ds-fx-outline";
    out.names.push("outline");
  }
  if (shadows.length) out.style += `text-shadow:${shadows.join(",")};`;
  if (e.highlight && hex(e.highlight.colour)) {
    const r = int(e.highlight.radius, 0, 100) * 0.005;
    out.wrap = `<span class="ds-hl" style="background:${hex(e.highlight.colour)};border-radius:${n3(r)}em;">`;
    out.names.push("highlight");
  }
  return out;
}

/** The curve's arc angle in radians (0 = straight). */
export const curveAngle = (e: RenderTextEffects | undefined): number => (e?.curve ? (int(e.curve.radius, -100, 100) / 100) * Math.PI : 0);

/**
 * A single-line text box on an arc (SVG textPath). Sizes are CSS px (no
 * viewBox), so the text style's pt sizes apply as in HTML text.
 */
export function curveSvg(el: ElementOf<"text">, ctx: RenderContext, e: RenderTextEffects): string {
  const theta = curveAngle(e);
  const W = el.frame.w * PX_PER_MM;
  const H = el.frame.h * PX_PER_MM;
  const st = TEXT_STYLES[el.props.style] ?? TEXT_STYLES.body;
  const fontPx = st.sizePt * (FORMAT_TYPE_SCALE[ctx.format.id] ?? 1) * (96 / 72);
  const half = Math.abs(theta) / 2;
  const R = W / 2 / Math.sin(half);
  const sag = R * (1 - Math.cos(half));
  const up = theta > 0;
  const yEnd = up ? H / 2 + sag / 2 + 0.25 * fontPx : H / 2 - sag / 2 + 0.25 * fontPx;
  const id = `ds-curve-${el.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const d = `M 0 ${n3(yEnd)} A ${n3(R)} ${n3(R)} 0 0 ${up ? 1 : 0} ${n3(W)} ${n3(yEnd)}`;
  const align = el.props.align === "right" ? ["100%", "end"] : el.props.align === "left" || el.props.align === "justify" ? ["0%", "start"] : ["50%", "middle"];
  const ol = outlineMm(e);
  const stroke = ol > 0 ? ` stroke="${hex(e.outline?.colour)}" stroke-width="${n3(ol * PX_PER_MM)}" stroke-linejoin="round" paint-order="stroke fill"` : "";
  const sh = shadowParts(e);
  const filter = sh ? ` style="filter:drop-shadow(${mm(sh[0])} ${mm(sh[1])} ${mm(sh[2] / 2)} ${sh[3]})"` : "";
  return (
    `<svg class="ds-curve" width="100%" height="100%" overflow="visible" aria-hidden="true"${filter}>` +
    `<path id="${esc(id)}" d="${d}" fill="none" stroke="none"/>` +
    `<text fill="currentColor"${stroke}><textPath href="#${esc(id)}" startOffset="${align[0]}" text-anchor="${align[1]}">${renderTextDocSvg(el.props.doc, ctx)}</textPath></text></svg>`
  );
}
