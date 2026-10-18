/**
 * KPI-7 part 3 · the My KPIs spreadsheet template (module spec KPI-7, Build 2;
 * wave D "Remaining modules").
 *
 *   GET  /kpi/my/template?period=YYYY-MM&site=     XLSX, one row per due or sent-back item the
 *                                                  caller OWNS (D17 resolver) for that month, as
 *                                                  /kpi/my lists it; a draft or sent-back value is
 *                                                  filled in. Auto, calculated and done items aren't in it.
 *   POST /kpi/my/template  multipart `file` (+ `commit` = "true" | "false", form field or query)
 *        commit false (default): the plan, nothing stored:
 *          → {dry_run: true, file_name, plan: {rows, counts: {total, ready, error, skipped}}}
 *        commit true: the plan again, then every ready row saved as a draft (PUT /kpi/values rules):
 *          → {dry_run: false, file_name, plan, saved, results: [{row, ok, value_id} | {row, ok: false, code, message}]}
 *
 * Planning works like a bulk upload (`/user/upload/historical`: preview by
 * default, commit re-plans): each row is checked by `checkDraft` (every rule of
 * a draft save, inside a rolled-back transaction) and must be one the caller
 * owns (`KPI_NOT_ASSIGNED` otherwise). Row issues carry the KPI error codes
 * (`{code, message, details}`); a blank value is `skipped`, not an error; a row
 * repeated in the file is `KPI_VALIDATION` (`rule: duplicate_row`). The sheet is
 * data: nothing typed in it is logged.
 */
import * as XLSX from "xlsx";
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import { IMPORT_LIMITS } from "../../imports/limits";
import { NUMERIC_VALUE_TYPES } from "../contracts/enums";
import { KpiError } from "../contracts/errors";
import type { KpiCaller } from "../guard";
import { parse } from "../http";
import { workbook, type Cell } from "../reports/xlsx";
import { ownerIndex } from "../setup/owners";
import { periodOf } from "./period";
import { checkDraft, findKpi, upsertDrafts } from "./service";
import { myKpis } from "./my";
import { kpiSettings } from "../setup/settings";

type Row = Record<string, any>;

export const TEMPLATE_SHEET = "My KPIs";
export const TEMPLATE_HEADER = ["KPI code", "KPI", "Question", "Site ID", "Site", "Period start", "Period", "Due", "Unit", "Units allowed", "Value", "Breakdown", "Comment", "Estimate", "Status"] as const;
const MAX_ROWS = IMPORT_LIMITS.ROWS_PER_REQUEST;

const TemplateQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM").optional(),
  site: z.coerce.number().int().positive().optional(),
});

const breakdownText = (b: Record<string, number> | null | undefined) =>
  b && Object.keys(b).length ? Object.entries(b).map(([k, v]) => `${k}=${v}`).join("; ") : null;

export async function templateWorkbook(caller: KpiCaller, query: unknown): Promise<{ buffer: Buffer; fileName: string; rows: number }> {
  const q = parse(TemplateQuerySchema, query ?? {});
  const my = await myKpis(caller, q);
  const items = (my.items as Row[]).filter((i) => i.source === "manual" && (i.group === "due" || i.group === "sent_back"));
  const rows: Cell[][] = [
    [...TEMPLATE_HEADER],
    ...items.map((i) => {
      const v = i.value as Row | null;
      const value = v ? (v.value_numeric !== null && NUMERIC_VALUE_TYPES.includes(i.value_type) ? v.value_numeric : v.value_text ?? v.value_numeric) : null;
      return [
        i.code,
        i.name,
        i.question,
        i.site_id,
        i.site_name ?? "Company",
        i.period_start,
        i.period_label,
        i.due_date,
        v?.unit ?? i.canonical_unit ?? null,
        (i.allowed_units ?? []).join(", ") || null,
        value,
        breakdownText(v?.breakdown) ?? (i.breakdowns?.values ? i.breakdowns.values.map((p: string) => `${p}=`).join("; ") : null),
        v?.comment ?? null,
        v?.is_estimate ? "yes" : null,
        i.group === "sent_back" ? `Sent back: ${v?.review_comment ?? ""}`.trim() : v ? "Draft" : "Due",
      ] as Cell[];
    }),
  ];
  const help: Cell[][] = [
    ["How to fill this in"],
    ["Type each value in the Value column, in the Unit shown (or another of the units allowed). Leave a row's value empty to skip it."],
    ["Breakdown: part=number pairs separated by semicolons, adding up to the value (e.g. municipal=800; groundwater=400)."],
    ["Estimate: yes when the value is an estimate. Keep the KPI code, Site ID and Period start as they are."],
    ["Upload the file on My KPIs: you'll see what will be saved before anything is. Values are saved as drafts; submit them from My KPIs."],
  ];
  const buffer = workbook([
    { name: TEMPLATE_SHEET, rows, widths: [26, 34, 50, 8, 22, 12, 14, 12, 12, 24, 14, 34, 30, 9, 24] },
    { name: "How to fill in", rows: help, widths: [120] },
  ]);
  return { buffer, fileName: `My-KPIs-${my.period}${q.site ? `-site-${q.site}` : ""}.xlsx`, rows: items.length };
}

// ---------------------------------------------------------------------------
// Upload: plan, then commit
// ---------------------------------------------------------------------------

export interface PlanIssue {
  code: string;
  message: string;
  details?: unknown;
}
export interface PlanRow {
  row: number;
  kpi_code: string | null;
  kpi_name: string | null;
  site_id: number | null;
  site_name: string | null;
  period_start: string | null;
  period_label: string | null;
  value: number | string | null;
  unit: string | null;
  status: "ready" | "error" | "skipped";
  issues: PlanIssue[];
  /** The item a commit sends to the draft save (ready rows). */
  item?: Row;
}

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const numberOf = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = text(v);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
/** A Period start cell: the text the template wrote, or an Excel date serial if someone retyped it. */
const dayOf = (v: unknown): string | null => {
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null;
  }
  const s = text(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s;
};
const breakdownOf = (v: unknown): Record<string, number> | null | "invalid" => {
  const s = text(v);
  if (s === null) return null;
  const out: Record<string, number> = {};
  for (const part of s.split(/[;\n]/).map((p) => p.trim()).filter(Boolean)) {
    const m = /^([^=:]+)[=:]\s*(.*)$/.exec(part);
    if (!m) return "invalid";
    if (m[2].trim() === "") continue; // the template's "part=" placeholders
    const n = numberOf(m[2]);
    if (n === null || Number.isNaN(n)) return "invalid";
    out[m[1].trim()] = n;
  }
  return Object.keys(out).length ? out : null;
};

export function readTemplate(buffer: Buffer): Row[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new KpiError("KPI_VALIDATION", { issues: [{ path: "file", message: "The file couldn't be read as a spreadsheet." }] });
  }
  const name = wb.SheetNames.includes(TEMPLATE_SHEET) ? TEMPLATE_SHEET : wb.SheetNames[0];
  const sheet = name ? wb.Sheets[name] : undefined;
  if (!sheet) throw new KpiError("KPI_VALIDATION", { issues: [{ path: "file", message: "The file has no sheet." }] });
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: true });
  const header = (XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })[0] ?? []).map((h) => String(h ?? "").trim());
  for (const h of ["KPI code", "Site ID", "Period start", "Value"]) {
    if (!header.includes(h)) throw new KpiError("KPI_VALIDATION", { issues: [{ path: "file", message: `The sheet has no "${h}" column. Download the template again.` }] });
  }
  if (rows.length > MAX_ROWS) throw new KpiError("KPI_VALIDATION", { issues: [{ path: "file", message: `At most ${MAX_ROWS} rows per upload.` }] });
  return rows;
}

const issueOf = (err: unknown): PlanIssue => {
  if (err instanceof KpiError) {
    const b = err.toBody();
    return b.details === undefined ? { code: b.code, message: b.message } : { code: b.code, message: b.message, details: b.details };
  }
  throw err;
};

export async function planTemplate(caller: KpiCaller, buffer: Buffer): Promise<{ rows: PlanRow[]; counts: { total: number; ready: number; error: number; skipped: number } }> {
  const raw = readTemplate(buffer);
  const m = AppDataSource.manager;
  const owners = await ownerIndex(m, caller.companyId);
  const settings = await kpiSettings(m, caller.companyId);
  const sites = new Map<number, string>(((await m.query(`SELECT site_id, name FROM site WHERE company_id = $1`, [caller.companyId])) as Row[]).map((s) => [Number(s.site_id), String(s.name)]));
  const seen = new Set<string>();
  const out: PlanRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const rowNo = i + 2; // the header is row 1
    const code = text(r["KPI code"]);
    const siteCell = text(r["Site ID"]);
    const siteId = siteCell === null ? null : Number(siteCell);
    const start = dayOf(r["Period start"]);
    const valueCell = r["Value"];
    const unit = text(r["Unit"]);
    const plan: PlanRow = { row: rowNo, kpi_code: code, kpi_name: null, site_id: siteId !== null && Number.isInteger(siteId) ? siteId : null, site_name: null, period_start: start, period_label: null, value: null, unit, status: "ready", issues: [] };
    out.push(plan);
    if (!code && siteCell === null && !start && text(valueCell) === null) {
      plan.status = "skipped"; // an empty line
      continue;
    }
    try {
      if (!code || !start || (siteId !== null && !Number.isInteger(siteId))) throw new KpiError("KPI_VALIDATION", { rule: "kpi_site_and_period_needed" });
      const kpi = await findKpi(m, caller.companyId, { code });
      plan.kpi_name = kpi.name;
      plan.site_name = siteId === null ? null : sites.get(siteId) ?? null;
      if (siteId !== null && !sites.has(siteId)) throw new KpiError("KPI_NOT_FOUND", { site_id: siteId });
      if (text(valueCell) === null) {
        plan.status = "skipped";
        continue;
      }
      const numeric = NUMERIC_VALUE_TYPES.includes(kpi.value_type);
      const n = numeric ? numberOf(valueCell) : null;
      if (numeric && (n === null || Number.isNaN(n))) throw new KpiError("KPI_VALUE_INVALID", { field: "value_numeric", rule: "a_number" });
      plan.value = numeric ? n : text(valueCell);
      const breakdown = breakdownOf(r["Breakdown"]);
      if (breakdown === "invalid") throw new KpiError("KPI_VALUE_INVALID", { field: "breakdown", rule: "part_equals_number" });
      const estimate = text(r["Estimate"])?.toLowerCase();
      const item: Row = {
        kpi_code: kpi.code,
        site_id: siteId,
        period_start: start,
        ...(numeric ? { value_numeric: n } : { value_text: text(valueCell) }),
        unit: numeric ? unit : null,
        ...(breakdown ? { breakdown } : {}),
        comment: text(r["Comment"]),
        is_estimate: estimate === "yes" || estimate === "y" || estimate === "true",
      };
      const key = `${kpi.id}|${siteId ?? ""}|${start}`;
      if (seen.has(key)) throw new KpiError("KPI_VALIDATION", { rule: "duplicate_row" });
      seen.add(key);
      // Template rows are only what the caller owns (D17), whatever their role.
      if (owners.resolve({ id: Number(kpi.id), topic: String(kpi.topic) }, siteId).owner_user_id !== caller.userId) throw new KpiError("KPI_NOT_ASSIGNED", { kpi: kpi.code, site_id: siteId });
      const v = await checkDraft(caller, item);
      plan.period_label = periodOf(v.period_start as string, v.frequency as never, settings.year_type).label;
      plan.unit = v.unit ?? plan.unit;
      plan.item = item;
    } catch (err) {
      plan.status = "error";
      plan.issues.push(issueOf(err));
    }
  }
  const counts = { total: out.length, ready: 0, error: 0, skipped: 0 };
  for (const r of out) counts[r.status]++;
  return { rows: out, counts };
}

export async function uploadTemplate(caller: KpiCaller, file: { buffer: Buffer; originalname?: string } | undefined, commitRaw: unknown) {
  if (!file?.buffer?.length) throw new KpiError("KPI_VALIDATION", { issues: [{ path: "file", message: "Attach the filled-in template (multipart field `file`)." }] });
  if (commitRaw !== undefined && commitRaw !== "true" && commitRaw !== "false" && commitRaw !== true && commitRaw !== false) {
    throw new KpiError("KPI_VALIDATION", { issues: [{ path: "commit", message: "commit must be true or false." }] });
  }
  const commit = commitRaw === "true" || commitRaw === true;
  const plan = await planTemplate(caller, file.buffer);
  const strip = (rows: PlanRow[]) => rows.map(({ item, ...r }) => r);
  const fileName = (file.originalname ?? "").slice(0, 200) || null;
  if (!commit) return { dry_run: true, file_name: fileName, plan: { rows: strip(plan.rows), counts: plan.counts } };
  const ready = plan.rows.filter((r) => r.status === "ready" && r.item);
  const saved = ready.length ? await upsertDrafts(caller, ready.map((r) => r.item)) : { saved: 0, results: [] };
  return {
    dry_run: false,
    file_name: fileName,
    plan: { rows: strip(plan.rows), counts: plan.counts },
    saved: saved.saved,
    results: saved.results.map((res, i) => (res.ok ? { row: ready[i].row, ok: true, value_id: Number(res.value.id) } : { row: ready[i].row, ok: false, code: res.code, message: res.message })),
  };
}
