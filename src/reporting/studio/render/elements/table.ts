/**
 * DS-1 · table: lined / zebra / minimal, tabular numbers, optional total row.
 * Cells come from the element's own rows, custom data, the source's
 * pre-formatted `table`, or the series (one row per series, one column per key).
 * DS-8: `colWidths` (% of the frame) on any table; `merges` on static tables
 * only; on a bound table `columns` picks which of the source's columns show
 * (by header, the first column always kept).
 * #209: series cells are in their series' unit (the bound value's when the
 * series has none), so a tCO₂e row prints with 3 decimals (format.ts) and a
 * kL, % or per-gas row of the same binding keeps `auto`; static, custom and
 * source-formatted tables have no unit and keep `auto`.
 */
import { dataMarks, lookup, notReported, unavailableReason } from "../data";
import { formatNumber, seriesUnit, sharedUnit } from "../format";
import type { RenderValue } from "../types";
import { esc, n3 } from "../util";
import { UNLINKED_BADGE } from "./chart";
import type { ElementRenderer } from "./types";

type Cell = string | number | null;

/**
 * A bound value as a table, one row per series. `units` has the unit of each
 * row's number cells: its series' own, else the value's (#209 review: a KPI
 * binding mixes units, gas parts are tonnes of each gas). `unit` is the unit
 * every row shares, or null. Both are null for the source's `table`, whose
 * cells arrive formatted.
 */
export const tableFromValue = (v: RenderValue): { columns: string[]; rows: Cell[][]; unit: string | null; units: (string | null)[] | null } => {
  if (v.table) return { columns: v.table.columns, rows: v.table.rows, unit: null, units: null };
  const series = v.series ?? [];
  const keys: string[] = [];
  for (const s of series) for (const p of s.values) if (!keys.includes(p.key)) keys.push(p.key);
  return {
    columns: ["", ...keys],
    rows: series.map((s) => [s.label, ...keys.map((k) => s.values.find((p) => p.key === k)?.value ?? null)]),
    unit: sharedUnit(series, v.unit),
    units: series.map((s) => seriesUnit(s, v.unit)),
  };
};

const cell = (c: Cell, unit: string | null = null): string => (c === null || c === undefined ? "–" : typeof c === "number" ? formatNumber(c, "auto", unit) : esc(c));

export interface TableLayout {
  colWidths?: number[];
  merges?: { r: number; c: number; rs: number; cs: number }[];
}

/** Body cells hidden under a merge, and the spans of each merge's top-left cell. */
function mergeMap(rows: Cell[][], cols: number, merges: TableLayout["merges"]): { hidden: Set<string>; span: Map<string, { rs: number; cs: number }> } {
  const hidden = new Set<string>();
  const span = new Map<string, { rs: number; cs: number }>();
  for (const m of merges ?? []) {
    const rs = Math.max(1, Math.min(m.rs, rows.length - m.r));
    const cs = Math.max(1, Math.min(m.cs, cols - m.c));
    if (m.r < 0 || m.c < 0 || m.r >= rows.length || m.c >= cols || (rs === 1 && cs === 1)) continue;
    if (hidden.has(`${m.r}:${m.c}`) || span.has(`${m.r}:${m.c}`)) continue;
    span.set(`${m.r}:${m.c}`, { rs, cs });
    for (let r = m.r; r < m.r + rs; r++) for (let c = m.c; c < m.c + cs; c++) if (r !== m.r || c !== m.c) hidden.add(`${r}:${c}`);
  }
  return { hidden, span };
}

/** `unit`: the unit of the number cells, one for every row or one per row (a bound table's `units`), or null. */
export function tableHtml(columns: string[], rows: Cell[][], style: string, totalRow: boolean, layout: TableLayout = {}, unit: string | null | (string | null)[] = null): string {
  const unitOf = (ri: number): string | null => (Array.isArray(unit) ? (unit[ri] ?? null) : unit);
  const numeric = columns.map((_, i) => i > 0 && rows.length > 0 && rows.every((r) => typeof r[i] === "number" || r[i] === null || r[i] === undefined));
  const widths = (layout.colWidths ?? []).slice(0, columns.length);
  const fixed = widths.length > 0 && widths.every((w) => Number.isFinite(w) && w > 0);
  const colgroup = fixed ? `<colgroup>${columns.map((_, i) => (widths[i] ? `<col style="width:${n3(widths[i])}%">` : "<col>")).join("")}</colgroup>` : "";
  const head = columns.length ? `<thead><tr>${columns.map((c, i) => `<th${numeric[i] ? ' class="num"' : ""}>${esc(c)}</th>`).join("")}</tr></thead>` : "";
  const { hidden, span } = mergeMap(rows, columns.length || Math.max(0, ...rows.map((r) => r.length)), layout.merges);
  const body = rows
    .map(
      (r, ri) =>
        `<tr${totalRow && ri === rows.length - 1 ? ' class="ds-total"' : ""}>${r
          .map((c, i) => {
            if (hidden.has(`${ri}:${i}`)) return "";
            const sp = span.get(`${ri}:${i}`);
            const cls = [i && (typeof c === "number" || c === null) ? "num" : "", sp ? "ds-merged" : ""].filter(Boolean).join(" ");
            const attrs = `${cls ? ` class="${cls}"` : ""}${sp && sp.rs > 1 ? ` rowspan="${sp.rs}"` : ""}${sp && sp.cs > 1 ? ` colspan="${sp.cs}"` : ""}`;
            return `<td${attrs}>${cell(c, unitOf(ri))}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  return `<table class="ds-table ds-table--${esc(style)}${fixed ? " ds-table--fixed" : ""}">${colgroup}${head}<tbody>${body}</tbody></table>`;
}

/** A bound table's columns picked by header (`pick`); the first column always stays. Unknown names are ignored. */
export function pickColumns(t: { columns: string[]; rows: Cell[][] }, pick: string[] | undefined): { columns: string[]; rows: Cell[][] } {
  if (!pick?.length) return t;
  const idx = t.columns.map((c, i) => ({ c, i })).filter(({ c, i }) => i === 0 || pick.includes(c)).map(({ i }) => i);
  if (idx.length <= 1 && t.columns.length > 1) return t;
  return { columns: idx.map((i) => t.columns[i]), rows: t.rows.map((r) => idx.map((i) => r[i] ?? null)) };
}

export const tableElement: ElementRenderer<"table"> = (el, ctx) => {
  const p = el.props;
  const b = p.binding;
  const widths = { colWidths: p.colWidths };
  if (!b) return { html: tableHtml(p.columns ?? [], p.rows ?? [], p.style, !!p.totalRow, { ...widths, merges: p.merges }) };
  if (b.source === "custom") return { html: tableHtml(b.columns ?? [], b.rows ?? [], p.style, !!p.totalRow, widths) + UNLINKED_BADGE, attrs: dataMarks(b, null) };
  const v = lookup(ctx.data, b);
  const reason = unavailableReason(v);
  if (reason || !v) return { html: `<div class="ds-table-nr">${notReported(reason ?? "NOT_RESOLVED")}</div>`, attrs: dataMarks(b, v) };
  const src = tableFromValue(v);
  const t = pickColumns(src, p.columns);
  return { html: tableHtml(t.columns, t.rows, p.style, !!p.totalRow, widths, src.units ?? src.unit), attrs: dataMarks(b, v) };
};
