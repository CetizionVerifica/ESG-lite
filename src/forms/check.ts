/**
 * SE-4 · The form check (ESG-lite_FE docs/simple-entry, SE-4 spec): what keeps
 * a form from going live half set up. Pure: it reads the form, the site's
 * factors for the category and the company's default currency, and returns
 * errors (publishing is refused) and warnings (published), each with the
 * field path to fix. Nothing is calculated or written here.
 */
import type { CalculationSpec } from "../entities/ColumnConfig";
import { FactorIndex } from "../services/emissionWrite/resolve";
import { canonicalUnit, getConversionFactor } from "../services/emissionWrite/units";
import { methodLabel, type Method } from "../scope3/contracts/ghgCategory";
import { readMethodOptions } from "../scope3/dq/methodOptions";
import { supportedCurrency } from "../scope3/spend/currencies";
import { type FormShape, readFormSettings } from "./formConfig";

/** What the check can find; FACTOR_FALLBACK_YEAR is the only warning. */
export const CHECK_CODES = ["NO_FACTOR_FOR_YEAR", "FACTOR_FALLBACK_YEAR", "FIELD_MISSING", "METHOD_UNMAPPED", "CURRENCY_MISSING", "SPEND_FACTOR_MISSING", "UNIT_NOT_CONVERTIBLE", "DEFAULT_MISSING"] as const;

/** One problem, by the field to fix. */
export interface CheckIssue {
  code: (typeof CHECK_CODES)[number];
  field: string;
  message: string;
}

export interface CheckResult {
  ok: boolean;
  errors: CheckIssue[];
  warnings: CheckIssue[];
}

/** A factor as the check reads it. */
export type CheckFactor = {
  emission_factor_id: number;
  emission_category_name: string;
  global_category_name?: string | null;
  year: number;
  denominator_unit?: string | null;
  factor_type?: string | null;
};

export interface CheckInput {
  form: FormShape & {
    emission_category_mapping?: Record<string, string> | null;
    calculation?: CalculationSpec | null;
    method_by_choice?: unknown;
    field_settings?: unknown;
    units?: unknown;
    currency?: unknown;
  };
  /** The site's factors for the category (every year). */
  factors: CheckFactor[];
  /** The factor year rows are entered for. */
  year: number;
  /** `company.default_currency`. */
  companyDefaultCurrency?: string | null;
}

const plainPath = (key: string) => key.split("|").join(" › ");

/** Every rule of the SE-4 spec, in one pass. */
export function checkForm({ form, factors, year, companyDefaultCurrency }: CheckInput): CheckResult {
  const errors: CheckIssue[] = [];
  const warnings: CheckIssue[] = [];
  const settings = readFormSettings(form, form);
  const index = new FactorIndex(factors as never);
  const columns = form.columns ?? [];
  const numberColumn = (name: string) => columns.find((c) => c.column_name === name && c.column_type === "number");

  // 1 · Every factor-match rule reaches a factor for the year; an older year only warns.
  const targets = new Map<string, CheckFactor>();
  for (const [key, target] of Object.entries(form.emission_category_mapping ?? {})) {
    const match = index.find(target, year);
    const field = `emission_category_mapping.${key}`;
    if (!match) errors.push({ code: "NO_FACTOR_FOR_YEAR", field, message: `${plainPath(key)} points to "${target}", which has no emission factor.` });
    else {
      targets.set(target, match.factor as CheckFactor);
      if (match.fallback_year) warnings.push({ code: "FACTOR_FALLBACK_YEAR", field, message: `${plainPath(key)}: no ${year} factor for "${target}"; the ${match.factor.year} factor is used.` });
    }
  }

  // 2 · Every formula's fields are number fields of the form.
  const calc = form.calculation;
  for (const [key, m] of Object.entries(calc?.methods ?? {})) {
    for (const f of [...(m.multiply ?? []), ...(m.divide ?? [])]) {
      if (!numberColumn(f)) errors.push({ code: "FIELD_MISSING", field: `calculation.methods.${key}`, message: `The formula for "${key}" uses "${f}", which isn't a number field of this form.` });
    }
  }

  // 3 · The question: every answer picks a method, and has a formula when the formula follows the answer.
  const choice = settings.choice;
  const mbc = form.method_by_choice as { column?: string; map?: Record<string, string> } | null | undefined;
  if (choice && mbc?.column) {
    const col = columns.find((c) => c.column_name === mbc.column);
    const answers = col ? [...((form.column_options?.[String(col.pk_id)] ?? []) as Array<{ id: unknown; label?: unknown }>), ...Object.values(form.dependent_options?.[mbc.column] ?? {}).flat()] : [];
    const seen = new Set<string>();
    for (const a of answers) {
      const id = String(a?.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (!mbc.map?.[id]) errors.push({ code: "METHOD_UNMAPPED", field: `method_by_choice.map.${id}`, message: `The answer "${String(a?.label ?? id)}" picks no method.` });
      else if (calc?.mode === "per_method" && calc.method_column === mbc.column && !calc.methods[id])
        errors.push({ code: "FIELD_MISSING", field: `calculation.methods.${id}`, message: `The answer "${String(a?.label ?? id)}" has no formula.` });
    }
  }

  // 4 · Spend: a currency (the form's or the company's) and a spend factor.
  const offered = readMethodOptions(form.method_options).map((o) => o.method);
  const methods = new Set<Method>([...offered, ...Object.values(mbc?.map ?? {})] as Method[]);
  if (methods.has("spend_based")) {
    if (!settings.fixed_currency && !supportedCurrency(companyDefaultCurrency))
      errors.push({ code: "CURRENCY_MISSING", field: "currency.fixed", message: `${methodLabel("spend_based")} needs a currency: fix one on the form or set the client's default.` });
    if (!factors.some((f) => f.factor_type === "eeio_spend"))
      errors.push({ code: "SPEND_FACTOR_MISSING", field: "method_options", message: `${methodLabel("spend_based")} needs a spend factor (EEIO, per USD) for this category.` });
  }

  // 5 · A fixed unit converts to every factor the form's choices reach.
  if (settings.fixed_unit) {
    for (const [target, f] of targets) {
      if (f.denominator_unit && canonicalUnit(f.denominator_unit) !== canonicalUnit(settings.fixed_unit) && getConversionFactor(settings.fixed_unit, f.denominator_unit) === null)
        errors.push({ code: "UNIT_NOT_CONVERTIBLE", field: "units.fixed", message: `The form takes ${settings.fixed_unit}, but "${target}" is per ${f.denominator_unit} and ${settings.fixed_unit} can't be converted to it.` });
    }
  }

  // 6 · A hidden required field needs a default (nobody can fill it).
  for (const [key, s] of Object.entries(settings.field_settings)) {
    if (s.hidden && s.required && (s.default === undefined || String(s.default).trim() === ""))
      errors.push({ code: "DEFAULT_MISSING", field: `field_settings.${key}`, message: `"${s.label ?? key}" is hidden and required but has no default.` });
  }

  return { ok: errors.length === 0, errors, warnings };
}
