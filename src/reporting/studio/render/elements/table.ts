/**
 * DS-1 · table: lined / zebra / minimal, tabular numbers, optional total row.
 * Cells come from the element's own rows, custom data, the source's
 * pre-formatted `table`, or the series (one row per series, one column per key).
 */
import { dataMarks, lookup, notReported, unavailableReason } from "../data";
import { formatNumber } from "../format";
import type { RenderValue } from "../types";
import { esc } from "../util";
import { UNLINKED_BADGE } from "./chart";
import type { ElementRenderer } from "./types";

type Cell = string | number | null;

export const tableFromValue = (v: RenderValue): { columns: string[]; rows: Cell[][] } => {
  if (v.table) return v.table;
  const series = v.series ?? [];
  const keys: string[] = [];
  for (const s of series) for (const p of s.values) if (!keys.includes(p.key)) keys.push(p.key);
  return { columns: ["", ...keys], rows: series.map((s) => [s.label, ...keys.map((k) => s.values.find((p) => p.key === k)?.value ?? null)]) };
};

const cell = (c: Cell): string => (c === null || c === undefined ? "–" : typeof c === "number" ? formatNumber(c) : esc(c));

export function tableHtml(columns: string[], rows: Cell[][], style: string, totalRow: boolean): string {
  const numeric = columns.map((_, i) => i > 0 && rows.length > 0 && rows.every((r) => typeof r[i] === "number" || r[i] === null || r[i] === undefined));
  const head = columns.length ? `<thead><tr>${columns.map((c, i) => `<th${numeric[i] ? ' class="num"' : ""}>${esc(c)}</th>`).join("")}</tr></thead>` : "";
  const body = rows
    .map((r, ri) => `<tr${totalRow && ri === rows.length - 1 ? ' class="ds-total"' : ""}>${r.map((c, i) => `<td${i && (typeof c === "number" || c === null) ? ' class="num"' : ""}>${cell(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table class="ds-table ds-table--${esc(style)}">${head}<tbody>${body}</tbody></table>`;
}

export const tableElement: ElementRenderer<"table"> = (el, ctx) => {
  const p = el.props;
  const b = p.binding;
  if (!b) return { html: tableHtml(p.columns ?? [], p.rows ?? [], p.style, !!p.totalRow) };
  if (b.source === "custom") return { html: tableHtml(b.columns ?? [], b.rows ?? [], p.style, !!p.totalRow) + UNLINKED_BADGE, attrs: dataMarks(b, null) };
  const v = lookup(ctx.data, b);
  const reason = unavailableReason(v);
  if (reason || !v) return { html: `<div class="ds-table-nr">${notReported(reason ?? "NOT_RESOLVED")}</div>`, attrs: dataMarks(b, v) };
  const t = tableFromValue(v);
  return { html: tableHtml(p.columns?.length ? p.columns : t.columns, t.rows, p.style, !!p.totalRow), attrs: dataMarks(b, v) };
};
