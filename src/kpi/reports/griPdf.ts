/**
 * KPI-11 · the GRI content index as a PDF: a new HTML template in the
 * client's brand (src/reporting/brands.ts `getBrandTheme`), printed by the
 * existing Playwright printer (src/reporting/print.ts `htmlToPdf`, unchanged).
 * Like the GHG report the page is self-contained: paged.js is inlined and the
 * page sets `window.__ready` once it has paginated. Every text from data is
 * escaped.
 */
import { readFileSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getBrandTheme } from "../../reporting/brands";
import { htmlToPdf } from "../../reporting/print";
import type { Theme } from "../../reporting/types";
import { inOrder, itemNotes, valueCell, whereOf } from "./gri";
import type { AuditEntry } from "./load";
import type { ReportModel } from "./model";

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const color = (c: string) => (/^#[0-9a-fA-F]{3,8}$/.test(c) ? c : "#14213D");
const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-GB", { maximumFractionDigits: 6 }) : esc(v));

let pagedCache: string | null = null;
const pagedJs = () => {
  if (pagedCache !== null) return pagedCache;
  for (const p of ["node_modules/pagedjs/dist/paged.polyfill.min.js", "node_modules/pagedjs/dist/paged.polyfill.js"]) {
    try {
      pagedCache = readFileSync(p, "utf8");
      return pagedCache;
    } catch {
      /* next */
    }
  }
  throw new Error("paged.js not found");
};

/** The HTML of the GRI content index (`withScripts: false` for a snapshot without the inlined paged.js). */
export function griHtml(model: ReportModel, theme: Theme, audit: AuditEntry[], opts: { withScripts?: boolean } = {}): string {
  const c = theme.colors;
  const lines: string[] = [];
  let section = "";
  for (const e of inOrder(model)) {
    if (e.section !== section) {
      section = e.section;
      lines.push(`<tr class="section"><th colspan="7">${esc(section)}</th></tr>`);
    }
    if (e.kind === "omission") {
      lines.push(`<tr class="omitted"><td class="code">${esc(e.o.code)}</td><td>${esc(e.o.title)}</td><td colspan="4" class="muted">Omitted</td><td>${esc(e.o.reason)}</td></tr>`);
      continue;
    }
    e.r.items.forEach((i, n) => {
      const v = valueCell(i);
      lines.push(
        `<tr><td class="code">${n === 0 ? esc(e.r.code) : ""}</td><td>${n === 0 ? esc(e.r.title) : ""}<div class="kpi">${esc(i.name)}</div></td><td class="num">${num(v)}</td><td>${esc(i.unit)}</td><td>${esc(whereOf(i, model))}</td><td class="num">${i.status === "approved" ? num(i.previous) : ""}</td><td>${esc([itemNotes(i, model), i.status === "excluded" ? `Excluded: ${i.reason}` : null, i.evidence_count ? `${i.evidence_count} evidence file(s).` : null].filter(Boolean).join(" "))}</td></tr>`,
      );
    });
  }
  const scripts = opts.withScripts === false ? "" : `<script>window.PagedConfig = { auto: false };</script><script>${pagedJs()}</script>
<script>(async function(){try{await window.PagedPolyfill.preview();}catch(e){window.__error=String(e&&e.stack||e);}window.__ready=true;})();</script>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(`GRI content index · ${model.company.name} · ${model.label}`)}</title>
<style>
@page { size: A4 landscape; margin: 16mm 14mm 18mm 14mm; @bottom-left { content: ${JSON.stringify(theme.footer.replace(/</g, ""))}; font-size: 7pt; color: ${color(c.muted)}; } @bottom-right { content: counter(page) " / " counter(pages); font-size: 7pt; color: ${color(c.muted)}; } }
body { font-family: ${theme.fonts.body.replace(/[<>]/g, "")}; color: ${color(c.ink)}; font-size: 8.5pt; }
h1 { font-family: ${theme.fonts.heading.replace(/[<>]/g, "")}; color: ${color(c.primary)}; font-size: 20pt; margin: 0 0 2mm; }
.lead { color: ${color(c.muted)}; margin: 0 0 6mm; }
.logo { float: right; max-height: 14mm; max-width: 50mm; }
.logo svg, .logo img { max-height: 14mm; max-width: 50mm; }
table { width: 100%; border-collapse: collapse; }
thead th { background: ${color(c.primary)}; color: ${color(c.onPrimary)}; text-align: left; padding: 1.6mm; font-weight: 600; }
tr.section th { background: ${color(c.surface)}; color: ${color(c.primary)}; text-align: left; padding: 1.8mm 1.6mm; border-top: 0.4mm solid ${color(c.accent)}; }
td { padding: 1.4mm 1.6mm; border-bottom: 0.2mm solid ${color(c.border)}; vertical-align: top; }
td.code { white-space: nowrap; font-weight: 600; }
td.num { text-align: right; white-space: nowrap; }
.kpi { color: ${color(c.muted)}; font-size: 7.5pt; }
.muted, tr.omitted td { color: ${color(c.muted)}; }
tr { break-inside: avoid; }
tr.section { break-after: avoid; }
</style></head>
<body>
<div class="logo">${theme.logoSvg ?? ""}</div>
<h1>GRI content index</h1>
<p class="lead">${esc(model.company.name)} · ${esc(model.label)} · ${esc(model.framework_name)} (${esc(model.version)}). Approved values only; previous year ${esc(model.previous_label)}. ${model.pending.count} value(s) pending review aren't included. ${audit.length} value(s) behind these figures are listed in the XLSX audit trail.</p>
<table>
<thead><tr><th>Disclosure</th><th>Title and KPI</th><th>Value</th><th>Unit</th><th>Where</th><th>${esc(model.previous_label)}</th><th>Notes and omissions</th></tr></thead>
<tbody>
${lines.join("\n")}
</tbody></table>
${scripts}
</body></html>`;
}

/** Renders the PDF through the existing printer and returns its bytes. */
export async function griPdf(model: ReportModel, audit: AuditEntry[]): Promise<Buffer> {
  const theme = await getBrandTheme(model.company.id, model.company.name);
  const path = join(tmpdir(), `kpi-gri-${randomUUID()}.pdf`);
  try {
    await htmlToPdf(griHtml(model, theme, audit), path);
    return await readFile(path);
  } finally {
    await unlink(path).catch(() => {});
  }
}
