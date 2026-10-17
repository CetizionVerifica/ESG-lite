/**
 * KPI-11 · XLSX output for the framework reports, with the repo's `xlsx`
 * package (as the emission export). A sheet is an array of rows (cells are
 * strings, numbers or empty); `auditSheet` is the "Audit trail" every export ends with.
 */
import * as XLSX from "xlsx";
import type { AuditEntry } from "./load";

export type Cell = string | number | null;
export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Column widths in characters. */
  widths?: number[];
}

export const AUDIT_HEADER = ["Value id", "KPI code", "KPI", "Site", "Period", "Value", "Unit", "Value (canonical)", "Canonical unit", "Source", "Approved by", "Approved on", "Evidence files"];

export function auditSheet(audit: AuditEntry[]): Sheet {
  return {
    name: "Audit trail",
    rows: [
      AUDIT_HEADER,
      ...audit.map((a) => [a.value_id, a.kpi_code, a.kpi_name, a.site_name ?? "Company", a.period_label, a.value, a.unit, a.value_canonical, a.canonical_unit, a.source, a.approved_by_name, a.approved_at ? a.approved_at.slice(0, 10) : null, a.evidence.join("; ") || null]),
    ],
    widths: [10, 26, 34, 22, 14, 14, 12, 16, 16, 10, 30, 12, 40],
  };
}

/** Sheet names: at most 31 characters, none of []:*?/\ (Excel's rules). */
export const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, " ").slice(0, 31);

export function workbook(sheets: Sheet[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows); // null cells stay empty
    if (s.widths) ws["!cols"] = s.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, sheetName(s.name));
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** A file name part: letters, digits and dashes. */
export const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
