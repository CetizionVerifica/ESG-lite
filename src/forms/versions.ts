/**
 * SE-4 · Checking and publishing data-entry forms (ESG-lite_FE docs/simple-entry,
 * SE-4 spec). `check.ts` holds the rules; this file loads what they read
 * (the form, the site's factors, the company's currency) and writes versions.
 *
 *   checkStoredForm   the form as saved
 *   checkDraftForm    the builder's unsaved form (the PUT/POST body), before it saves
 *   publishForm       check, then write column_config_version and bump the version
 *   checkSummaries    every form's error and warning counts, for the forms list
 *
 * Saving (PUT) never runs the check: it keeps today's behaviour. Publish is
 * what refuses a form with errors.
 */
import { In, type EntityManager } from "typeorm";
import { ColumnConfig } from "../entities/ColumnConfig";
import { ColumnConfigVersion } from "../entities/ColumnConfigVersion";
import { ColumnEntity } from "../entities/Column";
import { targetYearFor } from "../services/emissionWrite/resolve";
import { checkForm, type CheckFactor, type CheckInput, type CheckResult } from "./check";

/** The settings a version stores, besides the columns. */
export const VERSIONED_KEYS = [
  "config_name",
  "column_options",
  "column_dependencies",
  "dependent_options",
  "emission_category_mapping",
  "extra_fields",
  "calculation",
  "method_options",
  "method_by_choice",
  "field_settings",
  "units",
  "currency",
] as const;

type FormColumn = { pk_id: number; column_name: string; column_type: string };

/** The form as a version stores it: its settings and its columns by id, name and type. */
export const snapshotOf = (config: object & { columns?: FormColumn[] }): Record<string, unknown> => ({
  ...Object.fromEntries(VERSIONED_KEYS.map((k) => [k, (config as Record<string, unknown>)[k] ?? null])),
  columns: (config.columns ?? []).map((c) => ({ pk_id: c.pk_id, column_name: c.column_name, column_type: c.column_type })).sort((a, b) => a.pk_id - b.pk_id),
});

/** The factor year a check uses unless told otherwise: the one rows dated today use (this year − 1). */
export const defaultCheckYear = (now: Date = new Date()): number => targetYearFor(now.toISOString().slice(0, 10));

/** `?year=` as a factor year, or an error message. */
export const parseCheckYear = (raw: unknown): { ok: true; year: number } | { ok: false; message: string } => {
  if (raw === undefined || raw === null || raw === "") return { ok: true, year: defaultCheckYear() };
  const year = Number(raw);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) return { ok: false, message: "year must be a factor year such as 2025." };
  return { ok: true, year };
};

const FACTOR_FIELDS = `emission_factor_id, emission_category_name, global_category_name, year, denominator_unit, factor_type`;

const factorsOf = (manager: EntityManager, site_id: number, category_id: number): Promise<CheckFactor[]> =>
  manager.query(`SELECT ${FACTOR_FIELDS} FROM emission_factors WHERE site_id = $1 AND category_id = $2`, [site_id, category_id]);

async function companyCurrency(manager: EntityManager, site_id: number): Promise<string | null> {
  const [row] = await manager.query(`SELECT c.default_currency FROM site s JOIN company c ON c.company_id = s.company_id WHERE s.site_id = $1`, [site_id]);
  return row?.default_currency ?? null;
}

export interface FormCheck extends CheckResult {
  form_id: number | null;
  /** The factor year checked. */
  year: number;
  /** The stored form's version (null for a draft of a new form). */
  version: number | null;
}

async function runCheck(manager: EntityManager, form: CheckInput["form"], site_id: number, category_id: number, year: number) {
  const [factors, currency] = await Promise.all([factorsOf(manager, site_id, category_id), companyCurrency(manager, site_id)]);
  return checkForm({ form, factors, year, companyDefaultCurrency: currency });
}

const loadForm = (manager: EntityManager, id: number) =>
  manager.getRepository(ColumnConfig).findOne({ where: { pk_id: id }, relations: ["site", "category", "columns"] });

/** The saved form, checked. Null when there is no such form. */
export async function checkStoredForm(manager: EntityManager, id: number, year: number): Promise<FormCheck | null> {
  const config = await loadForm(manager, id);
  if (!config) return null;
  const result = await runCheck(manager, config, config.site.site_id, config.category.category_id, year);
  return { ...result, form_id: config.pk_id, year, version: config.version };
}

export type DraftCheck = { ok: true; check: FormCheck } | { ok: false; status: 400 | 404; message: string; field?: string };

/**
 * The builder's form before it saves: the same body as `PUT /column-configs/:id`
 * (with `pk_id`) or `POST /column-configs` (a new form, no `pk_id`). Keys the
 * body leaves out keep the saved form's; `column_ids` and `rename_map` give the columns.
 */
export async function checkDraftForm(manager: EntityManager, body: Record<string, unknown>, year: number): Promise<DraftCheck> {
  const pk = body.pk_id === undefined || body.pk_id === null ? null : Number(body.pk_id);
  if (pk !== null && !Number.isInteger(pk)) return { ok: false, status: 400, message: "pk_id must be a form id.", field: "pk_id" };
  const stored = pk === null ? null : await loadForm(manager, pk);
  if (pk !== null && !stored) return { ok: false, status: 404, message: "Column config not found" };
  const site_id = Number(body.site_id ?? stored?.site.site_id);
  const category_id = Number(body.category_id ?? stored?.category.category_id);
  if (!Number.isInteger(site_id) || !Number.isInteger(category_id)) return { ok: false, status: 400, message: "site_id and category_id are required for a new form.", field: "site_id" };

  let columns: FormColumn[] = stored?.columns ?? [];
  if (Array.isArray(body.column_ids)) {
    const ids = [...new Set(body.column_ids.map(Number).filter(Number.isInteger))];
    columns = ids.length ? await manager.getRepository(ColumnEntity).find({ where: { pk_id: In(ids) } }) : [];
    if (columns.length !== ids.length) return { ok: false, status: 400, message: "One or more columns not found", field: "column_ids" };
  }
  // A rename the save would apply: the check reads the new name.
  const renames = body.rename_map && typeof body.rename_map === "object" ? (body.rename_map as Record<string, unknown>) : {};
  columns = columns.map((c) => (typeof renames[c.column_name] === "string" ? { ...c, column_name: String(renames[c.column_name]).trim() } : c));

  const saved = (stored ?? {}) as Record<string, unknown>;
  const draft: Record<string, unknown> = { columns };
  for (const k of VERSIONED_KEYS) draft[k] = body[k] !== undefined ? body[k] : (saved[k] ?? null);
  const result = await runCheck(manager, draft as CheckInput["form"], site_id, category_id, year);
  return { ok: true, check: { ...result, form_id: stored?.pk_id ?? null, year, version: stored?.version ?? null } };
}

/** JSON with keys in a fixed order, so a stored jsonb snapshot and a fresh one compare equal. */
export const stableJson = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stableJson).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v as object)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v ?? null);

export type PublishResult =
  | { ok: true; version: ColumnConfigVersion; check: FormCheck; unchanged: boolean }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "check_failed"; check: FormCheck };

/**
 * Check the saved form and, when it has no errors, record it as a new version.
 * A form's history starts at its current version (1 for every form today);
 * each later publish that changes something adds one. Warnings publish.
 */
export async function publishForm(manager: EntityManager, id: number, opts: { year: number; note?: string | null; userId?: number | null }): Promise<PublishResult> {
  return manager.transaction(async (tx): Promise<PublishResult> => {
    // One publish at a time per form, so two can't take the same number.
    const [locked] = await tx.query(`SELECT pk_id FROM column_config WHERE pk_id = $1 FOR UPDATE`, [id]);
    if (!locked) return { ok: false, reason: "not_found" };
    const config = await loadForm(tx, id);
    if (!config) return { ok: false, reason: "not_found" };
    const result = await runCheck(tx, config, config.site.site_id, config.category.category_id, opts.year);
    const check: FormCheck = { ...result, form_id: id, year: opts.year, version: config.version };
    if (!check.ok) return { ok: false, reason: "check_failed", check };

    const versions = tx.getRepository(ColumnConfigVersion);
    const latest = await versions.findOne({ where: { column_config_id: id }, order: { version: "DESC" } });
    const snapshot = snapshotOf(config);
    // Nothing changed since the last publish: that version stays the live one.
    if (latest && stableJson(latest.config) === stableJson(snapshot)) return { ok: true, version: latest, check: { ...check, version: latest.version }, unchanged: true };
    const current = config.version ?? 1;
    const next = latest ? current + 1 : current;
    const note = typeof opts.note === "string" && opts.note.trim() ? opts.note.trim().slice(0, 500) : null;
    const row = await versions.save(versions.create({ column_config_id: id, version: next, config: snapshot, note, published_by: opts.userId ?? null }));
    if (next !== current) await tx.query(`UPDATE column_config SET version = $2 WHERE pk_id = $1`, [id, next]);
    return { ok: true, version: row, check: { ...check, version: next }, unchanged: false };
  });
}

export interface VersionView {
  version: number;
  published_at: Date;
  note: string | null;
  published_by: { user_id: number; name: string } | null;
  config: Record<string, unknown>;
}

/** The form's versions, newest first, with who published each. */
export async function listVersions(manager: EntityManager, id: number): Promise<{ form_id: number; version: number; versions: VersionView[] } | null> {
  const [config] = await manager.query(`SELECT pk_id, version FROM column_config WHERE pk_id = $1`, [id]);
  if (!config) return null;
  const rows: Array<{ version: number; published_at: Date; note: string | null; config: Record<string, unknown>; user_id: number | null; first: string | null; last: string | null }> =
    await manager.query(
      `SELECT v.version, v.published_at, v.note, v.config, u.user_id, u.name AS first, u.last_name AS last
         FROM column_config_version v LEFT JOIN "user" u ON u.user_id = v.published_by
        WHERE v.column_config_id = $1 ORDER BY v.version DESC`,
      [id],
    );
  return {
    form_id: config.pk_id,
    version: config.version,
    versions: rows.map((r) => ({
      version: r.version,
      published_at: r.published_at,
      note: r.note,
      published_by: r.user_id ? { user_id: r.user_id, name: [r.first, r.last].filter(Boolean).join(" ") } : null,
      config: r.config,
    })),
  };
}

export interface CheckSummary {
  form_id: number;
  site_id: number;
  category_id: number;
  version: number;
  errors: number;
  warnings: number;
  /** The first error in plain words, for the list's tooltip. */
  first_error: string | null;
}

/**
 * Every form's check, counted, for the forms list (filtered by site and
 * category when given). Factors load once per site × category.
 */
export async function checkSummaries(manager: EntityManager, year: number, filter: { site_id?: number; category_id?: number } = {}): Promise<CheckSummary[]> {
  const where: Record<string, unknown> = {};
  if (filter.site_id) where.site = { site_id: filter.site_id };
  if (filter.category_id) where.category = { category_id: filter.category_id };
  const configs = await manager.getRepository(ColumnConfig).find({ where, relations: ["site", "category", "columns"], order: { pk_id: "ASC" } });
  const loaded = new Map<string, Promise<[CheckFactor[], string | null]>>();
  const out: CheckSummary[] = [];
  for (const config of configs) {
    const site_id = config.site.site_id;
    const category_id = config.category.category_id;
    const key = `${site_id}:${category_id}`;
    if (!loaded.has(key)) loaded.set(key, Promise.all([factorsOf(manager, site_id, category_id), companyCurrency(manager, site_id)]));
    const [factors, currency] = await loaded.get(key)!;
    const result = checkForm({ form: config, factors, year, companyDefaultCurrency: currency });
    out.push({ form_id: config.pk_id, site_id, category_id, version: config.version, errors: result.errors.length, warnings: result.warnings.length, first_error: result.errors[0]?.message ?? null });
  }
  return out;
}
