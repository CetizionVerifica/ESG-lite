/**
 * KPI-11 · ESRS datapoints (XLSX) from the shared model: one list by topic
 * (ESRS 2, then E1…G1) with the datapoint code, our title, value, unit, its
 * `if_material` status and a note; topics the company assessed as not
 * material (or hasn't assessed) on their own sheet with the reason. Ends with
 * the "Audit trail" sheet.
 */
import { itemNotes, valueCell } from "./gri";
import type { AuditEntry } from "./load";
import type { ReportModel, ReportOmission } from "./model";
import { NOT_TRACKED_TEXT } from "./model";
import { auditSheet, type Cell, type Sheet } from "./xlsx";

export const ESRS_DATAPOINTS_SHEET = "Datapoints";
export const ESRS_NOT_MATERIAL_SHEET = "Not material";
export const ESRS_HEADER = ["Topic", "Datapoint", "Our title", "Parameter", "Value", "Unit", "Previous year", "Status", "Note"];

const topicOf = (t: string | null) => t ?? "ESRS 2";
const statusOf = (requirement: string) => (requirement === "if_material" ? "Material" : requirement === "required" ? "Required" : requirement === "voluntary" ? "Voluntary" : requirement);

export function esrsSheets(model: ReportModel, audit: AuditEntry[]): Sheet[] {
  const lines: Cell[][] = [];
  const notMaterial: ReportOmission[] = [];
  const all = [...model.rows.map((r) => ({ position: r.position, r, o: null })), ...model.omissions.map((o) => ({ position: o.position, r: null, o }))].sort((a, b) => a.position - b.position);
  for (const e of all) {
    if (e.o) {
      if (e.o.reason_kind === "not_material") {
        notMaterial.push(e.o);
        continue;
      }
      lines.push([topicOf(e.o.esrs_topic), e.o.code, e.o.title, null, e.o.reason_kind === "not_tracked" ? NOT_TRACKED_TEXT : e.o.reason, null, null, statusOf(e.o.requirement), e.o.reason_kind === "not_tracked" ? null : e.o.reason]);
      continue;
    }
    const r = e.r!;
    for (const i of r.items) lines.push([topicOf(r.esrs_topic), r.code, r.title, i.name, valueCell(i), i.unit, i.status === "approved" ? i.previous : null, statusOf(r.requirement), itemNotes(i, model)]);
  }
  const topics = new Map<string, { reason: string; codes: string[] }>();
  for (const o of notMaterial) {
    const t = topicOf(o.esrs_topic);
    const entry = topics.get(t) ?? { reason: o.reason, codes: [] };
    entry.codes.push(o.code);
    topics.set(t, entry);
  }
  return [
    {
      name: ESRS_DATAPOINTS_SHEET,
      rows: [[`ESRS datapoints · ${model.company.name} · ${model.label}`], [`${model.framework_name} (${model.version}). Approved values only.`], [], ESRS_HEADER, ...lines],
      widths: [8, 10, 46, 32, 16, 18, 14, 10, 60],
    },
    {
      name: ESRS_NOT_MATERIAL_SHEET,
      rows: [["Topic", "Reason", "Datapoints not reported"], ...[...topics.entries()].map(([t, v]) => [t, v.reason, v.codes.join(", ")])],
      widths: [8, 60, 40],
    },
    auditSheet(audit),
  ];
}
