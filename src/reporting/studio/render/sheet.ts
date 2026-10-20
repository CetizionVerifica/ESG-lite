/**
 * DS-1 · free-form sheets: a fixed-size page of the doc's format with
 * absolutely positioned elements in mm (rotation, z-order, transparency), a
 * colour or image background, and — in print mode — background and elements
 * flagged `bleed` reaching into the bleed. Free-form pages never paginate and
 * never grow.
 */
import { assetUrl, type RenderContext } from "./context";
import { renderElementInner } from "./elements";
import { bleedFor } from "./formats";
import { contrastRatio, mix, type Theme } from "./theme";
import type { RenderElement, RenderFreeformPage, RenderOptions } from "./types";
import { esc, hex, mm, n3 } from "./util";

export function renderElement(el: RenderElement, ctx: RenderContext): string {
  if (el.hidden) return "";
  const f = el.frame;
  const out = renderElementInner(el, ctx);
  const style =
    `left:${mm(f.x)};top:${mm(f.y)};width:${mm(f.w)};height:${mm(f.h)};z-index:${Math.round(el.z)};` +
    (f.rotation ? `transform:rotate(${n3(f.rotation)}deg);` : "") +
    (el.opacity !== undefined && el.opacity < 1 ? `opacity:${n3(Math.max(0, el.opacity))};` : "");
  return (
    `<div class="ds-el ds-el--${esc(el.type)}${out.cls ? ` ${out.cls}` : ""}" data-el-id="${esc(el.id)}" data-type="${esc(el.type)}"` +
    ` data-frame="${n3(f.x)},${n3(f.y)},${n3(f.w)},${n3(f.h)},${n3(f.rotation)}"${out.attrs ?? ""} style="${style}">${out.html}</div>`
  );
}

function background(page: RenderFreeformPage, ctx: RenderContext, bleed: number): string {
  const url = assetUrl(ctx, page.background.assetId);
  if (!url) return "";
  const inset = bleed ? `-${mm(bleed)}` : "0";
  return `<div class="ds-bg" style="inset:${inset}"><img src="${esc(url)}" alt="" style="object-fit:${page.background.fit === "contain" ? "contain" : "cover"}"></div>`;
}

function guides(page: RenderFreeformPage, ctx: RenderContext): string {
  const s = ctx.format;
  const lines = (page.guides ?? [])
    .map((g) => (g.axis === "x" ? `<div class="ds-guide ds-guide--x" style="left:${mm(g.mm)}"></div>` : `<div class="ds-guide ds-guide--y" style="top:${mm(g.mm)}"></div>`))
    .join("");
  const bleed = s.bleedMm ? `<div class="ds-guide-bleed" style="inset:-${mm(s.bleedMm)}"></div>` : "";
  return `<div class="ds-guides" aria-hidden="true"><div class="ds-guide-safe" style="inset:${mm(s.safeMm)}"></div>${bleed}${lines}</div>`;
}

/**
 * A page colour the theme's ink can't be read on (a dark cover in a light
 * look, or the reverse) switches the page's text colours, so elements without
 * their own colour stay legible. Deterministic: from the colours alone.
 */
export function pageColourVars(bg: string | null, theme: Theme): string {
  if (!bg || contrastRatio(bg, theme.colors.ink) >= 4.5) return "";
  const ink = contrastRatio(bg, "#FFFFFF") >= contrastRatio(bg, "#0F172A") ? "#FFFFFF" : "#0F172A";
  const primary = contrastRatio(bg, theme.colors.primary) >= 3 ? theme.colors.primary : contrastRatio(bg, theme.colors.accent) >= 3 ? theme.colors.accent : ink;
  return `--ink:${ink};--muted:${mix(ink, bg, 0.3)};--primary:${primary};--border:${mix(ink, bg, 0.75)};--surface:${mix(ink, bg, 0.9)};--good:${mix(theme.colors.good, ink, 0.55)};--bad:${mix(theme.colors.bad, ink, 0.55)};color:${ink};`;
}

/** One free-form page as a `<section class="ds-sheet">`. */
export function renderSheetHtml(page: RenderFreeformPage, ctx: RenderContext, opts: Pick<RenderOptions, "guides" | "watermark">): string {
  const s = ctx.format;
  const bleed = bleedFor(s.id, ctx.mode);
  const bg = hex(page.background.color);
  const els = [...page.elements]
    .sort((a, b) => a.z - b.z)
    .map((e) => renderElement(e, ctx))
    .join("");
  const bleedBox = bleed && bg ? `<div class="ds-bleed-fill" style="inset:-${mm(bleed)};background:${bg}"></div>` : "";
  const mark = opts.watermark ? `<div class="ds-watermark" aria-hidden="true"><span>${esc(opts.watermark)}</span></div>` : "";
  const anchor = page.bookmark ? ` data-bookmark="${esc(page.bookmark)}"` : "";
  // Paged.js lays a sheet into a page box of exactly the format's height; a
  // sub-pixel rounding would push a sliver onto a new page, so paged sheets are
  // 1 px shorter and their colour is carried to the edge by a 1 px shadow.
  const paged = ctx.mode === "paged" || ctx.mode === "print";
  const height = paged ? `calc(${mm(s.hMm)} - 1px)` : mm(s.hMm);
  return (
    `<section class="ds-sheet" id="page-${esc(page.id)}" data-page-id="${esc(page.id)}" data-page-name="${esc(page.name)}" data-page-no="${ctx.pageNo}"${anchor}` +
    ` data-w="${n3(s.wMm)}" data-h="${n3(s.hMm)}" data-safe="${n3(s.safeMm)}" data-bleed="${n3(bleed)}"` +
    ` style="width:${mm(s.wMm)};height:${height};${bg ? `background-color:${bg};${paged ? `box-shadow:0 1px 0 0 ${bg};` : ""}` : ""}${pageColourVars(bg, ctx.theme)}">` +
    (page.bookmark ? `<h1 class="ds-bookmark">${esc(page.bookmark)}</h1>` : "") +
    bleedBox +
    background(page, ctx, bleed) +
    els +
    mark +
    (ctx.mode === "sheet" && opts.guides ? guides(page, ctx) : "") +
    `</section>`
  );
}
