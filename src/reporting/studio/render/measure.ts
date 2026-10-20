/**
 * DS-1 · `window.__measure()`: what the browser knows and the doc doesn't.
 * Exported as a script string (the renderer stays pure; html.ts and the FE
 * shadow root inject it). One Measurement per element on a free-form sheet:
 *   rectMm        the element's box in mm from the sheet's top-left (unrotated);
 *   overflowMm    text taller than its frame (TEXT_OVERFLOW);
 *   outsideSafe   the frame leaves the format's safe area (OUTSIDE_SAFE_AREA);
 *                 elements flagged bleed are exempt;
 *   outsidePage   the frame leaves the trim box (bleed elements: the bleed box);
 *   minFontPt     the smallest rendered font size of its text (FONT_TOO_SMALL);
 *   contrast      text colour vs the nearest opaque background (LOW_CONTRAST),
 *                 `onImage` when an image lies behind it.
 * DS-12 maps these to checks; DS-1 tests use them for position accuracy.
 */

export interface Measurement {
  pageId: string;
  elementId: string;
  type: string;
  rectMm: { x: number; y: number; w: number; h: number };
  overflowMm: number;
  outsideSafe: boolean;
  outsidePage: boolean;
  minFontPt: number | null;
  contrast: number | null;
  onImage: boolean;
  bleed: boolean;
}

export const MEASURE_JS = `(function(){
var PX_PER_MM = 96 / 25.4;
function r3(v){ return Math.round(v * 1000) / 1000; }
function parse(c){ var m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if(!m) return null; var p = m[1].split(',').map(function(s){ return parseFloat(s); }); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
function lum(c){ var a = [c.r, c.g, c.b].map(function(x){ x = x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; }
function ratio(a, b){ var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function bgOf(el, sheet){ var n = el; while(n && n !== sheet.parentNode){ var c = parse(getComputedStyle(n).backgroundColor); if(c && c.a > 0.5) return c; n = n.parentNode; } return { r: 255, g: 255, b: 255, a: 1 }; }
window.__measure = function(root){
  root = root || document;
  var out = [];
  var sheets = root.querySelectorAll('.ds-sheet');
  for(var s = 0; s < sheets.length; s++){
    var sheet = sheets[s];
    var W = parseFloat(sheet.getAttribute('data-w')), H = parseFloat(sheet.getAttribute('data-h'));
    var safe = parseFloat(sheet.getAttribute('data-safe')) || 0;
    var hasImg = !!sheet.querySelector('.ds-bg img');
    var els = sheet.querySelectorAll(':scope > .ds-el');
    for(var i = 0; i < els.length; i++){
      var el = els[i];
      var x = el.offsetLeft / PX_PER_MM, y = el.offsetTop / PX_PER_MM, w = el.offsetWidth / PX_PER_MM, h = el.offsetHeight / PX_PER_MM;
      var bleed = el.getAttribute('data-bleed') === 'true';
      var eps = 0.05;
      var outsideSafe = !bleed && (x < safe - eps || y < safe - eps || x + w > W - safe + eps || y + h > H - safe + eps);
      var allow = bleed ? (parseFloat(sheet.getAttribute('data-bleed')) || 3) : 0;
      var outsidePage = x < -allow - eps || y < -allow - eps || x + w > W + allow + eps || y + h > H + allow + eps;
      var overflow = 0;
      var inner = el.querySelector('.ds-text-in, .ds-callout-text');
      if(inner){ var box = inner.closest('.ds-text, .ds-callout') || el; overflow = Math.max(0, inner.scrollHeight - box.clientHeight) / PX_PER_MM; if(overflow < 0.3) overflow = 0; }
      var minPt = null, contrast = null;
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var t;
      while((t = walker.nextNode())){
        if(!t.nodeValue || !t.nodeValue.trim()) continue;
        var p = t.parentElement; if(!p || p.closest('svg')) continue;
        var cs = getComputedStyle(p);
        var pt = parseFloat(cs.fontSize) * 0.75;
        if(minPt === null || pt < minPt) minPt = pt;
        var fg = parse(cs.color);
        if(fg){ var c = ratio(fg, bgOf(p, sheet)); if(contrast === null || c < contrast) contrast = c; }
      }
      out.push({ pageId: sheet.getAttribute('data-page-id'), elementId: el.getAttribute('data-el-id'), type: el.getAttribute('data-type'),
        rectMm: { x: r3(x), y: r3(y), w: r3(w), h: r3(h) }, overflowMm: r3(overflow), outsideSafe: outsideSafe, outsidePage: outsidePage,
        minFontPt: minPt === null ? null : r3(minPt), contrast: contrast === null ? null : r3(contrast), onImage: hasImg, bleed: bleed });
    }
  }
  return out;
};
})();`;
