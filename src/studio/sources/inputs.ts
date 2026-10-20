/**
 * DS-2 · report inputs (01-contracts §2.1): the disclosures the data can't
 * know, stored per doc in `report_doc.inputs` as `{value, source, updatedBy,
 * updatedAt}` per key.
 *
 *   prefillInputs(ctx)        what the company's data already says, per key, with its source:
 *     consolidation_approach      company.consolidation_approach                  (company)
 *     reporting_period            the doc's year and CY/FY                          (company)
 *     base_year, recalculation_policy, significance_threshold_pct
 *                                 the frozen Scope 3 base year (company_base_year)  (company)
 *     gwp_set                     the GWP sets on the approved rows' factors; MIXED for more than one (company)
 *     exclusions                  Scope 3 categories excluded or not relevant on the boundary, with reasons (company)
 *     conformance                 ['GHGP']                                          (company)
 *     revenue, employees          the year's approved KPI value (REVENUE, EMPLOYEES_TOTAL) with KPI tracking on (kpi)
 *     output_units                approved production of the doc's sites in the year (company)
 *   effectiveInputs(stored, prefill)   stored entries win; prefill fills the rest
 *   applyInputPatch(...)       validates each key (kind and value schema), null removes it
 *   inputDisplay(key, value)   the text an InputBinding shows
 *   exclusionFor(inputs, n)    the exclusions[] entry naming Scope 3 category n ("Category 8 …")
 */
import { AppDataSource } from "../../config/data-source";
import { CONSOLIDATION_LABELS } from "../../reporting/ghg-scope3";
import { getPeriodRange } from "../../reporting/ghg-data";
import { ghgCategory } from "../../scope3/contracts/ghgCategory";
import {
  DsError,
  INPUT_SOURCES,
  REPORT_INPUT_KEYS,
  REPORT_INPUT_KINDS,
  REPORT_INPUT_VALUE_SCHEMAS,
  type InputSource,
  type ReportInputKey,
  type ReportInputs,
  type ReportKind,
  type YearType,
} from "../contracts";
import type { GhgLoader } from "./ghg";
import { kpiYearValue, type KpiLoader } from "./kpi";

type Row = Record<string, any>;

export type Prefill = Partial<Record<ReportInputKey, { value: unknown; source: InputSource; note?: string }>>;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayText = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

/** "Calendar year 2025 (1 January 2025 – 31 December 2025)". */
export function periodText(yearType: YearType, year: number): string {
  const r = getPeriodRange(yearType, year, "yearly");
  return `${yearType === "FY" ? "Financial year" : "Calendar year"} ${year} (${dayText(r.startDate)} – ${dayText(r.endDate)})`;
}

/** "Category 8 · Upstream leased assets": the `what` of a prefilled exclusion. */
export const categoryWhat = (n: number) => `Category ${n} · ${ghgCategory(n)?.name ?? ""}`.trim();

/** The exclusions[] entry for Scope 3 category n (its `what` starts "Category n" or names the category). */
export function exclusionFor(inputs: ReportInputs, n: number): { what: string; reason: string } | null {
  const list = inputs.exclusions?.value ?? [];
  const name = ghgCategory(n)?.name?.toLowerCase();
  return (
    list.find((e) => {
      const m = /^\s*(?:category|cat\.?)\s*(\d{1,2})\b/i.exec(e.what);
      if (m) return Number(m[1]) === n;
      return !!name && e.what.trim().toLowerCase() === name;
    }) ?? null
  );
}

export interface PrefillContext {
  companyId: number;
  kind: ReportKind;
  year: number;
  yearType: YearType;
  siteIds: number[];
  kpiEnabled: boolean;
}

export async function prefillInputs(ctx: PrefillContext, ghg: GhgLoader, kpi: KpiLoader): Promise<Prefill> {
  const out: Prefill = {};
  const company = "company" as const;
  out.reporting_period = { value: periodText(ctx.yearType, ctx.year), source: company };
  if (ctx.kind !== "ghg") return out;

  const [c]: Row[] = await AppDataSource.query(`SELECT consolidation_approach FROM company WHERE company_id = $1`, [ctx.companyId]);
  if (c?.consolidation_approach) out.consolidation_approach = { value: CONSOLIDATION_LABELS[c.consolidation_approach] ?? String(c.consolidation_approach), source: company };

  const by = await ghg.baseYear();
  if (by) {
    out.base_year = { value: by.base_year, source: company };
    if (by.policy_note) out.recalculation_policy = { value: by.policy_note, source: company };
    out.significance_threshold_pct = { value: by.significance_pct, source: company };
  }

  if (ctx.siteIds.length) {
    const cov = await ghg.coverage(ctx.year, ctx.siteIds);
    if (cov.gwp_sets.length === 1) out.gwp_set = { value: cov.gwp_sets[0], source: company };
    else if (cov.gwp_sets.length > 1) out.gwp_set = { value: "MIXED", source: company, note: cov.gwp_sets.join(", ") };
  }

  const boundary: Row[] = await AppDataSource.query(
    `SELECT ghg_category, status, reason FROM company_scope3_category WHERE company_id = $1 AND status IN ('excluded', 'not_relevant') ORDER BY ghg_category`,
    [ctx.companyId],
  ).catch(() => []);
  if (boundary.length) out.exclusions = { value: boundary.map((b) => ({ what: categoryWhat(Number(b.ghg_category)), reason: String(b.reason ?? "") })), source: company };

  out.conformance = { value: ["GHGP"], source: company };

  if (ctx.kpiEnabled) {
    const revenue = await kpiYearValue(kpi, "REVENUE", ctx.year, ctx.siteIds).catch(() => null);
    if (revenue) out.revenue = { value: revenue.value, source: "kpi", ...(revenue.unit ? { note: revenue.unit } : {}) };
    const employees = await kpiYearValue(kpi, "EMPLOYEES_TOTAL", ctx.year, ctx.siteIds).catch(() => null);
    if (employees) out.employees = { value: employees.value, source: "kpi" };
  }
  if (ctx.siteIds.length) {
    const prod = await ghg.production(ctx.year, ctx.siteIds);
    if (prod.length) {
      const units = [...new Set(prod.map((p) => String(p.unit || "unit")))];
      const total = prod.reduce((a, p) => a + (Number(p.production) || 0), 0);
      if (units.length === 1 && total > 0) out.output_units = { value: Number(total.toPrecision(12)), source: company, note: units[0] };
    }
  }
  return out;
}

/** Stored entries win; prefill fills keys the doc hasn't stored (as entries with no editor). */
export function effectiveInputs(stored: ReportInputs, prefill: Prefill): ReportInputs {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(prefill)) if (p) out[k] = { value: p.value, source: p.source, updatedBy: null, updatedAt: "prefill" };
  for (const [k, e] of Object.entries(stored ?? {})) if (e) out[k] = e;
  return out as ReportInputs;
}

/**
 * Applies `{key: {value, source?} | null}` to stored inputs. Each key must be a
 * §2.1 key of the doc's kind and its value must pass that key's schema
 * (DS_VALIDATION with `details.issues[].path = "inputs.<key>"`). `source`
 * defaults to 'typed'; null removes the key.
 */
export function applyInputPatch(stored: ReportInputs, patch: unknown, kind: ReportKind, userId: number | null, now = new Date()): ReportInputs {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new DsError("DS_VALIDATION", { issues: [{ path: "inputs", message: "inputs must be an object" }] });
  const issues: Array<{ path: string; message: string }> = [];
  const next: Record<string, unknown> = { ...(stored ?? {}) };
  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    const path = `inputs.${key}`;
    if (!(REPORT_INPUT_KEYS as readonly string[]).includes(key)) {
      issues.push({ path, message: "Unknown report input" });
      continue;
    }
    const k = key as ReportInputKey;
    if (!REPORT_INPUT_KINDS[k].includes(kind)) {
      issues.push({ path, message: `Not a ${kind} report input` });
      continue;
    }
    if (raw === null) {
      delete next[k];
      continue;
    }
    const entry = raw && typeof raw === "object" && !Array.isArray(raw) && "value" in (raw as object) ? (raw as { value: unknown; source?: unknown }) : null;
    if (!entry) {
      issues.push({ path, message: "Send {value, source?} or null" });
      continue;
    }
    const parsed = REPORT_INPUT_VALUE_SCHEMAS[k].safeParse(entry.value);
    if (!parsed.success) {
      for (const i of parsed.error.issues) issues.push({ path: [path, ...i.path.map(String)].join("."), message: i.message });
      continue;
    }
    const source: InputSource = (INPUT_SOURCES as readonly unknown[]).includes(entry.source) ? (entry.source as InputSource) : "typed";
    next[k] = { value: parsed.data, source, updatedBy: userId, updatedAt: now.toISOString() };
  }
  if (issues.length) throw new DsError("DS_VALIDATION", { issues });
  return next as ReportInputs;
}

const VERIFICATION_TEXT = { none: "Not verified", limited: "Limited assurance", reasonable: "Reasonable assurance" } as const;
const CONFORMANCE_TEXT = { GHGP: "GHG Protocol Corporate Standard", ISO14064: "ISO 14064-1" } as const;

/** The text an InputBinding shows; "" for an empty input. */
export function inputDisplay(key: ReportInputKey, value: unknown): string {
  if (value === null || value === undefined) return "";
  switch (key) {
    case "exclusions":
      return (value as Array<{ what: string; reason: string }>).map((e) => `${e.what}: ${e.reason || "no reason given"}`).join("\n");
    case "verification": {
      const v = value as { status: keyof typeof VERIFICATION_TEXT; provider?: string };
      return v.provider && v.status !== "none" ? `${VERIFICATION_TEXT[v.status]} by ${v.provider}` : VERIFICATION_TEXT[v.status];
    }
    case "conformance":
      return (value as Array<keyof typeof CONFORMANCE_TEXT>).map((c) => CONFORMANCE_TEXT[c] ?? c).join(" and ");
    case "significance_threshold_pct":
      return `${value}%`;
    case "revenue":
    case "revenue_ppp_rate":
    case "output_units":
    case "employees":
      return (value as number).toLocaleString("en-US", { maximumFractionDigits: 2 });
    default:
      return String(value);
  }
}

// ---------------------------------------------------------------------------
// Storage: report_doc.inputs (the table is DS-5's; DS-2 reads and writes only
// `inputs` and bumps `rev`, the doc's optimistic lock).
// ---------------------------------------------------------------------------

export interface DocInputsRow {
  id: number;
  kind: ReportKind;
  rev: number;
  year: number;
  yearType: YearType;
  sites: "all" | number[];
  inputs: ReportInputs;
}

let docTable: boolean | null = null;
/** Whether `report_doc` exists yet (it ships with DS-5); without it no doc can be found. */
async function hasDocTable(): Promise<boolean> {
  if (docTable) return true;
  const [r]: Row[] = await AppDataSource.query(`SELECT to_regclass('report_doc') IS NOT NULL AS ok`);
  docTable = r?.ok === true;
  return docTable;
}

const sitesOf = (draft: Row | null): "all" | number[] => {
  const s = draft?.meta?.sites;
  return Array.isArray(s) ? s.map(Number).filter((n) => Number.isInteger(n) && n > 0) : "all";
};

/** A doc of the company (not deleted), else DS_DOC_NOT_FOUND (another company's id included). */
export async function loadDocInputs(companyId: number, docId: number): Promise<DocInputsRow> {
  if (!(await hasDocTable())) throw new DsError("DS_DOC_NOT_FOUND");
  const [r]: Row[] = await AppDataSource.query(
    `SELECT id, kind, rev, year, year_type, inputs, draft FROM report_doc WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [docId, companyId],
  );
  if (!r) throw new DsError("DS_DOC_NOT_FOUND");
  return {
    id: Number(r.id),
    kind: (r.kind ?? r.draft?.kind ?? "sustainability") as ReportKind,
    rev: Number(r.rev),
    year: Number(r.year ?? r.draft?.meta?.year),
    yearType: (r.year_type ?? r.draft?.meta?.yearType) === "FY" ? "FY" : "CY",
    sites: sitesOf(r.draft),
    inputs: (r.inputs ?? {}) as ReportInputs,
  };
}

/** Writes inputs when `rev` is current; DS_VERSION_CONFLICT otherwise. Returns the new rev. */
export async function saveDocInputs(companyId: number, docId: number, rev: number, inputs: ReportInputs, userId: number): Promise<number> {
  const rows: Row[] = await AppDataSource.query(
    `UPDATE report_doc SET inputs = $1::jsonb, rev = rev + 1, updated_by = $2, updated_at = now()
      WHERE id = $3 AND company_id = $4 AND rev = $5 AND deleted_at IS NULL RETURNING rev`,
    [JSON.stringify(inputs), userId || null, docId, companyId, rev],
  );
  const updated = Array.isArray(rows[0]) ? rows[0] : rows;
  if (!updated.length) {
    const cur = await loadDocInputs(companyId, docId);
    throw new DsError("DS_VERSION_CONFLICT", { rev: cur.rev });
  }
  return Number(updated[0].rev);
}
