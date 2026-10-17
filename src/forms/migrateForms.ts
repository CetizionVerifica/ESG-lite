/**
 * SE-5 · What `migrate:entry-forms-data` changes on one form (pure; the
 * script in src/scripts/migrateEntryFormsData.ts loads, checks and writes).
 *
 * - An "@method" formula (S3-9 travel, S3-10 sold products): the form gets its
 *   `method_options`; with several methods, a "Record type" question whose
 *   answers pick the method ("Trip distance" → distance_based), and the formula
 *   follows that question. Answer ids are the method keys, so the formula's keys
 *   stay and rows saved before keep calculating from their "@method"
 *   (calculationSpec.ts falls back to it when a row has no answer).
 * - A transport form (S3-8, per unit) with no `method_options` gets the category's.
 * - A spend form (S3-5 "spent_value" + "currency" extras) whose methods are bare
 *   keys gets `{method, units}`: the currencies for spend, the form's units otherwise.
 *
 * Nothing here touches a row; a form already in the new model is left alone.
 */
import type { CalculationSpec } from "../entities/ColumnConfig";
import { METHOD_KEYS, type Method } from "../scope3/contracts/ghgCategory";
import { readMethodOptions } from "../scope3/dq/methodOptions";
import { SUPPORTED_CURRENCIES } from "../scope3/spend/currencies";
import { normalizeUnitKey, ROW_METHOD_COLUMN } from "../services/calculationSpec";
import * as travel from "../scope3/commuting/configs";
import * as soldProducts from "../scope3/soldProducts/configs";
import * as transport from "../scope3/transport/configs";

/** The question the form asks instead of a method: the library column SE-3's builder adds too. */
export const QUESTION_COLUMN = "Record type";
export const QUESTION_LABEL = "What does your record show?";

/** Each method's answer in the client's words: what the record shows, never the method's name. */
export const ANSWER_LABELS: Record<Exclude<Method, "unknown">, string> = {
  supplier_specific: "The supplier's own figure",
  hybrid: "Supplier figures for part of it",
  average_data: "Average figures",
  spend_based: "Amount spent",
  fuel_based: "Fuel used",
  distance_based: "Trip distance",
  site_specific: "Figures measured at the site",
  waste_type_specific: "Waste by treatment",
  asset_specific: "Figures for the asset",
  lessor_specific: "The lessor's figures",
  lessee_specific: "The lessee's figures",
  direct_use: "Energy or fuel used in use",
  indirect_use: "Indirect use",
  franchise_specific: "The franchise's figures",
  investment_specific: "The investee's figures",
  project_specific: "The project's figures",
};

type MethodOption = { method: Exclude<Method, "unknown">; units: string[] };
type Choice = { id: string; label: string };

export interface FormToMigrate {
  pk_id: number;
  ghg_category: number | null;
  columns: Array<{ pk_id: number; column_name: string; column_type: string }>;
  column_options: Record<string, Choice[] | unknown> | null;
  extra_fields: Array<{ key: string }> | null;
  calculation: CalculationSpec | null;
  method_options: unknown;
  method_by_choice: unknown;
  field_settings: Record<string, Record<string, unknown>> | null;
  /** The site × category's unit names (the `unit` table). */
  units: string[];
}

export type FormChange = "question" | "single_method" | "transport_methods" | "spend_units";

export interface FormPlan {
  form_id: number;
  change: FormChange;
  /** Column values to write (the SE-2 settings, `calculation`, `column_options`). */
  set: Partial<Pick<FormToMigrate, "column_options" | "calculation" | "method_options" | "method_by_choice" | "field_settings">>;
  /** The question column to add to the form's fields. */
  addQuestion: boolean;
}

export type PlanResult = { plan: FormPlan } | { skip: string } | null;

const isMethod = (k: string): k is Exclude<Method, "unknown"> => (METHOD_KEYS as readonly string[]).includes(k) && k !== "unknown";

/** The category's own method list and units (most specific first), from the module that wrote its standard form. */
function categoryOptions(ghg: number | null): MethodOption[] {
  if (ghg === 6 || ghg === 7) return travel.METHOD_OPTIONS[ghg].map((m) => ({ method: m as MethodOption["method"], units: travel.UNITS_BY_METHOD[ghg][m] ?? [] }));
  if (ghg === 10 || ghg === 11 || ghg === 12) return soldProducts.methodOptionsFor(ghg) as MethodOption[];
  if (ghg === 4 || ghg === 9) return transport.methodOptionsFor(ghg) as MethodOption[];
  return [];
}

const hasSpendExtras = (f: FormToMigrate) => {
  const keys = new Set((f.extra_fields ?? []).map((x) => x?.key));
  return keys.has("spent_value") && keys.has("currency");
};

/**
 * The form's methods with their units: what it stores when every entry has units, else the
 * category's list (or the formula's result unit), kept to the methods the formula has. Null when
 * a method's units can't be told.
 */
function optionsFor(f: FormToMigrate, methods: Array<MethodOption["method"]>): MethodOption[] | null {
  const stored = readMethodOptions(f.method_options);
  if (stored.length && stored.every((o) => o.units.length)) return stored as MethodOption[];
  const table = categoryOptions(f.ghg_category);
  const ordered = [...table.map((o) => o.method).filter((m) => methods.includes(m)), ...methods.filter((m) => !table.some((o) => o.method === m))];
  const out: MethodOption[] = [];
  for (const m of ordered) {
    const fromTable = table.find((o) => o.method === m)?.units ?? [];
    const resultUnit = f.calculation?.methods?.[m]?.activity_unit;
    const units = fromTable.length ? fromTable : resultUnit ? [resultUnit] : [];
    if (!units.length) return null;
    out.push({ method: m, units });
  }
  // A spend form's amount is entered in a currency (S3-5), outside the formula.
  if (hasSpendExtras(f) && stored.some((o) => o.method === "spend_based") && !out.some((o) => o.method === "spend_based")) {
    out.push({ method: "spend_based", units: [...SUPPORTED_CURRENCIES] });
  }
  return out;
}

/** What to change on one form, a reason it can't be moved, or null when it's in the new model already. */
export function planFormMigration(f: FormToMigrate, question: { pk_id: number; column_name: string } | null): PlanResult {
  const calc = f.calculation;

  // 1 · "@method" formulas.
  if (calc?.mode === "per_method" && calc.method_column === ROW_METHOD_COLUMN) {
    const keys = Object.keys(calc.methods ?? {});
    const methods = keys.filter(isMethod);
    if (!methods.length || methods.length !== keys.length) return { skip: `formula keys aren't all methods (${keys.join(", ")})` };
    const options = optionsFor(f, methods);
    if (!options) return { skip: "a method's units can't be told" };
    const sameOptions = JSON.stringify(readMethodOptions(f.method_options)) === JSON.stringify(options);

    if (methods.length === 1) {
      // One method: nothing to ask; the form fixes it (SE-2) and "@method" stays the row's.
      return sameOptions ? null : { plan: { form_id: f.pk_id, change: "single_method", set: { method_options: options }, addQuestion: false } };
    }
    if (!question) return { skip: `no "${QUESTION_COLUMN}" column to ask with` };
    if (f.columns.some((c) => c.column_name === question.column_name && c.pk_id !== question.pk_id)) return { skip: `the form has another "${question.column_name}" field` };
    const formulaMethods = options.map((o) => o.method).filter((m) => methods.includes(m));
    const answers: Choice[] = formulaMethods.map((m) => ({ id: m, label: ANSWER_LABELS[m] }));
    const fs = f.field_settings ?? {};
    return {
      plan: {
        form_id: f.pk_id,
        change: "question",
        addQuestion: !f.columns.some((c) => c.pk_id === question.pk_id),
        set: {
          method_options: options,
          column_options: { ...(f.column_options ?? {}), [String(question.pk_id)]: answers },
          method_by_choice: { column: question.column_name, map: Object.fromEntries(formulaMethods.map((m) => [m, m])) },
          // The formula's keys stay (they are the answers' ids); only the column that picks them moves.
          calculation: { ...calc, method_column: question.column_name },
          field_settings: { ...fs, [question.column_name]: { label: QUESTION_LABEL, ...(fs[question.column_name] ?? {}) } },
        },
      },
    };
  }

  // 2 · Transport forms (per unit) with no methods: the category's list, as S3-8 seeds it, kept to the
  // units the formula calculates (an older form may take km and tonne.km only). Spend needs its fields.
  if (calc?.mode === "per_unit" && (f.ghg_category === 4 || f.ghg_category === 9) && !readMethodOptions(f.method_options).length) {
    const formulaUnits = new Set(Object.keys(calc.methods ?? {}).map(normalizeUnitKey));
    const options = (transport.methodOptionsFor(f.ghg_category) as MethodOption[])
      .map((o) => ({ method: o.method, units: o.method === "spend_based" ? (hasSpendExtras(f) ? o.units : []) : o.units.filter((u) => formulaUnits.has(normalizeUnitKey(u))) }))
      .filter((o) => o.units.length);
    if (!options.length) return { skip: "the formula's units fit no transport method" };
    return { plan: { form_id: f.pk_id, change: "transport_methods", set: { method_options: options }, addQuestion: false } };
  }

  // 3 · Spend forms whose methods are bare keys (S3-5's flip): each with its units.
  const stored = readMethodOptions(f.method_options);
  if (hasSpendExtras(f) && stored.some((o) => o.method === "spend_based") && stored.some((o) => !o.units.length)) {
    const units = [...new Set(f.units.filter(Boolean))];
    const options: MethodOption[] = [];
    for (const o of stored as MethodOption[]) {
      const u = o.units.length ? o.units : o.method === "spend_based" ? [...SUPPORTED_CURRENCIES] : units;
      if (!u.length) return { skip: `no units for ${o.method}` };
      options.push({ method: o.method, units: u });
    }
    return { plan: { form_id: f.pk_id, change: "spend_units", set: { method_options: options }, addQuestion: false } };
  }
  return null;
}
