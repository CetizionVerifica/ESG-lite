/**
 * KPI-11 · the shared report model for one framework version, one reporting
 * year and a set of sites (pure; the GRI, BRSR and ESRS exports are views of it).
 *
 * Approved values only (D14): the builder drops every draft, pending and
 * rejected value it's given. Figures come from values/yearly.ts (site values
 * rolled up over the report's sites, periods over the year, missing never 0)
 * and are converted from canonical to each mapping's `display_unit`
 * (display.ts).
 *
 * rows        one per disclosure with at least one approved value this year:
 *             {disclosure, items: one per mapped KPI (exact, partial, then derived), each
 *             {value, previous, unit, fit + note, where, sites, evidence_count, value_ids,
 *             status approved | missing | excluded | not_tracked}}; `status` reported (every
 *             item approved and complete, or excluded) or partial
 * omissions   every other disclosure, with why:
 *               not_material  ESRS `if_material` and the topic isn't material (or undecided)
 *               excluded      every mapped KPI was left out in setup, with the reasons
 *               missing       a mapped KPI is selected but has no approved value for the year
 *               not_tracked   no mapped KPI is tracked ("Not tracked in ESGLite")
 */
import type { KpiAggregation, KpiFrequency, YearType } from "../contracts/enums";
import { periodsFor } from "../values/period";
import { figureOf, type FigureDef, type StoredValue } from "../values/yearly";
import { toDisplay } from "./display";

export interface ReportKpi {
  id: number;
  code: string;
  name: string;
  value_type: string;
  canonical_unit: string | null;
  level: string;
  aggregation: KpiAggregation;
  frequency: KpiFrequency;
  source: string;
  selected: boolean;
  reason_excluded: string | null;
}

export interface ReportInput {
  framework: { code: string; version: string; name: string };
  year: number;
  year_type: YearType;
  company: { id: number; name: string };
  sites: Array<{ site_id: number; name: string }>;
  disclosures: Array<{ id: number; code: string; title: string; section: string; requirement: string; esrs_topic: string | null; source_url?: string | null }>;
  /** In display order (kpi_disclosure_map id order). */
  mappings: Array<{ disclosure_id: number; kpi_definition_id: number; fit: string; breakdown_key: string | null; display_unit: string | null; note: string | null }>;
  kpis: ReportKpi[];
  material: Array<{ esrs_topic: string; material: boolean; reason: string | null }>;
  /** Values of the year and the year before, any status (the builder keeps approved ones). */
  values: StoredValue[];
  /** Evidence files per value id. */
  evidence: Record<number, number>;
  pending: { count: number; value_ids: number[] };
}

export type ItemStatus = "approved" | "missing" | "excluded" | "not_tracked";

export interface ReportItem {
  kpi_definition_id: number;
  code: string;
  name: string;
  value_type: string;
  fit: string;
  note: string | null;
  where: "site" | "company";
  value: number | null;
  text: string | null;
  previous: number | null;
  previous_text: string | null;
  unit: string | null;
  canonical_unit: string | null;
  unit_note: string | null;
  breakdown_key: string | null;
  breakdown: Record<string, number> | null;
  complete: boolean;
  missing_periods: string[];
  missing_sites: number[];
  sites: Array<number | null>;
  evidence_count: number;
  value_ids: number[];
  previous_value_ids: number[];
  status: ItemStatus;
  reason: string | null;
}

export interface ReportRow {
  disclosure_id: number;
  /** The disclosure's place in the framework (rows and omissions share it). */
  position: number;
  code: string;
  title: string;
  section: string;
  requirement: string;
  core: boolean;
  esrs_topic: string | null;
  source_url: string | null;
  status: "reported" | "partial";
  items: ReportItem[];
}

export type OmissionKind = "not_material" | "excluded" | "missing" | "not_tracked";

export interface ReportOmission {
  disclosure_id: number;
  position: number;
  code: string;
  title: string;
  section: string;
  requirement: string;
  core: boolean;
  esrs_topic: string | null;
  reason_kind: OmissionKind;
  reason: string;
}

export interface ReportModel {
  framework: string;
  version: string;
  framework_name: string;
  year: number;
  year_type: YearType;
  label: string;
  previous_label: string;
  company: { id: number; name: string };
  sites: Array<{ site_id: number; name: string }>;
  rows: ReportRow[];
  omissions: ReportOmission[];
  pending: { count: number; value_ids: number[] };
  totals: { disclosures: number; reported: number; partial: number; omitted: number };
}

export const NOT_TRACKED_TEXT = "Not tracked in ESGLite";
const FIT_ORDER: Record<string, number> = { exact: 0, partial: 1, derived: 2 };

export function buildReportModel(input: ReportInput): ReportModel {
  const approved = input.values.filter((v) => v.status === "approved");
  const kpiById = new Map(input.kpis.map((k) => [k.id, k]));
  const byCode = new Map<string, FigureDef>(input.kpis.map((k) => [k.code, k]));
  const siteIds = input.sites.map((s) => s.site_id);
  const material = new Map(input.material.map((m) => [m.esrs_topic, m]));
  const label = periodsFor("annual", input.year_type, input.year)[0].label;
  const previous_label = periodsFor("annual", input.year_type, input.year - 1)[0].label;
  const evidence = (ids: number[]) => ids.reduce((n, id) => n + (input.evidence[id] ?? 0), 0);

  const rows: ReportRow[] = [];
  const omissions: ReportOmission[] = [];
  for (const [position, d] of input.disclosures.entries()) {
    const base = { disclosure_id: d.id, position, code: d.code, title: d.title, section: d.section, requirement: d.requirement, core: d.requirement === "core", esrs_topic: d.esrs_topic };
    if (d.requirement === "if_material" && d.esrs_topic) {
      const m = material.get(d.esrs_topic);
      if (!m?.material) {
        omissions.push({ ...base, reason_kind: "not_material", reason: m ? m.reason || "Not material." : "Materiality not assessed." });
        continue;
      }
    }
    const maps = input.mappings
      .map((mp, i) => ({ mp, i }))
      .filter(({ mp }) => mp.disclosure_id === d.id)
      .sort((a, b) => (FIT_ORDER[a.mp.fit] ?? 9) - (FIT_ORDER[b.mp.fit] ?? 9) || a.i - b.i)
      .map(({ mp }) => mp);
    const items: ReportItem[] = [];
    for (const mp of maps) {
      const k = kpiById.get(mp.kpi_definition_id);
      if (!k) continue;
      const empty = { value: null, text: null, previous: null, previous_text: null, breakdown: null, complete: false, missing_periods: [], missing_sites: [], sites: [], evidence_count: 0, value_ids: [], previous_value_ids: [] };
      const head = { kpi_definition_id: k.id, code: k.code, name: k.name, value_type: k.value_type, fit: mp.fit, note: mp.note ?? null, where: (k.level === "company" ? "company" : "site") as "site" | "company", breakdown_key: mp.breakdown_key ?? null, canonical_unit: k.canonical_unit };
      const shown = toDisplay(null, k.canonical_unit, mp.display_unit);
      if (!k.selected) {
        items.push({ ...head, ...empty, unit: shown.unit, unit_note: shown.unit_note, status: k.reason_excluded ? "excluded" : "not_tracked", reason: k.reason_excluded ?? NOT_TRACKED_TEXT });
        continue;
      }
      const opts = (year: number) => ({ year, yearType: input.year_type, sites: siteIds });
      const now = figureOf(k, approved, byCode, opts(input.year));
      const prev = figureOf(k, approved, byCode, opts(input.year - 1));
      const cur = toDisplay(now.value, k.canonical_unit, mp.display_unit);
      const before = toDisplay(prev.value, k.canonical_unit, mp.display_unit);
      let breakdown: Record<string, number> | null = null;
      if (mp.breakdown_key && now.breakdown) {
        breakdown = Object.fromEntries(Object.entries(now.breakdown).map(([part, v]) => [part, toDisplay(v, k.canonical_unit, mp.display_unit).value as number]));
      }
      const has = now.value !== null || now.text !== null;
      items.push({
        ...head,
        value: cur.value,
        text: now.text,
        previous: before.value,
        previous_text: prev.text,
        unit: cur.unit,
        unit_note: cur.unit_note,
        breakdown,
        complete: has && now.complete,
        missing_periods: now.missing_periods,
        missing_sites: now.missing_sites,
        sites: now.sites,
        evidence_count: evidence(now.value_ids),
        value_ids: now.value_ids,
        previous_value_ids: prev.value_ids,
        status: has ? "approved" : "missing",
        reason: has ? null : `No approved value for ${label}.`,
      });
    }
    if (items.some((i) => i.status === "approved")) {
      const done = items.every((i) => i.status === "excluded" || (i.status === "approved" && i.complete));
      rows.push({ ...base, source_url: d.source_url ?? null, status: done ? "reported" : "partial", items });
      continue;
    }
    if (items.some((i) => i.status === "missing")) omissions.push({ ...base, reason_kind: "missing", reason: `No approved value for ${label}.` });
    else if (items.length && items.every((i) => i.status === "excluded")) omissions.push({ ...base, reason_kind: "excluded", reason: [...new Set(items.map((i) => i.reason as string))].join("; ") });
    else omissions.push({ ...base, reason_kind: "not_tracked", reason: NOT_TRACKED_TEXT });
  }
  return {
    framework: input.framework.code,
    version: input.framework.version,
    framework_name: input.framework.name,
    year: input.year,
    year_type: input.year_type,
    label,
    previous_label,
    company: input.company,
    sites: input.sites,
    rows,
    omissions,
    pending: input.pending,
    totals: { disclosures: input.disclosures.length, reported: rows.filter((r) => r.status === "reported").length, partial: rows.filter((r) => r.status === "partial").length, omitted: omissions.length },
  };
}
