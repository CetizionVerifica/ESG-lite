/**
 * KPI-11 · GRI content index (XLSX and PDF) from the shared model.
 *
 * One line per KPI answering a disclosure, and one per omitted disclosure,
 * in the framework's order, grouped by section (GRI 2, then the topic
 * standards): disclosure, our title, the value (or "see page" for a narrative
 * answer), unit, where it was measured, last year, notes (fit note, unit and
 * completeness notes), evidence files, and the omission with its reason.
 */
import type { ReportItem, ReportModel } from "./model";
import { auditSheet, type Cell, type Sheet } from "./xlsx";
import type { AuditEntry } from "./load";

export const GRI_INDEX_SHEET = "GRI content index";
export const GRI_HEADER = ["Disclosure", "Title", "KPI", "Value", "Unit", "Where", "Previous year", "Notes", "Evidence files", "Omission", "Reason"];

const NARRATIVE = new Set(["text", "choice", "yes_no"]);

/** The notes column of an item: fit note, unit note, gaps. */
export const itemNotes = (i: ReportItem, model: ReportModel): string | null => {
  const notes: string[] = [];
  if (i.fit !== "exact" && i.note) notes.push(i.note);
  if (i.unit_note) notes.push(i.unit_note);
  if (i.status === "approved" && !i.complete) {
    const parts: string[] = [];
    if (i.missing_sites.length) parts.push(`no approved value for ${i.missing_sites.map((s) => model.sites.find((x) => x.site_id === s)?.name ?? `site ${s}`).join(", ")}`);
    if (i.missing_periods.length) parts.push(`${i.missing_periods.length} period(s) without an approved value`);
    notes.push(`Incomplete: ${parts.join("; ") || "not every value is approved"}.`);
  }
  if (i.breakdown) notes.push(`By ${i.breakdown_key}: ${Object.entries(i.breakdown).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  return notes.length ? notes.join(" ") : null;
};

export const whereOf = (i: ReportItem, model: ReportModel): string | null =>
  i.where === "company" ? "Company" : i.sites.length ? i.sites.map((s) => model.sites.find((x) => x.site_id === s)?.name ?? `site ${s}`).join(", ") : null;

export const valueCell = (i: ReportItem): Cell => {
  if (i.status === "excluded") return "Excluded";
  if (i.status === "not_tracked") return "Not tracked in ESGLite";
  if (i.status === "missing") return "No approved value";
  if (NARRATIVE.has(i.value_type) || (i.value === null && i.text !== null)) return "see page";
  return i.value;
};

/** Rows and omissions together, in the framework's order. */
export const inOrder = (model: ReportModel) =>
  [...model.rows.map((r) => ({ kind: "row" as const, r, position: r.position, section: r.section })), ...model.omissions.map((o) => ({ kind: "omission" as const, o, position: o.position, section: o.section }))].sort(
    (a, b) => a.position - b.position,
  );

/** The index lines, with a heading line per section, in disclosure order. */
export function griLines(model: ReportModel): Cell[][] {
  const lines: Cell[][] = [];
  let section = "";
  for (const e of inOrder(model)) {
    if (e.section !== section) {
      section = e.section;
      lines.push([section]);
    }
    if (e.kind === "omission") {
      lines.push([e.o.code, e.o.title, null, null, null, null, null, null, null, "Yes", e.o.reason]);
      continue;
    }
    for (const i of e.r.items) {
      const omitted = i.status !== "approved";
      lines.push([e.r.code, e.r.title, i.name, valueCell(i), i.unit, whereOf(i, model), i.status === "approved" ? i.previous : null, itemNotes(i, model), i.evidence_count || null, omitted ? "Part" : null, omitted ? i.reason : null]);
    }
  }
  return lines;
}

export function griSheets(model: ReportModel, audit: AuditEntry[]): Sheet[] {
  return [
    {
      name: GRI_INDEX_SHEET,
      rows: [
        [`GRI content index · ${model.company.name} · ${model.label}`],
        [`${model.framework_name} (${model.version}). Approved values only; previous year ${model.previous_label}. ${model.pending.count} value(s) pending review aren't included.`],
        [],
        GRI_HEADER,
        ...griLines(model),
      ],
      widths: [12, 46, 32, 14, 16, 22, 14, 60, 10, 10, 40],
    },
    auditSheet(audit),
  ];
}
