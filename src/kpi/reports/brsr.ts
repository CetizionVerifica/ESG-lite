/**
 * KPI-11 · BRSR tables (XLSX) from the shared model, laid out like SEBI's
 * format tables: one sheet per part covered (Section A, Principle 3, 5, 6 …,
 * from each disclosure's section), with the current and previous financial
 * year side by side, a BRSR Core marker and an assurance-evidence column (the
 * number of evidence files behind the figure). Indicators the client doesn't
 * track are listed as "Not tracked in ESGLite"; other omissions say why.
 * Ends with the "Audit trail" sheet.
 */
import { itemNotes, valueCell } from "./gri";
import type { AuditEntry } from "./load";
import type { ReportModel } from "./model";
import { NOT_TRACKED_TEXT } from "./model";
import { auditSheet, type Cell, type Sheet } from "./xlsx";

/** "Principle 6 · Essential" → "Principle 6"; "Section A · Employees" → "Section A". */
export const brsrPart = (section: string) => section.split("·")[0].trim();

export const brsrHeader = (model: ReportModel) => ["Indicator", "Disclosure", "Parameter", "Unit", `${model.label} (current year)`, `${model.previous_label} (previous year)`, "BRSR Core", "Assurance evidence (files)", "Notes"];

export function brsrSheets(model: ReportModel, audit: AuditEntry[]): Sheet[] {
  const parts = new Map<string, Cell[][]>();
  const add = (section: string, line: Cell[]) => {
    const p = brsrPart(section);
    if (!parts.has(p)) parts.set(p, []);
    parts.get(p)!.push(line);
  };
  const all = [...model.rows.map((r) => ({ position: r.position, r, o: null })), ...model.omissions.map((o) => ({ position: o.position, r: null, o }))].sort((a, b) => a.position - b.position);
  for (const e of all) {
    if (e.o) {
      add(e.o.section, [e.o.code, e.o.title, null, null, e.o.reason_kind === "not_tracked" ? NOT_TRACKED_TEXT : e.o.reason, null, e.o.core ? "Core" : null, null, e.o.reason_kind === "not_tracked" ? null : e.o.reason_kind.replace("_", " ")]);
      continue;
    }
    const r = e.r!;
    for (const i of r.items) {
      add(r.section, [r.code, r.title, i.name, i.unit, valueCell(i), i.status === "approved" ? i.previous : null, r.core ? "Core" : null, i.status === "approved" ? i.evidence_count : null, itemNotes(i, model)]);
    }
  }
  const sheets: Sheet[] = [...parts.entries()].map(([part, lines]) => ({
    name: part,
    rows: [[`BRSR · ${part} · ${model.company.name} · ${model.label}`], [`${model.framework_name} (${model.version}). Approved values only.`], [], brsrHeader(model), ...lines],
    widths: [10, 48, 32, 16, 18, 18, 10, 14, 60],
  }));
  return [...sheets, auditSheet(audit)];
}
