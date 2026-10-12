/**
 * ImportRow.period → the columns an emission row stores (IM1).
 * CY yearly rows are dated Dec 31 of the year, FY rows Mar 31 (April
 * financial year, decision 2026-10-10). Monthly rows keep the date as sent
 * and are matched by month.
 */
import type { ImportPeriod } from "../../imports/contracts";
import { validatePeriodFields } from "../reportingPeriod";

export interface StoredPeriod {
  date_of_reporting: string; // YYYY-MM-DD
  reporting_period: "monthly" | "yearly";
  year_type: "CY" | "FY" | null;
}

export type PeriodResult = { ok: true; period: StoredPeriod } | { ok: false; message: string };

/** "YYYY-MM" of a stored date. */
export const monthOf = (date: string | Date): string =>
  (typeof date === "string" ? date : date.toISOString()).slice(0, 7);

export const toStoredPeriod = (period: ImportPeriod, category_id: number, now: Date = new Date()): PeriodResult => {
  if (period.kind === "monthly") {
    const d = new Date(`${period.date}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return { ok: false, message: `"${period.date}" is not a valid date.` };
    const thisMonth = now.toISOString().slice(0, 7);
    if (period.date.slice(0, 7) > thisMonth) {
      return { ok: false, message: `${period.date.slice(0, 7)} is in the future; monthly data can only be filed for months that have started.` };
    }
    return { ok: true, period: { date_of_reporting: period.date, reporting_period: "monthly", year_type: null } };
  }
  const date = period.year_type === "CY" ? `${period.year}-12-31` : `${period.year}-03-31`;
  const start = period.year_type === "CY" ? `${period.year}-01-01` : `${period.year - 1}-04-01`;
  if (start > now.toISOString().slice(0, 10)) {
    return { ok: false, message: `${period.year_type} ${period.year} has not started yet.` };
  }
  const error = validatePeriodFields({
    category_id,
    reporting_period: "yearly",
    year_type: period.year_type,
    date_of_reporting: new Date(`${date}T00:00:00Z`),
  });
  if (error) return { ok: false, message: error };
  return { ok: true, period: { date_of_reporting: date, reporting_period: "yearly", year_type: period.year_type } };
};

/** Months ("YYYY-MM") a stored period covers, for the batch-committed event. */
export const monthsCovered = (p: StoredPeriod): string[] => {
  if (p.reporting_period === "monthly") return [monthOf(p.date_of_reporting)];
  const endYear = Number(p.date_of_reporting.slice(0, 4));
  const months: string[] = [];
  if (p.year_type === "CY") {
    for (let m = 1; m <= 12; m++) months.push(`${endYear}-${String(m).padStart(2, "0")}`);
  } else {
    for (let m = 4; m <= 12; m++) months.push(`${endYear - 1}-${String(m).padStart(2, "0")}`);
    for (let m = 1; m <= 3; m++) months.push(`${endYear}-${String(m).padStart(2, "0")}`);
  }
  return months;
};
