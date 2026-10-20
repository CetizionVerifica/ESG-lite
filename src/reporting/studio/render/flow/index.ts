/**
 * DS-1 · flow sections: content that paginates (Paged.js, named page `flow`
 * with margins and running footer). One renderer per FlowType:
 *   toc, narrative, data_tables, methodology, glossary,
 *   gri_index, brsr_index, esrs_index, ghgp_index, iso_index,
 *   ghg_factor_table, scope3_categories.
 * Tables repeat their header on every page (html.ts) and never split a row.
 * Rows and figures come from RenderData (DS-2 / DS-4 fill them); a section
 * with no rows shows "Not reported" with a reason.
 */
import type { RenderContext } from "../context";
import { notReported } from "../data";
import { sectionFootnotes } from "../footnotes";
import { formatNumber } from "../format";
import { renderTextDoc } from "../text";
import type { FlowRow, FlowTable, RenderFlowSection, RenderOptions, Scope3CategoryRow } from "../types";
import { esc } from "../util";

const INDEX_TITLES: Record<string, string> = {
  gri_index: "GRI content index",
  brsr_index: "BRSR index",
  esrs_index: "ESRS index",
  ghgp_index: "GHG Protocol reporting index",
  iso_index: "ISO 14064-1 reporting index",
};

const cell = (c: string | number | null): string => (c === null || c === undefined ? "–" : typeof c === "number" ? formatNumber(c) : esc(c));

/** A page reference: the target's page number (target-counter in paged modes). */
const pageRef = (ref: string | undefined): string => (ref ? `<a class="ds-ref" href="#${esc(ref)}"></a>` : "");

export function flowTableHtml(t: FlowTable, cls = ""): string {
  const head = `<thead><tr>${t.columns.map((c, i) => `<th${i > 0 ? ' class="num"' : ""}>${esc(c)}</th>`).join("")}${t.rows.some((r) => r.ref) ? '<th class="num">Page</th>' : ""}</tr></thead>`;
  const hasRef = t.rows.some((r) => r.ref);
  const rows = t.rows
    .map((r: FlowRow) => {
      if (r.group) return `<tr class="ds-group"><th colspan="${t.columns.length + (hasRef ? 1 : 0)}">${cell(r.cells[0] ?? "")}</th></tr>`;
      const cells = r.cells.map((c, i) => `<td${i > 0 && (typeof c === "number" || c === null) ? ' class="num"' : ""}>${i === 0 && r.mark ? `<span class="ds-mark">${esc(r.mark)}</span> ` : ""}${cell(c)}</td>`).join("");
      return `<tr>${cells}${hasRef ? `<td class="num">${pageRef(r.ref)}</td>` : ""}</tr>`;
    })
    .join("");
  return `<table class="ds-table ds-table--lined ds-flow-table ${cls}">${head}<tbody>${rows}</tbody></table>${t.note ? `<p class="ds-flow-note ts-caption">${esc(t.note)}</p>` : ""}`;
}

function tableOrMissing(section: RenderFlowSection, ctx: RenderContext, cls = ""): string {
  const t = ctx.data.flow?.[section.id];
  if (!t || !t.rows.length) return `<p class="ds-flow-missing">${notReported("NO_ROWS")}</p>`;
  return flowTableHtml(t, cls);
}

function toc(ctx: RenderContext, self: string): string {
  const items = ctx.pages
    .filter((p) => p.id !== self && (p.bookmark || p.kind === "flow"))
    .map((p, i) => {
      const paged = ctx.mode === "paged" || ctx.mode === "print";
      return `<li><a class="ds-toc-link" href="#page-${esc(p.id)}"><span class="ds-toc-name">${esc(p.bookmark ?? p.name)}</span><span class="ds-toc-dots"></span>${paged ? "" : `<span class="ds-toc-page">${i + 1}</span>`}</a></li>`;
    })
    .join("");
  return `<ol class="ds-toc">${items}</ol>`;
}

const SCOPE3_STATUS: Record<Scope3CategoryRow["status"], string> = { reported: "Reported", excluded: "Excluded", not_addressed: "Not addressed" };

function scope3(section: RenderFlowSection, ctx: RenderContext): string {
  const rows = ctx.data.scope3?.[section.id];
  if (!rows || !rows.length) return `<p class="ds-flow-missing">${notReported("NO_ROWS")}</p>`;
  const wanted = section.options.categories?.length ? new Set(section.options.categories) : null;
  const showDq = section.options.showDq !== false;
  const showMethod = section.options.showMethod !== false;
  const head = `<thead><tr><th>Category</th><th>Status</th><th class="num">tCO₂e</th>${showMethod ? "<th>Method</th>" : ""}${showDq ? "<th>Data quality</th>" : ""}<th>Reason</th></tr></thead>`;
  const body = rows
    .filter((r) => !wanted || wanted.has(r.n))
    .sort((a, b) => a.n - b.n)
    .map(
      (r) =>
        `<tr data-category="${r.n}" data-status="${r.status}"><td>Scope 3 Category ${r.n}: ${esc(r.name)}</td><td><span class="ds-status ds-status--${r.status}">${SCOPE3_STATUS[r.status]}</span></td>` +
        `<td class="num">${r.status === "reported" && r.display ? esc(r.display) : "–"}</td>${showMethod ? `<td>${esc(r.method ?? "")}</td>` : ""}${showDq ? `<td>${esc(r.dq ?? "")}</td>` : ""}<td>${esc(r.reason ?? "")}</td></tr>`,
    )
    .join("");
  return `<table class="ds-table ds-table--lined ds-flow-table ds-scope3">${head}<tbody>${body}</tbody></table>`;
}

function body(section: RenderFlowSection, ctx: RenderContext): string {
  const content = renderTextDoc(section.content, ctx);
  switch (section.flowType) {
    case "toc":
      return toc(ctx, section.id);
    case "narrative":
      return `<div class="ds-narrative ts-body"${section.options.columns === 2 ? ' data-columns="2"' : ""}>${content}</div>`;
    case "data_tables":
      return (content ? `<div class="ds-narrative ts-body">${content}</div>` : "") + tableOrMissing(section, ctx, "ds-data-table");
    case "methodology":
    case "glossary": {
      const t = ctx.data.flow?.[section.id];
      return `<div class="ds-narrative ts-body"${section.options.columns === 2 ? ' data-columns="2"' : ""}>${content}</div>${t && t.rows.length ? flowTableHtml(t) : ""}`;
    }
    case "ghg_factor_table":
      return (content ? `<div class="ds-narrative ts-body">${content}</div>` : "") + tableOrMissing(section, ctx, "ds-factor-table");
    case "scope3_categories":
      return (content ? `<div class="ds-narrative ts-body">${content}</div>` : "") + scope3(section, ctx);
    default:
      if (INDEX_TITLES[section.flowType]) return (content ? `<div class="ds-narrative ts-body">${content}</div>` : "") + tableOrMissing(section, ctx, "ds-index");
      return content;
  }
}

/** DS-7: a section's footnotes, numbered per section, after its content. Styled inline. */
function sectionNotes(section: RenderFlowSection): string {
  const notes = sectionFootnotes(section);
  if (!notes.length) return "";
  const items = notes.map((n, i) => `<p class="ds-fn" style="margin:0;"><sup>${i + 1}</sup> ${esc(n)}</p>`).join("");
  return `<aside class="ds-footnotes ts-footnote" role="note" aria-label="Footnotes" style="margin-top:4mm;border-top:0.2mm solid var(--border);padding-top:1mm;break-inside:avoid;">${items}</aside>`;
}

/** One flow section as a `<section class="ds-flow">` (paginated by Paged.js in paged and print modes). */
export function renderFlowHtml(section: RenderFlowSection, ctx: RenderContext, opts: Pick<RenderOptions, "watermark">): string {
  const title = section.name || INDEX_TITLES[section.flowType] || "";
  const startRight = section.options.startOnRight ? " ds-flow--right" : "";
  return (
    `<section class="ds-flow ds-flow--${esc(section.flowType)}${startRight}" id="page-${esc(section.id)}" data-page-id="${esc(section.id)}" data-flow-type="${esc(section.flowType)}"${opts.watermark ? ` data-watermark="${esc(opts.watermark)}"` : ""}>` +
    (title ? `<h1 class="ds-flow-title ts-heading">${esc(section.bookmark ?? title)}</h1>` : "") +
    body(section, ctx) +
    sectionNotes(section) +
    `</section>`
  );
}
