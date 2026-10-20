/**
 * DS-11 · GET /docs/:id/preview.html?mode=sheet|paged|present|print&pageId=&rev=
 * (RS-5 §1, 01-contracts §4): the doc's current draft, resolved (DS-2) and
 * rendered by the one renderer (DS-1 html.ts) as a self-contained page:
 * fonts and images inlined, no network, no session needed inside it.
 *
 * The FE loads it with the session (fetch) and shows it in a sandboxed
 * iframe (`sandbox="allow-scripts"`, srcdoc, no same-origin), so the CSP sits
 * in a <meta> as well as in the response headers. A small bridge script
 * talks to the host page with postMessage:
 *   → {source:'ds-preview', type:'ready', pageCount, error}
 *   → {source:'ds-preview', type:'select', pageId, elId}       (a click, Page view → editor)
 *   → {source:'ds-preview', type:'slide', index, count, pageId} (present mode, on every change)
 *   → {source:'ds-preview', type:'key', key}                   (Escape, n for notes: the host acts)
 *   ← {source:'ds-host', type:'go', index}                     (present mode: jump to a slide)
 *
 * `pageId` limits the render to one page (sheet thumbnails, DS-5 live
 * template cards); `rev` is only a cache key (the current draft is always
 * rendered and `X-Doc-Rev` says which rev it was).
 */
import { DsError, PreviewQuerySchema, ReportDocSchema, dsDocInvalid, type ReportDoc } from "../contracts";
import type { StudioCaller } from "../guard";
import { parse } from "../http";
import { loadDocRow } from "../docs/store";
import { documentHtml } from "../../reporting/studio/html";
import type { RenderDoc } from "../../reporting/studio/render/types";
import { renderInputs } from "./inputs";

export const PREVIEW_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

export const BRIDGE_JS = `
(function(){
  function post(m){ try { m.source = 'ds-preview'; parent.postMessage(m, '*'); } catch (e) {} }
  var lastIndex = -1;
  var t = setInterval(function(){
    if (!window.__ready) return;
    if (lastIndex === -1 && !window.__bridgeReady) { window.__bridgeReady = true; post({ type: 'ready', pageCount: window.__pageCount || 0, error: window.__error ? String(window.__error).slice(0, 300) : null }); }
    var p = window.__present;
    if (!p) { clearInterval(t); return; }
    if (p.index !== lastIndex) {
      lastIndex = p.index;
      var s = document.querySelectorAll('.ds-sheet, .ds-flow')[p.index];
      post({ type: 'slide', index: p.index, count: p.count, pageId: s ? s.getAttribute('data-page-id') : null });
    }
  }, 80);
  window.addEventListener('message', function(e){
    var d = e.data || {};
    if (d.source !== 'ds-host') return;
    if (d.type === 'go' && window.__present && typeof d.index === 'number') window.__present.go(d.index);
  });
  document.addEventListener('click', function(e){
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var el = t.closest('[data-el-id]');
    var pg = t.closest('[data-page-id]');
    post({ type: 'select', pageId: pg ? pg.getAttribute('data-page-id') : null, elId: el ? el.getAttribute('data-el-id') : null });
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' || e.key === 'n' || e.key === 'N') post({ type: 'key', key: e.key });
  });
})();`;

/** Adds the CSP meta and the bridge script to a rendered document. */
export function withBridge(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  const withMeta = html.replace(/<head>/i, `<head>\n${meta}`);
  const i = withMeta.lastIndexOf("</body>");
  return i < 0 ? withMeta + `<script>${BRIDGE_JS}</script>` : `${withMeta.slice(0, i)}<script>${BRIDGE_JS}</script>\n${withMeta.slice(i)}`;
}

export async function previewHtml(caller: StudioCaller, docId: number, query: unknown): Promise<{ html: string; rev: number }> {
  const row = await loadDocRow(caller, docId);
  const q = parse(PreviewQuerySchema, query ?? {});
  const parsed = ReportDocSchema.safeParse(row.draft);
  if (!parsed.success) throw dsDocInvalid(parsed.error.issues);
  let doc: ReportDoc = parsed.data;
  if (q.pageId) {
    const page = doc.pages.find((p) => p.id === q.pageId);
    if (!page) throw new DsError("DS_DOC_NOT_FOUND", { pageId: q.pageId });
    doc = { ...doc, pages: [page] };
  }
  const inputs = await renderInputs(caller, doc, { docId: row.id });
  const { document } = documentHtml(doc as unknown as RenderDoc, inputs.data, {
    mode: q.mode,
    brand: inputs.brand,
    assets: inputs.assets,
    inlineFonts: true,
    cropMarks: q.mode === "print" && q.cropMarks === "1",
  });
  return { html: withBridge(document), rev: row.rev };
}
