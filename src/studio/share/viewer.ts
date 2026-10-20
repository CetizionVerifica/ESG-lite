/**
 * DS-11 · the public viewer page served at GET /s/:token: the company logo,
 * the design's title, which version it is, when the link expires, the stored
 * PDF in the browser's own PDF viewer, and a download link. No app chrome, no
 * scripts, no session. Pure: (share, paths) → HTML.
 */
import type { OpenShare } from "./service";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export const VIEWER_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-src 'self'; object-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const STYLE = `
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#f4f6f8;color:#14212b;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{display:flex;align-items:center;gap:16px;padding:12px 20px;background:#fff;border-bottom:1px solid #dde3e8}
header img{max-height:36px;max-width:160px;object-fit:contain}
.t{min-width:0;flex:1}
.t h1{margin:0;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t p{margin:2px 0 0;font-size:13px;color:#53616c}
a.dl{display:inline-block;padding:7px 14px;border-radius:6px;background:#14212b;color:#fff;text-decoration:none;font-size:14px;font-weight:500}
a.dl:focus-visible{outline:3px solid #2a7de1;outline-offset:2px}
main{height:calc(100% - 61px)}
iframe{display:block;width:100%;height:100%;border:0;background:#525659}
.msg{max-width:520px;margin:15vh auto;padding:32px;background:#fff;border:1px solid #dde3e8;border-radius:10px;text-align:center}
.msg h1{margin:0 0 8px;font-size:20px}
.msg p{margin:0;color:#53616c}
@media (prefers-color-scheme: dark){
  html,body{background:#0f171d;color:#e8edf1}
  header{background:#16222b;border-color:#24323d}
  .t p,.msg p{color:#9fb0bc}
  a.dl{background:#e8edf1;color:#0f171d}
  .msg{background:#16222b;border-color:#24323d}
}`;

export function viewerHtml(share: OpenShare, logoDataUrl: string | null, fileUrl: string): string {
  const title = `${share.title} · ${share.label}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
${logoDataUrl ? `<img src="${esc(logoDataUrl)}" alt="${esc(share.company)}">` : ""}
<div class="t"><h1>${esc(share.title)}</h1><p>${esc(share.company)} · ${esc(share.label)}${share.pageCount ? ` · ${share.pageCount} pages` : ""} · Read only · Link expires ${esc(day(share.expiresAt))}</p></div>
<a class="dl" href="${esc(fileUrl)}?download=1">Download PDF</a>
</header>
<main><iframe src="${esc(fileUrl)}" title="${esc(title)}"></iframe></main>
</body>
</html>`;
}

/** The page for a link that has expired, was turned off, or never existed. */
export function messageHtml(status: 404 | 410 | 429): string {
  const [h, p] =
    status === 410
      ? ["This link has expired", "This link has expired or was turned off. Ask the person who shared it for a new one."]
      : status === 429
        ? ["Too many requests", "Wait a minute, then try again."]
        : ["Link not found", "Check the link, or ask the person who shared it for a new one."];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${h}</title><style>${STYLE}</style></head>
<body><div class="msg" role="alert"><h1>${h}</h1><p>${p}</p></div></body></html>`;
}
