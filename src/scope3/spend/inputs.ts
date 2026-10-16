/**
 * S3-5 · which rows are spend rows, and their amount, currency and purchase
 * date. Pure; no database.
 *
 * A row is calculated from the amount spent when its method says so (the
 * row's `method`, or `activity_data["@method"]` until S3-3 gives rows that
 * column, as S3-9 does) or when its factor is a spend (EEIO) factor. The
 * amount is `spent_value` with `currency` (the form fields, wherever the
 * form keeps them: calculation fields or the older extra fields), or else the
 * row's quantity when its unit is a currency (bulk and Claude rows: 1,240,000
 * in "INR").
 */
import type { EmissionFactor } from "../../entities/EmissionFactor";
import { pickActivityValue } from "../../services/activityValue";
import { ROW_METHOD_COLUMN } from "../../services/calculationSpec";
import { looksLikeCurrency } from "./currencies";

export const SPEND_METHOD = "spend_based";

export interface SpendInput {
  amount: number;
  /** As entered, upper case; may be a currency ESGLite doesn't convert (CURRENCY_NOT_SUPPORTED). */
  currency: string;
  /** YYYY-MM-DD: the invoice date when the row gives a valid one, else the reporting date. */
  spend_date: string;
  /** `spent_value`: the amount field; `quantity`: the row's quantity in a currency unit (a form's own fields may multiply into it). */
  amount_from: "spent_value" | "quantity";
}

const present = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";

const field = (key: string, ...sources: Array<Record<string, unknown> | null | undefined>): unknown => {
  for (const s of sources) {
    if (!s) continue;
    const k = Object.keys(s).find((x) => x.toLowerCase() === key);
    if (k && present(s[k])) return s[k];
  }
  return undefined;
};

/** The row asked for the spend method, or its factor is a spend factor. */
export const isSpendRow = (activity_data: Record<string, unknown>, factor: Pick<EmissionFactor, "factor_type"> | null, rowMethod?: string | null): boolean =>
  rowMethod === SPEND_METHOD || String(activity_data?.[ROW_METHOD_COLUMN] ?? "").trim() === SPEND_METHOD || factor?.factor_type === "eeio_spend";

/** The method named on the row itself (not inferred from the factor). */
export const rowAsksForSpend = (activity_data: Record<string, unknown>, rowMethod?: string | null): boolean =>
  rowMethod === SPEND_METHOD || String(activity_data?.[ROW_METHOD_COLUMN] ?? "").trim() === SPEND_METHOD;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** "2026-09-03", "2026-09-03T00:00:00Z" → "2026-09-03"; anything else → null. */
export const isoDay = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const m = ISO_DATE.exec(String(value ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? m[0] : null;
};

/**
 * Amount, currency and date of a spend row, or null when the row carries no
 * amount in a currency (then it isn't calculated from spend).
 */
export const spendInputOf = (
  activity_data: Record<string, unknown>,
  extra_data: Record<string, unknown> | null | undefined,
  unit: string | null | undefined,
  reportingDate: string,
  selectColumns?: Set<string>,
): SpendInput | null => {
  const day = isoDay(field("invoice_date", activity_data, extra_data)) ?? isoDay(reportingDate) ?? String(reportingDate).slice(0, 10);
  const spent = field("spent_value", activity_data, extra_data);
  const currency = field("currency", activity_data, extra_data);
  if (present(spent) && present(currency)) {
    return { amount: parseFloat(String(spent)), currency: String(currency).trim().toUpperCase(), spend_date: day, amount_from: "spent_value" };
  }
  if (looksLikeCurrency(unit)) {
    return { amount: pickActivityValue(activity_data, selectColumns), currency: String(unit).trim().toUpperCase(), spend_date: day, amount_from: "quantity" };
  }
  return null;
};
