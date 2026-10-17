/**
 * KPI-11 · reads what a framework report needs (the ReportInput of model.ts)
 * and the audit trail behind its numbers.
 *
 *   loadReport(caller, framework, query)
 *     - Manager, Admin, Superadmin (a User → 403 KPI_FORBIDDEN); setup finished (409);
 *     - the framework version the company enabled for that code (none, or an unknown code → 404);
 *     - `sites` (comma-separated ids) narrows to some of the caller's sites (another → 404);
 *       default: every site the caller has; company-level values are always in;
 *     - values of the year and the year before on those sites (the model keeps approved ones);
 *     - `audit_trail`: every value behind a figure (both years): who approved it and when, and
 *       its evidence file names. Auto and calculated values name their source instead.
 */
import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import { FrameworkCodeSchema, type FrameworkCode } from "../contracts/enums";
import { KpiError } from "../contracts/errors";
import { KpiReportQuerySchema } from "../contracts/schemas";
import type { KpiCaller } from "../guard";
import { parse } from "../http";
import { enabledFrameworks, kpiSettings } from "../setup/settings";
import { figureDefs } from "../targets/service";
import { isoDay, periodOf, yearRange } from "../values/period";
import { assertSetupDone } from "../values/service";
import { loadValues } from "../values/yearly";
import { buildReportModel, type ReportInput, type ReportModel } from "./model";

type Row = Record<string, any>;

export const REPORT_ROLES = new Set<string>([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN]);

export interface AuditEntry {
  value_id: number;
  kpi_code: string;
  kpi_name: string;
  site_id: number | null;
  site_name: string | null;
  period_start: string;
  period_label: string;
  value: number | string | null;
  unit: string | null;
  value_canonical: number | null;
  canonical_unit: string | null;
  source: string;
  approved_by: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  evidence: string[];
}

export async function loadReport(caller: KpiCaller, frameworkParam: string, query: unknown): Promise<{ model: ReportModel; audit_trail: AuditEntry[]; format: "json" | "xlsx" | "pdf" }> {
  if (!REPORT_ROLES.has(caller.role)) throw new KpiError("KPI_FORBIDDEN", { allowed: ["Manager", "Admin", "Superadmin"] });
  const q = parse(KpiReportQuerySchema, query ?? {});
  const code = String(frameworkParam ?? "").toUpperCase();
  if (!FrameworkCodeSchema.safeParse(code).success) throw new KpiError("KPI_NOT_FOUND", { framework: frameworkParam });
  const m = AppDataSource.manager;
  await assertSetupDone(m, caller.companyId);
  const fw = (await enabledFrameworks(m, caller.companyId)).find((f) => f.code === (code as FrameworkCode));
  if (!fw) throw new KpiError("KPI_NOT_FOUND", { framework: code, rule: "not_enabled" });

  const allSites: Row[] = await m.query(`SELECT site_id, name FROM site WHERE company_id = $1 ORDER BY site_id`, [caller.companyId]);
  let sites = allSites.filter((s) => !caller.sites || caller.sites.has(Number(s.site_id))).map((s) => ({ site_id: Number(s.site_id), name: String(s.name) }));
  if (q.sites) {
    const wanted = [...new Set(q.sites.split(",").map(Number))];
    const missing = wanted.filter((id) => !sites.some((s) => s.site_id === id));
    if (missing.length) throw new KpiError("KPI_NOT_FOUND", { sites: missing });
    sites = sites.filter((s) => wanted.includes(s.site_id));
  }
  const siteIds = sites.map((s) => s.site_id);

  const settings = await kpiSettings(m, caller.companyId);
  const yearType = settings.year_type;
  const [company]: Row[] = await m.query(`SELECT company_id, name FROM company WHERE company_id = $1`, [caller.companyId]);
  const [framework]: Row[] = await m.query(`SELECT code, version, name FROM kpi_framework WHERE id = $1`, [fw.framework_id]);
  const disclosures: Row[] = await m.query(`SELECT id, code, title, section, requirement, esrs_topic, source_url FROM kpi_disclosure WHERE framework_id = $1 ORDER BY sort_key, code`, [fw.framework_id]);
  const mappings: Row[] = await m.query(
    `SELECT mp.disclosure_id, mp.kpi_definition_id, mp.fit, mp.breakdown_key, mp.display_unit, mp.note
       FROM kpi_disclosure_map mp JOIN kpi_disclosure ds ON ds.id = mp.disclosure_id
       JOIN kpi_definition d ON d.id = mp.kpi_definition_id AND (d.company_id IS NULL OR d.company_id = $2)
      WHERE ds.framework_id = $1 ORDER BY mp.id`,
    [fw.framework_id, caller.companyId],
  );
  const { byId } = await figureDefs(m, caller.companyId);
  const material: Row[] = await m.query(`SELECT esrs_topic, material, reason FROM company_material_topic WHERE company_id = $1`, [caller.companyId]);
  const values = (await loadValues(m, caller.companyId, { from: yearRange(yearType, q.year - 1).start, to: yearRange(yearType, q.year).end, statuses: ["approved", "pending"] })).filter(
    (v) => v.site_id === null || siteIds.includes(v.site_id),
  );
  const approvedIds = values.filter((v) => v.status === "approved").map((v) => v.id);
  const evidenceRows: Row[] = approvedIds.length
    ? await m.query(`SELECT kpi_value_id, document_name FROM kpi_value_evidence WHERE kpi_value_id = ANY($1::int[]) ORDER BY id`, [approvedIds])
    : [];
  const evidence: Record<number, number> = {};
  const evidenceNames = new Map<number, string[]>();
  for (const e of evidenceRows) {
    const id = Number(e.kpi_value_id);
    evidence[id] = (evidence[id] ?? 0) + 1;
    evidenceNames.set(id, [...(evidenceNames.get(id) ?? []), String(e.document_name)]);
  }
  const range = yearRange(yearType, q.year);
  const pending = values.filter((v) => v.status === "pending" && v.period_start >= range.start && v.period_end! <= range.end);

  const input: ReportInput = {
    framework: { code: framework.code, version: framework.version, name: framework.name },
    year: q.year,
    year_type: yearType,
    company: { id: Number(company.company_id), name: String(company.name) },
    sites,
    disclosures: disclosures.map((d) => ({ id: Number(d.id), code: d.code, title: d.title, section: d.section, requirement: d.requirement, esrs_topic: d.esrs_topic ?? null, source_url: d.source_url ?? null })),
    mappings: mappings.map((x) => ({ disclosure_id: Number(x.disclosure_id), kpi_definition_id: Number(x.kpi_definition_id), fit: x.fit, breakdown_key: x.breakdown_key ?? null, display_unit: x.display_unit ?? null, note: x.note ?? null })),
    kpis: [...byId.values()]
      .filter((d) => mappings.some((x) => Number(x.kpi_definition_id) === d.id))
      .map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        value_type: String(d.value_type),
        canonical_unit: d.canonical_unit ?? null,
        level: d.level,
        aggregation: d.aggregation,
        frequency: d.frequency,
        source: d.source,
        selected: d.selected === true && d.active === true,
        reason_excluded: d.reason_excluded ?? null,
      })),
    material: material.map((r) => ({ esrs_topic: r.esrs_topic, material: r.material === true, reason: r.reason ?? null })),
    values,
    evidence,
    pending: { count: pending.length, value_ids: pending.slice(0, 200).map((v) => v.id) },
  };
  const model = buildReportModel(input);

  // The audit trail: every value behind a figure, both years.
  const used = [...new Set(model.rows.flatMap((r) => r.items.flatMap((i) => [...i.value_ids, ...i.previous_value_ids])))];
  const auditRows: Row[] = used.length
    ? await m.query(
        `SELECT v.id, v.site_id, v.period_start, v.frequency, v.year_type, v.value_numeric, v.value_text, v.unit, v.value_canonical, v.source, v.reviewed_by, v.reviewed_at,
                d.code, d.name AS kpi_name, d.canonical_unit, s.name AS site_name,
                TRIM(CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.last_name, ''))) AS reviewer
           FROM kpi_value v JOIN kpi_definition d ON d.id = v.kpi_definition_id
           LEFT JOIN site s ON s.site_id = v.site_id LEFT JOIN "user" u ON u.user_id = v.reviewed_by
          WHERE v.company_id = $1 AND v.id = ANY($2::int[])
          ORDER BY d.code, v.period_start, v.site_id NULLS FIRST, v.id`,
        [caller.companyId, used],
      )
    : [];
  const audit_trail: AuditEntry[] = auditRows.map((r) => {
    const start = isoDay(r.period_start) as string;
    const source = String(r.source);
    return {
      value_id: Number(r.id),
      kpi_code: r.code,
      kpi_name: r.kpi_name,
      site_id: r.site_id === null ? null : Number(r.site_id),
      site_name: r.site_name ?? null,
      period_start: start,
      period_label: periodOf(start, r.frequency, r.year_type).label,
      value: r.value_numeric === null ? (r.value_text ?? null) : Number(r.value_numeric),
      unit: r.unit ?? null,
      value_canonical: r.value_canonical === null ? null : Number(r.value_canonical),
      canonical_unit: r.canonical_unit ?? null,
      source,
      approved_by: r.reviewed_by === null ? null : Number(r.reviewed_by),
      approved_by_name: source === "auto" ? "From approved emission data" : source === "formula" ? "Calculated from approved inputs" : r.reviewer || null,
      approved_at: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
      evidence: evidenceNames.get(Number(r.id)) ?? [],
    };
  });
  return { model, audit_trail, format: q.format ?? "json" };
}
