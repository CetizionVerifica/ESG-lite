/**
 * DS-1 · Node-only wrapper (not mirrored): a complete HTML document for a
 * render, with @font-face (URLs, or inlined for jobs), the stylesheet,
 * Paged.js for paged and print modes, the present-mode shell, and
 * window.__ready / window.__measure. Patterns from src/reporting/render.ts
 * (Paged.js inlined, PagedConfig auto off), not imported from it.
 */
import { readFileSync } from "node:fs";
import { fontBase64 } from "./fonts/files";
import { renderDocument, type RenderResult } from "./render";
import { FONTS, fontFile } from "./render/fonts";
import { MEASURE_JS } from "./render/measure";
import { buildTheme } from "./render/theme";
import type { FontId, RenderBrand, RenderData, RenderDoc, RenderOptions, RenderStyle } from "./render/types";
import { esc } from "./render/util";

export interface HtmlOptions extends RenderOptions {
  brand?: RenderBrand | null;
  style?: RenderStyle | null;
  /** Inline the WOFF2 files as data: URLs (render jobs: no network). */
  inlineFonts?: boolean;
}

let pagedCache: string | null = null;
const pagedJs = (): string => {
  if (pagedCache !== null) return pagedCache;
  for (const rel of ["node_modules/pagedjs/dist/paged.polyfill.min.js", "node_modules/pagedjs/dist/paged.polyfill.js"]) {
    try {
      pagedCache = readFileSync(rel, "utf8");
      return pagedCache;
    } catch {
      /* next */
    }
  }
  try {
    pagedCache = readFileSync(require.resolve("pagedjs/dist/paged.polyfill.js"), "utf8");
    return pagedCache;
  } catch {
    throw new Error("pagedjs polyfill not found");
  }
};

function fontFaces(ids: FontId[], opts: HtmlOptions): string {
  const seen = new Set<FontId>();
  const out: string[] = [];
  for (const id of [...ids, "noto-sans" as FontId]) {
    if (seen.has(id) || !FONTS[id]) continue;
    seen.add(id);
    for (const w of FONTS[id].weights) {
      const file = fontFile(id, w);
      let src: string;
      if (opts.inlineFonts) {
        const b64 = fontBase64(file);
        if (!b64) continue;
        src = `data:font/woff2;base64,${b64}`;
      } else {
        src = `${opts.fontBase ?? "/studio/fonts/"}${file}`;
      }
      out.push(`@font-face{font-family:"${FONTS[id].family}";font-style:normal;font-weight:${w};font-display:block;src:url("${src}") format("woff2");}`);
    }
  }
  return out.join("\n");
}

/**
 * Paged.js handler: repeat a split table's header on the next page. When a
 * table continues, Paged.js rebuilds its ancestors (marked data-split-from)
 * and renders the first row into them; the header is inserted at that moment,
 * before the rest of the page is laid out, so its height counts.
 */
const REPEAT_THEAD = `
if (window.Paged) {
  class DsRepeatThead extends window.Paged.Handler {
    renderNode(clone, node){
      if(!clone || clone.nodeType !== 1 || clone.tagName !== 'TR') return;
      var table = clone.closest('table');
      if(!table || !table.hasAttribute('data-split-from') || table.querySelector(':scope > thead')) return;
      var src = node && node.closest ? node.closest('table') : null;
      var thead = src && src.querySelector(':scope > thead');
      if(thead) table.insertBefore(thead.cloneNode(true), table.firstChild);
    }
  }
  window.Paged.registerHandlers(DsRepeatThead);
}`;

const orchestration = (paged: boolean, present: boolean, watermark: string | undefined): string => `
(async function(){
  try{
    if(document.fonts && document.fonts.ready) await document.fonts.ready;
    await Promise.all(Array.prototype.map.call(document.images, function(img){ return img.complete ? null : new Promise(function(r){ img.onload = img.onerror = r; }); }));
    ${
      paged
        ? `await window.PagedPolyfill.preview();
    var pages = document.querySelectorAll('.pagedjs_page');
    Array.prototype.forEach.call(pages, function(pg, i){
      Array.prototype.forEach.call(pg.querySelectorAll('.ds-pn'), function(e){ e.textContent = String(i + 1); });
      Array.prototype.forEach.call(pg.querySelectorAll('.ds-pn-total'), function(e){ e.textContent = String(pages.length); });
      ${watermark ? `var area = pg.querySelector('.pagedjs_area') || pg; var w = document.createElement('div'); w.className = 'ds-watermark'; w.setAttribute('aria-hidden','true'); w.innerHTML = '<span>${esc(watermark)}</span>'; var box = pg.querySelector('.pagedjs_pagebox') || pg; box.style.position = 'relative'; box.appendChild(w);` : ""}
    });
    window.__pageCount = pages.length;`
        : `window.__pageCount = document.querySelectorAll('.ds-sheet, .ds-flow').length;`
    }
    ${
      present
        ? `var slides = Array.prototype.slice.call(document.querySelectorAll('.ds-sheet, .ds-flow'));
    var cur = 0;
    function fit(el){ var w = el.offsetWidth, h = el.offsetHeight; var s = Math.min(window.innerWidth / w, window.innerHeight / h); el.style.transform = 'translate(-50%,-50%) scale(' + s + ')'; }
    function go(n){ cur = Math.max(0, Math.min(slides.length - 1, n)); slides.forEach(function(s, i){ s.classList.toggle('is-current', i === cur); }); fit(slides[cur]); window.__present.index = cur; }
    window.__present = { go: go, index: 0, count: slides.length };
    document.addEventListener('keydown', function(e){ if(['ArrowRight','ArrowDown','PageDown',' '].indexOf(e.key) >= 0){ go(cur + 1); e.preventDefault(); } else if(['ArrowLeft','ArrowUp','PageUp'].indexOf(e.key) >= 0){ go(cur - 1); e.preventDefault(); } else if(e.key === 'Home') go(0); else if(e.key === 'End') go(slides.length - 1); });
    window.addEventListener('resize', function(){ if(slides[cur]) fit(slides[cur]); });
    if(slides.length) go(0);`
        : ""
    }
    window.__ready = true;
  }catch(e){
    window.__error = String(e && e.stack || e);
    window.__ready = true;
  }
})();`;

/** A complete, self-contained HTML document for a doc in a mode. */
export function documentHtml(doc: RenderDoc, data: RenderData | null | undefined, opts: HtmlOptions): RenderResult & { document: string } {
  const r = renderDocument(doc, data, opts, opts.brand, opts.style);
  const theme = buildTheme(doc.design?.theme, opts.brand, opts.style);
  const paged = opts.mode === "paged" || opts.mode === "print";
  const present = opts.mode === "present";
  const body = paged ? "" : "margin:0;background:#E9EDF2;padding:8mm 0;";
  const document = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.meta?.title ?? "Report")}</title>
<style>${fontFaces([theme.fonts.heading, theme.fonts.body], opts)}</style>
<style>html,body{${present ? "" : body}}${r.css}</style>
</head>
<body>
${r.html}
<script>${MEASURE_JS}</script>
${paged ? `<script>window.PagedConfig = { auto: false };</script>\n<script>${pagedJs()}</script>\n<script>${REPEAT_THEAD}</script>` : ""}
<script>${orchestration(paged, present, paged ? opts.watermark : undefined)}</script>
</body>
</html>`;
  return { ...r, document };
}
