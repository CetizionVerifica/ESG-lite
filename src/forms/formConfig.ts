/**
 * SE-2 · Simple data entry: what a form fixes for the person entering data,
 * so a User sends field values only and the server applies the rest
 * (ESG-lite_FE docs/simple-entry; spec in ./CLAUDE.md).
 *
 * Pure. It reads and checks the settings stored on `column_config`
 * (`method_by_choice`, `field_settings`, `units`, `currency`) and
 * `company.default_currency`, and prepares a row before the engine
 * (src/services/emissionWrite) calculates it. Nothing here calculates a total.
 *
 * The shapes come from the contracts (`src/scope3/contracts/schemas.ts`); the
 * methods from `MethodSchema`; the offered methods from S3-3's
 * `method_options` (read through `readMethodOptions`).
 */
import type { z } from "zod";
import {
  FieldSettingsSchema,
  FormCurrencySchema,
  FormUnitsSchema,
  MethodByChoiceSchema,
  type FieldSetting,
  type FieldSettings,
  type FormCurrency,
  type FormUnits,
  type MethodByChoice,
} from "../scope3/contracts/schemas";
import { methodLabel, type Method } from "../scope3/contracts/ghgCategory";
import { readMethodOptions } from "../scope3/dq/methodOptions";
import { SUPPORTED_CURRENCIES, supportedCurrency } from "../scope3/spend/currencies";
import { normalizeUnitKey } from "../services/calculationSpec";

// ── Reading (engine side: tolerant) ─────────────────────────────────────────

/** The form's choices for one select column: its own options and every dependent list. */
type Option = { id: string; label: string };

/** The parts of a column config these settings are checked against. */
export interface FormShape {
  /** Absent when the config was loaded without its columns: choices are then matched by id and dependent lists only. */
  columns?: Array<{ pk_id: number; column_name: string; column_type: string }>;
  extra_fields?: Array<{ key: string; type: string; options?: string[] }> | null;
  column_options?: Record<string, Array<{ id: unknown; label?: unknown }>> | null;
  dependent_options?: Record<string, Record<string, Array<{ id: unknown; label?: unknown }>>> | null;
  method_options?: unknown;
}

/** The stored settings of a form, as the engine reads them. */
export interface StoredFormSettings {
  method_by_choice?: unknown;
  field_settings?: unknown;
  units?: unknown;
  currency?: unknown;
}

/** What the engine applies for a form (empty when the form sets nothing). */
export interface FormSettings {
  /** The select column whose answer picks the method, and each answer (id or label, lower case) → method. */
  choice: { column: string; methods: Map<string, Method> } | null;
  field_settings: FieldSettings;
  /** The form's extra-field keys: their settings and defaults live in extra_data, every other key in activity_data. */
  extra_keys: Set<string>;
  fixed_unit: string | null;
  fixed_currency: string | null;
}

export const NO_FORM_SETTINGS: FormSettings = { choice: null, field_settings: {}, extra_keys: new Set(), fixed_unit: null, fixed_currency: null };

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

const optionsOf = (form: FormShape, column: string): Option[] => {
  const col = (form.columns ?? []).find((c) => lower(c.column_name) === lower(column));
  const own = col ? (form.column_options?.[String(col.pk_id)] ?? []) : [];
  const dependentKey = Object.keys(form.dependent_options ?? {}).find((k) => lower(k) === lower(column));
  const dependent = dependentKey ? Object.values(form.dependent_options?.[dependentKey] ?? {}).flat() : [];
  const seen = new Set<string>();
  const out: Option[] = [];
  for (const o of [...own, ...dependent]) {
    const id = String(o?.id ?? "").trim();
    if (!id || seen.has(lower(id))) continue;
    seen.add(lower(id));
    out.push({ id, label: String(o?.label ?? id) });
  }
  return out;
};

/**
 * The stored settings as the engine applies them. A value that doesn't fit
 * its schema is skipped, never trusted and never a reason to refuse rows: the
 * write endpoints refuse bad settings, and SE-4's form check reports stale ones.
 */
export const readFormSettings = (form: FormShape | null | undefined, stored: StoredFormSettings | null | undefined): FormSettings => {
  if (!form || !stored) return NO_FORM_SETTINGS;
  const mbc = MethodByChoiceSchema.safeParse(stored.method_by_choice);
  const fields = FieldSettingsSchema.safeParse(stored.field_settings ?? {});
  const units = FormUnitsSchema.safeParse(stored.units ?? {});
  const currency = FormCurrencySchema.safeParse(stored.currency ?? {});
  let choice: FormSettings["choice"] = null;
  if (mbc.success) {
    const methods = new Map<string, Method>();
    const options = optionsOf(form, mbc.data.column);
    for (const [answer, method] of Object.entries(mbc.data.map)) {
      methods.set(lower(answer), method);
      // A sheet or a person may give the choice's label rather than its id.
      const option = options.find((o) => lower(o.id) === lower(answer));
      if (option && !methods.has(lower(option.label))) methods.set(lower(option.label), method);
    }
    choice = { column: mbc.data.column, methods };
  }
  return {
    choice,
    field_settings: fields.success ? fields.data : {},
    extra_keys: new Set((form.extra_fields ?? []).map((f) => f.key)),
    fixed_unit: units.success ? (units.data.fixed ?? null) : null,
    fixed_currency: currency.success ? (currency.data.fixed ?? null) : null,
  };
};

/** The value of `key` on a row, matching the key without regard to case (as the engine reads columns). */
const valueOf = (data: Record<string, unknown> | null | undefined, key: string): unknown => {
  if (!data) return undefined;
  if (key in data) return data[key];
  const k = Object.keys(data).find((name) => lower(name) === lower(key));
  return k === undefined ? undefined : data[k];
};

const isEmpty = (v: unknown) => v === undefined || v === null || String(v).trim() === "";

/** The method the row's answer to the form's choice picks, or null (no choice map, no answer, or an answer it doesn't map). */
export const methodByChoice = (settings: FormSettings, activity_data: Record<string, unknown> | null | undefined): Method | null => {
  if (!settings.choice) return null;
  const answer = valueOf(activity_data, settings.choice.column);
  return isEmpty(answer) ? null : (settings.choice.methods.get(lower(answer)) ?? null);
};

/**
 * Who chose the row's method (SE-2, 01-contracts §6 after SE-0):
 * - `caller`: an import by an Admin, Superadmin or Manager, MCP, or a
 *   recalculation. A method it names (`method`, else `@method`) wins; else the
 *   row's answer to the form's choice.
 * - `contributor`: a User's typed entry, edit or manual bulk upload. Where
 *   the form fixes the method, a method the row sends is ignored: the
 *   choice's method, else (a form with one method) that method, as for a row
 *   that names none. A form with several methods and no choice map fixes
 *   none, so the row keeps today's rule (S3-5's spend fields send one): a
 *   method the form offers is used, one it doesn't is refused
 *   (METHOD_NOT_ALLOWED, S3-3).
 */
export type MethodSource = "caller" | "contributor";

export const namedMethodFor = (p: {
  source: MethodSource;
  /** The row's `method`, else its `@method`. */
  named: Method | null;
  choice: Method | null;
  offered: readonly Method[] | null | undefined;
}): Method | null => {
  if (p.source !== "contributor") return p.named ?? p.choice;
  if (p.choice) return p.choice;
  if (p.offered?.length === 1) return null;
  return p.named;
};

/**
 * A hidden field with a default gets it when the row leaves it empty, on every
 * channel (typed entries, bulk upload, smart import, MCP), so the browser
 * never has to fill it. Columns are `activity_data` keys, extra fields
 * `extra_data` keys. A value the row has is never overwritten. Returns copies.
 */
export const applyHiddenDefaults = (
  settings: FormSettings,
  activity_data: Record<string, unknown>,
  extra_data: Record<string, unknown> | null | undefined,
): { activity_data: Record<string, unknown>; extra_data: Record<string, unknown>; filled: string[] } => {
  const activity = { ...activity_data };
  const extra = { ...(extra_data ?? {}) };
  const filled: string[] = [];
  for (const [key, setting] of Object.entries(settings.field_settings)) {
    if (!setting.hidden || setting.default === undefined) continue;
    const target = settings.extra_keys.has(key) ? extra : activity;
    const existing = Object.keys(target).find((k) => lower(k) === lower(key)) ?? key;
    if (!isEmpty(target[existing])) continue;
    target[existing] = String(setting.default);
    filled.push(key);
  }
  return { activity_data: activity, extra_data: extra, filled };
};

/** The row's unit under the form's fixed unit: filled in when the row has none, refused when it names another. */
export const fixedUnitFor = (settings: FormSettings, unit: string | null | undefined): { ok: true; unit: string | null | undefined } | { ok: false; message: string } => {
  const fixed = settings.fixed_unit;
  if (!fixed) return { ok: true, unit };
  if (isEmpty(unit)) return { ok: true, unit: fixed };
  return normalizeUnitKey(unit) === normalizeUnitKey(fixed) ? { ok: true, unit } : { ok: false, message: `This form takes ${fixed} only; the row is in ${unit}.` };
};

/** True when the row gives `key` a value, in activity_data or extra_data (keys matched without regard to case). */
export const hasValue = (activity_data: Record<string, unknown> | null | undefined, extra_data: Record<string, unknown> | null | undefined, key: string): boolean =>
  !isEmpty(valueOf(activity_data, key)) || !isEmpty(valueOf(extra_data, key));

/** The currency of a spend row that names none: the form's fixed currency, else the company's default (INR for current clients). */
export const defaultCurrencyFor = (settings: FormSettings, companyDefault: string | null | undefined): string | null =>
  settings.fixed_currency ?? supportedCurrency(companyDefault) ?? null;

// ── Writing (Superadmin endpoints: strict) ──────────────────────────────────

export type FormSettingsInput = {
  method_by_choice?: MethodByChoice | null;
  field_settings?: FieldSettings;
  units?: FormUnits | null;
  currency?: FormCurrency | null;
};

export type FormSettingsParse = { ok: true; value: FormSettingsInput } | { ok: false; code: "FIELD_INVALID" | "FORM_CHECK_FAILED"; field: string; message: string };

const path = (root: string, issuePath: ReadonlyArray<PropertyKey>) =>
  [root, ...issuePath].map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join("");

const shapeError = (root: string, error: z.ZodError): FormSettingsParse => {
  const issue = error.issues[0];
  return { ok: false, code: "FIELD_INVALID", field: path(root, issue?.path ?? []), message: `${path(root, issue?.path ?? [])}: ${issue?.message ?? "not valid."}` };
};

const mismatch = (field: string, message: string): FormSettingsParse => ({ ok: false, code: "FORM_CHECK_FAILED", field, message: `${field}: ${message}` });

const methodsText = (methods: readonly Method[]) => methods.map((m) => methodLabel(m)).join(", ");

/** One field setting's default against its field: a number for a number column, one of the choices for a select. */
const checkDefault = (form: FormShape, key: string, setting: FieldSetting): string | null => {
  if (setting.default === undefined) return null;
  const value = String(setting.default).trim();
  const column = (form.columns ?? []).find((c) => lower(c.column_name) === lower(key));
  if (column?.column_type === "number" && !Number.isFinite(Number(value))) return "the default must be a number.";
  if (column?.column_type === "select") {
    const options = optionsOf(form, column.column_name);
    if (options.length && !options.some((o) => lower(o.id) === lower(value) || lower(o.label) === lower(value))) return `"${value}" isn't one of the field's choices.`;
  }
  const extra = (form.extra_fields ?? []).find((f) => f.key === key);
  if (extra?.type === "number" && !Number.isFinite(Number(value))) return "the default must be a number.";
  if (extra?.type === "select" && extra.options?.length && !extra.options.some((o) => lower(o) === lower(value))) return `"${value}" isn't one of the field's choices.`;
  return null;
};

/**
 * The SE-2 settings on a column-config write (`POST`/`PUT
 * /admin/column-configs`, Superadmin only). A key that is absent keeps what
 * is stored; `null` clears it (`field_settings: null` → `{}`). Each value
 * must fit its schema (FIELD_INVALID) and the form it is written to, as it
 * will be after this write (FORM_CHECK_FAILED): a known column or extra field,
 * a select column and its own choices, methods the form offers
 * (`method_options`), a fixed unit those methods offer, a currency ESGLite
 * converts. Refusals name the field path.
 */
export const parseFormSettingsInput = (body: Record<string, unknown>, form: FormShape): FormSettingsParse => {
  const value: FormSettingsInput = {};
  const offeredOptions = readMethodOptions(form.method_options);
  const offered = offeredOptions.map((o) => o.method);
  const columns = form.columns ?? [];
  const columnNames = columns.map((c) => c.column_name);
  const extraKeys = (form.extra_fields ?? []).map((f) => f.key);

  if (body.method_by_choice !== undefined) {
    if (body.method_by_choice === null) value.method_by_choice = null;
    else {
      const parsed = MethodByChoiceSchema.safeParse(body.method_by_choice);
      if (!parsed.success) return shapeError("method_by_choice", parsed.error);
      const { column, map } = parsed.data;
      const col = columns.find((c) => c.column_name === column);
      if (!col) return mismatch("method_by_choice.column", `"${column}" isn't a field of this form.`);
      if (col.column_type !== "select") return mismatch("method_by_choice.column", `"${column}" isn't a choice field.`);
      const options = optionsOf(form, column);
      if (!options.length) return mismatch("method_by_choice.column", `"${column}" has no choices yet.`);
      if (!Object.keys(map).length) return mismatch("method_by_choice.map", "map at least one choice to a method.");
      if (!offered.length) return mismatch("method_by_choice.map", "set the form's methods (method_options) first.");
      for (const [answer, method] of Object.entries(map)) {
        if (!options.some((o) => o.id === answer)) return mismatch(`method_by_choice.map.${answer}`, `"${answer}" isn't one of ${column}'s choices.`);
        if (!offered.includes(method)) return mismatch(`method_by_choice.map.${answer}`, `${methodLabel(method)} isn't one of the form's methods (${methodsText(offered)}).`);
      }
      value.method_by_choice = parsed.data;
    }
  }

  if (body.field_settings !== undefined) {
    if (body.field_settings === null) value.field_settings = {};
    else {
      const parsed = FieldSettingsSchema.safeParse(body.field_settings);
      if (!parsed.success) return shapeError("field_settings", parsed.error);
      for (const [key, setting] of Object.entries(parsed.data)) {
        if (!columnNames.includes(key) && !extraKeys.includes(key)) return mismatch(`field_settings.${key}`, `"${key}" isn't a field of this form.`);
        const bad = checkDefault(form, key, setting);
        if (bad) return mismatch(`field_settings.${key}.default`, bad);
      }
      value.field_settings = parsed.data;
    }
  }

  if (body.units !== undefined) {
    if (body.units === null) value.units = null;
    else {
      const parsed = FormUnitsSchema.safeParse(body.units);
      if (!parsed.success) return shapeError("units", parsed.error);
      const fixed = parsed.data.fixed;
      if (fixed) {
        // The methods a row of this form can take: each mapped choice's, else the form's default.
        const choiceMap = value.method_by_choice !== undefined ? value.method_by_choice : null;
        const methods = choiceMap ? [...new Set(Object.values(choiceMap.map))] : offered.slice(0, 1);
        for (const method of methods) {
          const units = offeredOptions.find((o) => o.method === method)?.units ?? [];
          if (units.length && !units.some((u) => normalizeUnitKey(u) === normalizeUnitKey(fixed))) {
            return mismatch("units.fixed", `${methodLabel(method)} offers ${units.join(", ")}; "${fixed}" isn't one of them.`);
          }
        }
      }
      value.units = parsed.data;
    }
  }

  if (body.currency !== undefined) {
    if (body.currency === null) value.currency = null;
    else {
      const parsed = FormCurrencySchema.safeParse(body.currency);
      if (!parsed.success) return shapeError("currency", parsed.error);
      if (parsed.data.fixed && !supportedCurrency(parsed.data.fixed)) {
        return mismatch("currency.fixed", `${parsed.data.fixed} can't be converted yet; use one of ${SUPPORTED_CURRENCIES.join(", ")}.`);
      }
      value.currency = parsed.data;
    }
  }
  return { ok: true, value };
};
