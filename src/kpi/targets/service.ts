/**
 * KPI-9 · targets per KPI (01-contracts §2 `kpi_target`, §3 `GET/PUT/DELETE /kpi/targets`).
 *
 *   GET    /kpi/targets?kpi=&site=     any role → {targets}: company targets, and site targets of
 *                                      the caller's sites, each with `progress` and `series`
 *   PUT    /kpi/targets {id?, …}       Admin, Superadmin → {target}: creates, or updates `id`
 *   DELETE /kpi/targets/:id            Admin, Superadmin → {removed: id}
 *
 * Values are in the KPI's canonical unit. Rules (422 KPI_VALUE_INVALID with
 * `details {field, rule}` unless named):
 *   - the KPI is the company's (404 otherwise), selected (KPI_NOT_SELECTED) and numeric;
 *   - a company-level KPI takes company targets only; a site is one of the company's (404);
 *   - target_year after baseline_year; the direction matches the sign (reduce: lower target,
 *     increase: higher, maintain: the same value);
 *   - the baseline: when the baseline year has an approved figure the value must equal it, unless
 *     a note says why; with no approved figure a typed baseline needs a note;
 *   - one target per KPI, site and target year.
 * Progress reads approved annual figures only (values/yearly.ts, progress.ts).
 * Every write is audited (`kpi_target`: create / update / delete).
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import { NUMERIC_VALUE_TYPES, pillarOfTopic, type KpiFrequency, type YearType } from "../contracts/enums";
import { KpiError } from "../contracts/errors";
import { KpiTargetSchema, KpiTargetsQuerySchema } from "../contracts/schemas";
import type { KpiCaller } from "../guard";
import { parse } from "../http";
import { kpiSettings } from "../setup/settings";
import { yearRange } from "../values/period";
import { findKpi, isKpiSelected } from "../values/service";
import { figureOf, loadValues, type FigureDef, type StoredValue } from "../values/yearly";
import { progress, type TargetLike } from "./progress";

type Row = Record<string, any>;

const WRITERS = new Set<string>([UserRole.ADMIN, UserRole.SUPERADMIN]);
const invalid = (field: string, rule: string, extra: Record<string, unknown> = {}) => new KpiError("KPI_VALUE_INVALID", { field, rule, ...extra });
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** The company's KPI definitions with their company frequency, by id and code (for figures and weights). */
export async function figureDefs(m: EntityManager, companyId: number): Promise<{ byId: Map<number, Row & FigureDef>; byCode: Map<string, FigureDef> }> {
  const rows: Row[] = await m.query(
    `SELECT d.*, COALESCE(ck.frequency, d.default_frequency) AS frequency, COALESCE(ck.selected, false) AS selected, ck.reason_excluded
       FROM kpi_definition d LEFT JOIN company_kpi ck ON ck.kpi_definition_id = d.id AND ck.company_id = $1
      WHERE d.company_id IS NULL OR d.company_id = $1`,
    [companyId],
  );
  const byId = new Map<number, Row & FigureDef>();
  const byCode = new Map<string, FigureDef>();
  for (const r of rows) {
    const def = { ...r, id: Number(r.id), frequency: r.frequency as KpiFrequency } as Row & FigureDef;
    byId.set(def.id, def);
    if (!byCode.has(r.code) || r.company_id !== null) byCode.set(r.code, def);
  }
  return { byId, byCode };
}

export const companySiteIds = async (m: EntityManager, companyId: number): Promise<number[]> =>
  (await m.query(`SELECT site_id FROM site WHERE company_id = $1 ORDER BY site_id`, [companyId])).map((r: Row) => Number(r.site_id));

/** Approved annual figures of one KPI for the company (site null) or one site, year by year. */
export function annualPoints(def: Row & FigureDef, values: StoredValue[], byCode: Map<string, FigureDef>, yearType: YearType, sites: number[], site: number | null, from: number, to: number) {
  const out: Array<{ year: number; value: number | null; complete: boolean }> = [];
  for (let year = from; year <= to; year++) {
    const f = figureOf(def as FigureDef & { code: string }, values, byCode, { year, yearType, sites, ...(def.level === "site" && site !== null ? { site } : {}) });
    out.push({ year, value: f.value, complete: f.complete });
  }
  return out;
}

/** "−20 % by 2030 from 2024", "+15 % by 2028 from 2025", "Keep at 0 by 2030" (a value change when the baseline is 0). */
export const targetLabel = (t: TargetLike, unit: string | null): string => {
  if (t.direction === "maintain") return `Keep at ${t.baseline_value}${unit ? ` ${unit}` : ""} to ${t.target_year}`;
  if (t.baseline_value === 0) return `${t.target_value}${unit ? ` ${unit}` : ""} by ${t.target_year}`;
  const pct = Math.round(((t.target_value - t.baseline_value) / Math.abs(t.baseline_value)) * 1000) / 10;
  return `${pct < 0 ? "−" : "+"}${Math.abs(pct)} % by ${t.target_year} from ${t.baseline_year}`;
};

const targetOut = (t: Row, def: Row | undefined, siteName: string | null, points: Array<{ year: number; value: number | null; complete: boolean }>) => {
  const like: TargetLike = { baseline_year: Number(t.baseline_year), baseline_value: Number(t.baseline_value), target_year: Number(t.target_year), target_value: Number(t.target_value), direction: t.direction };
  const p = progress(like, points);
  return {
    id: Number(t.id),
    company_id: Number(t.company_id),
    kpi_definition_id: Number(t.kpi_definition_id),
    kpi_code: def?.code ?? null,
    kpi_name: def?.name ?? null,
    topic: def?.topic ?? null,
    pillar: def?.pillar ?? (def?.topic ? pillarOfTopic(def.topic) : null),
    unit: def?.canonical_unit ?? null,
    site_id: t.site_id === null ? null : Number(t.site_id),
    site_name: siteName,
    baseline_year: like.baseline_year,
    baseline_value: like.baseline_value,
    target_year: like.target_year,
    target_value: like.target_value,
    direction: like.direction,
    note: t.note ?? null,
    created_by: num(t.created_by),
    updated_by: num(t.updated_by),
    created_at: t.created_at,
    updated_at: t.updated_at,
    progress: p,
    // Shortcuts the target list reads (the same as progress.progress_pct / progress.status).
    progress_pct: p.progress_pct,
    status: p.status,
    label: targetLabel(like, def?.canonical_unit ?? null),
    series: points,
  };
};

/** Targets with their progress; `filter` narrows by KPI and site ("company" = company targets). */
export async function targetsWithProgress(m: EntityManager, caller: KpiCaller, filter: { kpi?: number; site?: number | "company" }) {
  const rows: Row[] = await m.query(
    `SELECT t.*, s.name AS site_name FROM kpi_target t LEFT JOIN site s ON s.site_id = t.site_id
      WHERE t.company_id = $1 AND ($2::int IS NULL OR t.kpi_definition_id = $2)
      ORDER BY t.kpi_definition_id, t.site_id NULLS FIRST, t.target_year, t.id`,
    [caller.companyId, filter.kpi ?? null],
  );
  const visible = rows.filter((t) => {
    if (filter.site === "company" && t.site_id !== null) return false;
    if (typeof filter.site === "number" && Number(t.site_id) !== filter.site) return false;
    return t.site_id === null || !caller.sites || caller.sites.has(Number(t.site_id));
  });
  if (!visible.length) return [];
  const yearType = (await kpiSettings(m, caller.companyId)).year_type;
  const { byId, byCode } = await figureDefs(m, caller.companyId);
  const sites = await companySiteIds(m, caller.companyId);
  const from = Math.min(...visible.map((t) => Number(t.baseline_year)));
  const to = Math.max(...visible.map((t) => Number(t.target_year)));
  const values = await loadValues(m, caller.companyId, { from: yearRange(yearType, from).start, to: yearRange(yearType, to).end, statuses: ["approved"] });
  return visible.map((t) => {
    const def = byId.get(Number(t.kpi_definition_id));
    const points = def ? annualPoints(def, values, byCode, yearType, sites, t.site_id === null ? null : Number(t.site_id), Number(t.baseline_year), Number(t.target_year)) : [];
    return targetOut(t, def, t.site_name ?? null, points);
  });
}

export async function listTargets(caller: KpiCaller, query: unknown) {
  const q = parse(KpiTargetsQuerySchema, query ?? {});
  if (typeof q.site === "number" && caller.sites && !caller.sites.has(q.site)) throw new KpiError("KPI_NOT_FOUND", { site_id: q.site });
  return { targets: await targetsWithProgress(AppDataSource.manager, caller, q) };
}

const assertWriter = (caller: KpiCaller) => {
  if (!WRITERS.has(caller.role)) throw new KpiError("KPI_FORBIDDEN", { allowed: ["Admin", "Superadmin"] });
};

const audit = (m: EntityManager, id: number, action: string, changed: Record<string, { old: unknown; new: unknown }>, userId: number) =>
  m.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('kpi_target', $1, $2, $3, NULL, $4)`, [id, action, JSON.stringify(changed), userId || null]);

const FIELDS = ["kpi_definition_id", "site_id", "baseline_year", "baseline_value", "target_year", "target_value", "direction", "note"] as const;

export async function putTarget(caller: KpiCaller, body: unknown) {
  assertWriter(caller);
  const t = parse(KpiTargetSchema, body ?? {});
  const siteId = t.site_id ?? null;
  const note = t.note?.trim() || null;
  const id = await AppDataSource.transaction(async (m) => {
    // One writer per company at a time, so the one-per-year rule holds.
    await m.query(`SELECT pg_advisory_xact_lock(4153, $1)`, [caller.companyId]);
    const old: Row | undefined = t.id ? (await m.query(`SELECT * FROM kpi_target WHERE id = $1 AND company_id = $2 FOR UPDATE`, [t.id, caller.companyId]))[0] : undefined;
    if (t.id && !old) throw new KpiError("KPI_NOT_FOUND", { id: t.id });
    const kpi = await findKpi(m, caller.companyId, { id: t.kpi_definition_id });
    if (!(await isKpiSelected(m, caller.companyId, kpi))) throw new KpiError("KPI_NOT_SELECTED", { kpi: kpi.code });
    if (!NUMERIC_VALUE_TYPES.includes(kpi.value_type)) throw invalid("kpi_definition_id", "numbers_only");
    if (kpi.level === "company" && siteId !== null) throw invalid("site_id", "company_level_kpi");
    if (siteId !== null && !(await m.query(`SELECT 1 FROM site WHERE site_id = $1 AND company_id = $2`, [siteId, caller.companyId])).length) throw new KpiError("KPI_NOT_FOUND", { site_id: siteId });
    if (t.target_year <= t.baseline_year) throw invalid("target_year", "after_baseline_year");
    if (t.direction === "reduce" && !(t.target_value < t.baseline_value)) throw invalid("target_value", "reduce_needs_a_lower_target");
    if (t.direction === "increase" && !(t.target_value > t.baseline_value)) throw invalid("target_value", "increase_needs_a_higher_target");
    if (t.direction === "maintain" && t.target_value !== t.baseline_value) throw invalid("target_value", "maintain_keeps_the_baseline");

    // The baseline: the approved figure of the baseline year, or a typed one with a note.
    const yearType = (await kpiSettings(m, caller.companyId)).year_type;
    const { byId, byCode } = await figureDefs(m, caller.companyId);
    const def = byId.get(Number(kpi.id))!;
    const base = yearRange(yearType, t.baseline_year);
    const values = await loadValues(m, caller.companyId, { from: base.start, to: base.end, statuses: ["approved"] });
    const [approved] = annualPoints(def, values, byCode, yearType, await companySiteIds(m, caller.companyId), siteId, t.baseline_year, t.baseline_year);
    if (approved.value === null && !note) throw invalid("note", "typed_baseline_needs_a_note");
    if (approved.value !== null && Math.abs(approved.value - t.baseline_value) > 1e-6 * Math.max(1, Math.abs(approved.value)) && !note) {
      throw invalid("baseline_value", "differs_from_the_approved_value", { approved_value: approved.value });
    }

    const clash: Row[] = await m.query(
      `SELECT id FROM kpi_target WHERE company_id = $1 AND kpi_definition_id = $2 AND site_id IS NOT DISTINCT FROM $3 AND target_year = $4 AND ($5::int IS NULL OR id <> $5)`,
      [caller.companyId, kpi.id, siteId, t.target_year, t.id ?? null],
    );
    if (clash.length) throw invalid("target_year", "one_target_per_year", { id: Number(clash[0].id) });

    const next: Record<string, unknown> = { kpi_definition_id: Number(kpi.id), site_id: siteId, baseline_year: t.baseline_year, baseline_value: t.baseline_value, target_year: t.target_year, target_value: t.target_value, direction: t.direction, note };
    if (!old) {
      const [row]: Row[] = await m.query(
        `INSERT INTO kpi_target (company_id, kpi_definition_id, site_id, baseline_year, baseline_value, target_year, target_value, direction, note, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
        [caller.companyId, kpi.id, siteId, t.baseline_year, t.baseline_value, t.target_year, t.target_value, t.direction, note, caller.userId || null],
      );
      await audit(m, Number(row.id), "create", Object.fromEntries(FIELDS.map((k) => [k, { old: null, new: next[k] }])), caller.userId);
      return Number(row.id);
    }
    const before: Record<string, unknown> = { ...old, baseline_value: num(old.baseline_value), target_value: num(old.target_value), site_id: num(old.site_id), kpi_definition_id: num(old.kpi_definition_id) };
    const changed = Object.fromEntries(FIELDS.filter((k) => (before[k] ?? null) !== (next[k] ?? null)).map((k) => [k, { old: before[k] ?? null, new: next[k] }]));
    await m.query(
      `UPDATE kpi_target SET kpi_definition_id = $2, site_id = $3, baseline_year = $4, baseline_value = $5, target_year = $6, target_value = $7, direction = $8, note = $9, updated_by = $10, updated_at = now() WHERE id = $1`,
      [old.id, kpi.id, siteId, t.baseline_year, t.baseline_value, t.target_year, t.target_value, t.direction, note, caller.userId || null],
    );
    if (Object.keys(changed).length) await audit(m, Number(old.id), "update", changed, caller.userId);
    return Number(old.id);
  });
  const [target] = (await targetsWithProgress(AppDataSource.manager, { ...caller, sites: null }, {})).filter((x) => x.id === id);
  return { target };
}

export async function deleteTarget(caller: KpiCaller, id: number) {
  assertWriter(caller);
  await AppDataSource.transaction(async (m) => {
    const [old]: Row[] = await m.query(`SELECT * FROM kpi_target WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, caller.companyId]);
    if (!old) throw new KpiError("KPI_NOT_FOUND", { id });
    await m.query(`DELETE FROM kpi_target WHERE id = $1 AND company_id = $2`, [id, caller.companyId]);
    await audit(m, id, "delete", Object.fromEntries(FIELDS.map((k) => [k, { old: k.endsWith("_value") ? num(old[k]) : old[k] ?? null, new: null }])), caller.userId);
  });
  return { removed: id };
}
