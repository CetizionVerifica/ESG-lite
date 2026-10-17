/**
 * KPI-4 · the value store service (layer rules 2, 6, 7, 8).
 *
 *   listValues(caller, query)   GET /kpi/values: scoped to the caller's sites (company-level
 *                               values to every role of the company); drafts only to their
 *                               author, Admins and the Superadmin
 *   upsertDrafts(caller, items) PUT /kpi/values: per item, in its own transaction:
 *                               setup finished → KPI found (404 otherwise) → selected → not auto
 *                               or formula → level and site → scope and assignment → frequency and
 *                               year type are the company's → period start
 *                               → not locked → value, unit and breakdown → insert or update a
 *                               draft (a rejected value edited becomes a draft; pending and
 *                               approved values aren't editable) → audit
 *   submit(caller, ids)         POST /kpi/values/submit: draft → pending, then the KPI-6
 *                               dependants of the submitted KPIs recompute
 *
 * Every write holds the company's KPI lock key shared (`KPI_LOCK_CLASS`), so
 * KPI-8's period lock (which takes it exclusively) sees every write in flight.
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { FY_START_MONTH } from "../../reporting/ghg-data";
import { UserRole } from "../../types/type";
import type { KpiFrequency, YearType } from "../contracts/enums";
import { NUMERIC_VALUE_TYPES } from "../contracts/enums";
import { BREAKDOWN_TOLERANCE } from "../contracts/checks";
import { KpiError } from "../contracts/errors";
import { KpiValueItemSchema, KpiValuesQuerySchema, type KpiValueItem } from "../contracts/schemas";
import type { KpiCaller } from "../guard";
import { parse } from "../http";
import { recomputeForValues } from "../formulas/recompute";
import { assignmentFor, companyKpiRow, kpiSettings, setupCompleted, topicGrants } from "../setup/settings";
import { isPeriodStart, monthRange, overlaps, periodOf, yearRange, isoDay } from "./period";
import { toCanonical } from "./units";

type Row = Record<string, any>;

/** pg advisory lock class for KPI period locks (KPI-8 takes it exclusively per company). */
export const KPI_LOCK_CLASS = 4150;

const REVIEWERS = new Set<string>([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN]);
const SEES_ALL_DRAFTS = new Set<string>([UserRole.ADMIN, UserRole.SUPERADMIN]);

export const holdKpiLease = (m: EntityManager, companyId: number) => m.query(`SELECT pg_advisory_xact_lock_shared($1, $2)`, [KPI_LOCK_CLASS, companyId]);

// ---------------------------------------------------------------------------
// Lookups and rules (each a hook a later module replaces)
// ---------------------------------------------------------------------------

/** A KPI the company may use: the library or its own. Another company's KPI is 404. */
export async function findKpi(m: EntityManager, companyId: number, ref: { id?: number; code?: string }): Promise<Row> {
  const rows: Row[] = ref.id
    ? await m.query(`SELECT * FROM kpi_definition WHERE id = $1 AND (company_id IS NULL OR company_id = $2)`, [ref.id, companyId])
    : await m.query(`SELECT * FROM kpi_definition WHERE code = $1 AND (company_id IS NULL OR company_id = $2) ORDER BY company_id NULLS LAST LIMIT 1`, [ref.code, companyId]);
  if (!rows.length) throw new KpiError("KPI_NOT_FOUND", { kpi: ref.id ?? ref.code });
  return rows[0];
}

/** KPI_SETUP_INCOMPLETE until the company finished KPI-3 setup (01-contracts §4). */
export async function assertSetupDone(m: EntityManager, companyId: number): Promise<void> {
  if (!(await setupCompleted(m, companyId))) throw new KpiError("KPI_SETUP_INCOMPLETE");
}

/** Whether the company selected this KPI in setup (company_kpi.selected) and it is still active. */
export async function isKpiSelected(m: EntityManager, companyId: number, kpi: Row): Promise<boolean> {
  if (kpi.active !== true) return false;
  return (await companyKpiRow(m, companyId, Number(kpi.id)))?.selected === true;
}

/** The company's year type for KPIs (company_kpi_settings.year_type). */
export async function companyKpiYearType(m: EntityManager, companyId: number): Promise<YearType> {
  return (await kpiSettings(m, companyId)).year_type;
}

/** The KPI's frequency for this company: the company_kpi override, else the KPI's default. */
export async function companyKpiFrequency(m: EntityManager, companyId: number, kpi: Row): Promise<KpiFrequency> {
  return ((await companyKpiRow(m, companyId, Number(kpi.id)))?.frequency ?? kpi.default_frequency) as KpiFrequency;
}

/**
 * Whether the caller may enter this KPI on this site (null = company level).
 * Layer rule 2, D4 and KPI-3 assignments:
 *   - Superadmin and Admin: anything of the company;
 *   - the assigned owner (kpi_assignment.owner_user_id) of the KPI × site, whatever their role;
 *   - Managers: their sites and company-level values;
 *   - Users: with no assignment for the KPI × site, site-level KPIs on their own sites in their
 *     KPI topics (kpi_topic_grant; none = every topic). A pair assigned to someone else isn't theirs.
 * Throws KPI_NOT_FOUND for another company's site, KPI_NOT_ASSIGNED otherwise.
 */
export async function assertCanWrite(m: EntityManager, caller: KpiCaller, kpi: Row, siteId: number | null): Promise<void> {
  if (siteId !== null) {
    const rows: Row[] = await m.query(`SELECT 1 FROM site WHERE site_id = $1 AND company_id = $2`, [siteId, caller.companyId]);
    if (!rows.length) throw new KpiError("KPI_NOT_FOUND", { site_id: siteId });
  }
  if (caller.role === UserRole.SUPERADMIN || caller.role === UserRole.ADMIN) return;
  const refuse = () => new KpiError("KPI_NOT_ASSIGNED", { kpi: kpi.code, site_id: siteId });
  const assignment = await assignmentFor(m, caller.companyId, Number(kpi.id), siteId);
  if (assignment && Number(assignment.owner_user_id) === caller.userId) return;
  if (caller.role === UserRole.MANAGER) {
    if (siteId === null || !caller.sites || caller.sites.has(siteId)) return;
    throw refuse();
  }
  if (siteId === null || assignment) throw refuse();
  if (caller.sites && !caller.sites.has(siteId)) throw refuse();
  const grants = await topicGrants(m, caller.userId);
  if (grants.size && !grants.has(kpi.topic)) throw refuse();
}

/** The calendar year of month `month` (1–12) inside reporting year `year`. */
export const lockMonthYear = (yearType: string, year: number, month: number) => (yearType === "FY" && month >= FY_START_MONTH ? year - 1 : year);

/** Whether a value's period is in an active KPI lock for its site (or every site). */
export async function lockedPeriod(m: EntityManager, companyId: number, siteId: number | null, period: { start: string; end: string }): Promise<boolean> {
  const locks: Row[] = await m.query(
    `SELECT year, period, year_type FROM kpi_period_lock
      WHERE company_id = $1 AND reopened_at IS NULL AND (site_id IS NULL OR site_id IS NOT DISTINCT FROM $2)`,
    [companyId, siteId],
  );
  return locks.some((l) => {
    const range = l.period ? monthRange(lockMonthYear(l.year_type, l.year, l.period), l.period) : yearRange(l.year_type as YearType, l.year);
    return overlaps(range, period);
  });
}

/** A KPI that maps to a BRSR Core disclosure of the BRSR version the company reports on needs evidence to be submitted (D15). */
export async function needsEvidence(m: EntityManager, companyId: number, kpiId: number): Promise<boolean> {
  const rows: Row[] = await m.query(
    `SELECT 1 FROM kpi_disclosure_map mp
       JOIN kpi_disclosure ds ON ds.id = mp.disclosure_id AND ds.requirement = 'core'
       JOIN kpi_framework f ON f.id = ds.framework_id AND f.code = 'BRSR'
       JOIN company_framework cf ON cf.framework_id = f.id AND cf.company_id = $2
      WHERE mp.kpi_definition_id = $1 LIMIT 1`,
    [kpiId, companyId],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Value checks
// ---------------------------------------------------------------------------

const NON_NEGATIVE_DIMENSIONS = new Set(["energy", "mass", "volume", "count", "time", "currency"]);

interface CheckedValue {
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  value_canonical: number | null;
  breakdown: Record<string, number> | null;
}

const invalid = (field: string, rule: string) => new KpiError("KPI_VALUE_INVALID", { field, rule });

/** Type, range, unit and breakdown checks (KPI_VALUE_INVALID, KPI_UNIT_NOT_ALLOWED). Details name the rule, never the value. */
export function checkValue(kpi: Row, item: KpiValueItem): CheckedValue {
  const type = kpi.value_type as string;
  if (NUMERIC_VALUE_TYPES.includes(type as never)) {
    const v = item.value_numeric;
    if (typeof v !== "number") throw invalid("value_numeric", "required");
    if (type === "integer" && !Number.isInteger(v)) throw invalid("value_numeric", "whole_number");
    if (type === "percent" && (v < 0 || v > 100)) throw invalid("value_numeric", "percent_0_100");
    if ((type === "integer" || NON_NEGATIVE_DIMENSIONS.has(kpi.unit_dimension)) && v < 0) throw invalid("value_numeric", "not_negative");
    const canonical = toCanonical(v, item.unit, { unit_dimension: kpi.unit_dimension, canonical_unit: kpi.canonical_unit, allowed_units: kpi.allowed_units ?? [] });
    let breakdown: Record<string, number> | null = null;
    if (item.breakdown && Object.keys(item.breakdown).length) {
      const allowed: string[] = kpi.breakdowns?.values ?? [];
      for (const [k, part] of Object.entries(item.breakdown)) {
        if (!allowed.includes(k)) throw invalid(`breakdown.${k}`, "unknown_part");
        if (part < 0) throw invalid(`breakdown.${k}`, "not_negative");
      }
      const sum = Object.values(item.breakdown).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - v) > BREAKDOWN_TOLERANCE * Math.abs(v) + 1e-9) throw invalid("breakdown", "parts_must_add_up");
      breakdown = item.breakdown;
    }
    return { value_numeric: v, value_text: null, unit: canonical.unit || null, value_canonical: canonical.value_canonical, breakdown };
  }
  if (item.breakdown && Object.keys(item.breakdown).length) throw invalid("breakdown", "numbers_only");
  if (item.unit) throw new KpiError("KPI_UNIT_NOT_ALLOWED", { unit: item.unit, allowed: [] });
  if (type === "yes_no") {
    const t = (item.value_text ?? "").trim().toLowerCase();
    const yes = t === "yes" || item.value_numeric === 1;
    const no = t === "no" || item.value_numeric === 0;
    if (yes === no) throw invalid("value_text", "yes_or_no");
    return { value_numeric: yes ? 1 : 0, value_text: yes ? "yes" : "no", unit: null, value_canonical: yes ? 1 : 0, breakdown: null };
  }
  const text = (item.value_text ?? "").trim();
  if (!text) throw invalid("value_text", "required");
  const choices: string[] | undefined = kpi.breakdowns?.choices;
  if (type === "choice" && choices && !choices.includes(text)) throw invalid("value_text", "one_of_the_choices");
  return { value_numeric: null, value_text: text, unit: null, value_canonical: null, breakdown: null };
}

// ---------------------------------------------------------------------------
// Rows out
// ---------------------------------------------------------------------------

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const day = (v: unknown) => isoDay(v);

/** A kpi_value row as the API returns it (numbers as numbers, dates as YYYY-MM-DD). */
export const toValueOut = (r: Row, evidence: Row[] = []) => ({
  id: r.id,
  company_id: r.company_id,
  site_id: r.site_id,
  kpi_definition_id: r.kpi_definition_id,
  kpi_code: r.kpi_code,
  period_start: day(r.period_start),
  period_end: day(r.period_end),
  frequency: r.frequency,
  year_type: r.year_type,
  value_numeric: num(r.value_numeric),
  value_text: r.value_text,
  unit: r.unit,
  value_canonical: num(r.value_canonical),
  canonical_unit: r.canonical_unit ?? null,
  breakdown: r.breakdown,
  source: r.source,
  status: r.status,
  is_estimate: r.is_estimate,
  comment: r.comment,
  entered_by: r.entered_by,
  submitted_at: r.submitted_at,
  reviewed_by: r.reviewed_by,
  reviewed_at: r.reviewed_at,
  review_comment: r.review_comment,
  checks: r.checks,
  auto_snapshot: r.auto_snapshot,
  created_at: r.created_at,
  updated_at: r.updated_at,
  evidence: evidence.map((e) => ({ id: e.id, document_url: e.document_url, document_name: e.document_name, uploaded_by: e.uploaded_by, uploaded_at: e.uploaded_at })),
});

const VALUE_SELECT = `SELECT v.*, d.code AS kpi_code, d.canonical_unit FROM kpi_value v JOIN kpi_definition d ON d.id = v.kpi_definition_id`;

/** Whether the caller can see a value: their sites (company level to all), and drafts only their own unless Admin/Superadmin. */
export const canSee = (caller: KpiCaller, r: Row): boolean => {
  if (Number(r.company_id) !== caller.companyId) return false;
  if (r.site_id !== null && caller.sites && !caller.sites.has(Number(r.site_id))) return false;
  if (r.status === "draft" && !SEES_ALL_DRAFTS.has(caller.role) && Number(r.entered_by) !== caller.userId) return false;
  return true;
};

export async function evidenceFor(m: EntityManager, valueIds: number[]): Promise<Map<number, Row[]>> {
  const out = new Map<number, Row[]>();
  if (!valueIds.length) return out;
  const rows: Row[] = await m.query(`SELECT * FROM kpi_value_evidence WHERE kpi_value_id = ANY($1::int[]) ORDER BY id`, [valueIds]);
  for (const r of rows) out.set(Number(r.kpi_value_id), [...(out.get(Number(r.kpi_value_id)) ?? []), r]);
  return out;
}

export async function listValues(caller: KpiCaller, query: unknown) {
  const q = parse(KpiValuesQuerySchema, query ?? {});
  const m = AppDataSource.manager;
  const where = ["v.company_id = $1"];
  const params: unknown[] = [caller.companyId];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (q.kpi !== undefined) {
    const kpi = await findKpi(m, caller.companyId, typeof q.kpi === "number" ? { id: q.kpi } : { code: q.kpi });
    add("v.kpi_definition_id = ?", kpi.id);
  }
  if (q.site === "company") where.push("v.site_id IS NULL");
  else if (q.site !== undefined) add("v.site_id = ?", q.site);
  if (q.from) add("v.period_end >= ?", q.from);
  if (q.to) add("v.period_start <= ?", q.to);
  if (q.status) add("v.status = ?", q.status);
  if (q.frequency) add("v.frequency = ?", q.frequency);
  if (caller.sites) add("(v.site_id IS NULL OR v.site_id = ANY(?::int[]))", [...caller.sites]);
  if (!SEES_ALL_DRAFTS.has(caller.role)) add("(v.status <> 'draft' OR v.entered_by = ?)", caller.userId);
  const rows: Row[] = await m.query(`${VALUE_SELECT} WHERE ${where.join(" AND ")} ORDER BY v.period_start, d.code, v.site_id NULLS FIRST, v.id`, params);
  const ev = await evidenceFor(m, rows.map((r) => Number(r.id)));
  return { values: rows.map((r) => toValueOut(r, ev.get(Number(r.id)))) };
}

/** A value the caller can see, locked FOR UPDATE inside `m`; KPI_NOT_FOUND otherwise. */
export async function loadVisibleValue(m: EntityManager, caller: KpiCaller, id: number): Promise<Row> {
  const rows: Row[] = await m.query(`${VALUE_SELECT} WHERE v.id = $1 AND v.company_id = $2 FOR UPDATE OF v`, [id, caller.companyId]);
  if (!rows.length || !canSee(caller, rows[0])) throw new KpiError("KPI_NOT_FOUND");
  return rows[0];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export const auditValue = (m: EntityManager, valueId: number, action: string, changed: Record<string, { old: unknown; new: unknown }>, userId: number, reason: string | null = null) =>
  m.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('kpi_value', $1, $2, $3, $4, $5)`, [
    valueId,
    action,
    JSON.stringify(changed),
    reason,
    userId || null,
  ]);

const AUDITED = ["value_numeric", "value_text", "unit", "value_canonical", "breakdown", "is_estimate", "comment", "status"] as const;
const comparable = (v: unknown) => (v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v));

export type ItemResult =
  | { index: number; ok: true; value: ReturnType<typeof toValueOut> }
  | { index: number; ok: false; code: string; message: string; details?: unknown };

async function upsertOne(caller: KpiCaller, raw: unknown): Promise<ReturnType<typeof toValueOut>> {
  const item = parse(KpiValueItemSchema, raw);
  return AppDataSource.transaction(async (m) => {
    await holdKpiLease(m, caller.companyId);
    await assertSetupDone(m, caller.companyId);
    const kpi = await findKpi(m, caller.companyId, { id: item.kpi_definition_id, code: item.kpi_code });
    if (item.kpi_definition_id && item.kpi_code && kpi.code !== item.kpi_code) throw new KpiError("KPI_VALIDATION", { issues: [{ path: "kpi_code", message: "kpi_code and kpi_definition_id name different KPIs" }] });
    if (!(await isKpiSelected(m, caller.companyId, kpi))) throw new KpiError("KPI_NOT_SELECTED", { kpi: kpi.code });
    if (kpi.source !== "manual") throw new KpiError("KPI_AUTO_READ_ONLY", { kpi: kpi.code, source: kpi.source });
    if ((kpi.level === "company") !== (item.site_id === null)) throw invalid("site_id", kpi.level === "company" ? "company_level_kpi" : "site_level_kpi");
    await assertCanWrite(m, caller, kpi, item.site_id);

    // The company's frequency and year type (KPI-3); an item may repeat them, never change them.
    const frequency = await companyKpiFrequency(m, caller.companyId, kpi);
    const yearType = await companyKpiYearType(m, caller.companyId);
    if (item.frequency && item.frequency !== frequency) throw invalid("frequency", `company_frequency_${frequency}`);
    if (item.year_type && item.year_type !== yearType) throw invalid("year_type", `company_year_type_${yearType}`);
    if (!isPeriodStart(item.period_start, frequency, yearType)) throw invalid("period_start", `start_of_a_${frequency}_period`);
    const period = periodOf(item.period_start, frequency, yearType);
    if (await lockedPeriod(m, caller.companyId, item.site_id, period)) throw new KpiError("KPI_PERIOD_LOCKED", { period: period.label });

    const checked = checkValue(kpi, item);
    const next = { ...checked, is_estimate: item.is_estimate ?? false, comment: item.comment ?? null };

    const existing: Row[] = await m.query(
      `SELECT * FROM kpi_value WHERE company_id = $1 AND site_id IS NOT DISTINCT FROM $2 AND kpi_definition_id = $3 AND period_start = $4 AND frequency = $5 FOR UPDATE`,
      [caller.companyId, item.site_id, kpi.id, item.period_start, frequency],
    );
    let id: number;
    if (!existing.length) {
      const rows: Row[] = await m.query(
        `INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, value_text, unit, value_canonical, breakdown, source, status, is_estimate, comment, entered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'manual', 'draft', $13, $14, $15) RETURNING id`,
        [caller.companyId, item.site_id, kpi.id, period.start, period.end, frequency, yearType, next.value_numeric, next.value_text, next.unit, next.value_canonical, next.breakdown ? JSON.stringify(next.breakdown) : null, next.is_estimate, next.comment, caller.userId || null],
      );
      id = Number(rows[0].id);
      await auditValue(m, id, "create", Object.fromEntries(AUDITED.map((k) => [k, { old: null, new: k === "status" ? "draft" : (next as Row)[k] ?? null }])), caller.userId);
    } else {
      const old = existing[0];
      // Someone else's draft doesn't exist for this caller (layer rule 7), and a pending or approved value isn't editable.
      if (!canSee(caller, old)) throw new KpiError("KPI_NOT_DRAFT", { id: old.id, status: "draft" });
      if (old.status === "pending" || old.status === "approved") throw new KpiError("KPI_NOT_DRAFT", { id: old.id, status: old.status });
      id = Number(old.id);
      await m.query(
        `UPDATE kpi_value SET value_numeric = $2, value_text = $3, unit = $4, value_canonical = $5, breakdown = $6, is_estimate = $7, comment = $8, status = 'draft', entered_by = $9, year_type = $10, updated_at = now() WHERE id = $1`,
        [id, next.value_numeric, next.value_text, next.unit, next.value_canonical, next.breakdown ? JSON.stringify(next.breakdown) : null, next.is_estimate, next.comment, caller.userId || null, yearType],
      );
      const after: Row = { ...next, status: "draft" };
      const changed = Object.fromEntries(
        AUDITED.filter((k) => comparable(k.startsWith("value_") ? num(old[k]) : old[k]) !== comparable(after[k])).map((k) => [k, { old: k.startsWith("value_") ? num(old[k]) : old[k] ?? null, new: after[k] ?? null }]),
      );
      if (Object.keys(changed).length) await auditValue(m, id, old.status === "rejected" ? "reopen" : "update", changed, caller.userId);
    }
    const rows: Row[] = await m.query(`${VALUE_SELECT} WHERE v.id = $1`, [id]);
    const ev = await evidenceFor(m, [id]);
    return toValueOut(rows[0], ev.get(id));
  });
}

/** PUT /kpi/values `{items}` → `{saved, results}`; one item's failure never stops the others. */
export async function upsertDrafts(caller: KpiCaller, items: unknown[]): Promise<{ saved: number; results: ItemResult[] }> {
  const results: ItemResult[] = [];
  for (let index = 0; index < items.length; index++) {
    try {
      results.push({ index, ok: true, value: await upsertOne(caller, items[index]) });
    } catch (err) {
      if (!(err instanceof KpiError)) throw err;
      const body = err.toBody();
      results.push({ index, ok: false, ...body });
    }
  }
  return { saved: results.filter((r) => r.ok).length, results };
}

/** POST /kpi/values/submit `{ids}` → `{submitted: ids, refused: [{id, code}]}`. */
export async function submit(caller: KpiCaller, ids: number[]): Promise<{ submitted: number[]; refused: Array<{ id: number; code: string }> }> {
  const submitted: number[] = [];
  const refused: Array<{ id: number; code: string }> = [];
  for (const id of [...new Set(ids)]) {
    try {
      await AppDataSource.transaction(async (m) => {
        await holdKpiLease(m, caller.companyId);
        await assertSetupDone(m, caller.companyId);
        const v = await loadVisibleValue(m, caller, id);
        const kpi = await findKpi(m, caller.companyId, { id: Number(v.kpi_definition_id) });
        await assertCanWrite(m, caller, kpi, v.site_id === null ? null : Number(v.site_id));
        if (v.status !== "draft") throw new KpiError("KPI_NOT_DRAFT");
        if (await lockedPeriod(m, caller.companyId, v.site_id === null ? null : Number(v.site_id), { start: day(v.period_start)!, end: day(v.period_end)! })) throw new KpiError("KPI_PERIOD_LOCKED");
        if (await needsEvidence(m, caller.companyId, kpi.id)) {
          const ev: Row[] = await m.query(`SELECT 1 FROM kpi_value_evidence WHERE kpi_value_id = $1 LIMIT 1`, [id]);
          if (!ev.length) throw new KpiError("KPI_EVIDENCE_REQUIRED");
        }
        await m.query(`UPDATE kpi_value SET status = 'pending', submitted_at = now(), updated_at = now() WHERE id = $1`, [id]);
        await auditValue(m, id, "submit", { status: { old: "draft", new: "pending" } }, caller.userId);
      });
      submitted.push(id);
    } catch (err) {
      if (!(err instanceof KpiError)) throw err;
      refused.push({ id, code: err.code });
    }
  }
  // KPI-6: submitted values are formula inputs now; their dependants recompute (never fails the submit).
  if (submitted.length) await recomputeForValues(caller.companyId, submitted);
  return { submitted, refused: refused.sort((a, b) => a.id - b.id) };
}

export const isReviewer = (role: string) => REVIEWERS.has(role);
