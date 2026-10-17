/**
 * KPI-4 · the period engine (pure; layer rule 6). A KPI value's period comes
 * from the KPI's frequency and the company's year type:
 *   CY 2026 = January–December 2026;
 *   FY 2026 = April 2025–March 2026 (FY_START_MONTH, as src/reporting/ghg-data.ts).
 * Quarters run from the year's first month (FY Q1 = April–June). Dates are
 * ISO `YYYY-MM-DD` strings in UTC, so a server's time zone never moves a period.
 *
 *   periodsFor(frequency, yearType, year)  every period of a reporting year
 *   periodOf(date, frequency, yearType)    the period a date falls in
 *   isPeriodStart(date, frequency, yearType)
 *   reportingYearOf(date, yearType)
 *   yearRange / monthRange                 for locks
 *   dueDate(period, dueDay = 15)           due_day of the month after the period ends (D16)
 */
import { FY_START_MONTH } from "../../reporting/ghg-data";
import type { KpiFrequency, YearType } from "../contracts/enums";

export interface KpiPeriod {
  start: string;
  end: string;
  label: string;
  frequency: KpiFrequency;
  year_type: YearType;
  /** The reporting year (FY 2026 = April 2025–March 2026). */
  year: number;
  /** 1-based position in the year: month 1–12, quarter 1–4, or 1. */
  index: number;
}

export const DEFAULT_DUE_DAY = 15;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** Days in month m (1–12) of year y. */
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Adds `n` months to (y, m), 1-based month. */
const addMonths = (y: number, m: number, n: number): [number, number] => {
  const t = y * 12 + (m - 1) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
};
const parts = (date: string): [number, number, number] => {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
};

const MONTHS_PER: Record<KpiFrequency, number> = { monthly: 1, quarterly: 3, annual: 12 };

/** The first month of a reporting year: [calendar year, month]. */
const yearStart = (yearType: YearType, year: number): [number, number] => (yearType === "FY" ? [year - 1, FY_START_MONTH] : [year, 1]);

const fyLabel = (year: number) => `FY${year - 1}-${pad(year % 100)}`;

export function periodsFor(frequency: KpiFrequency, yearType: YearType, year: number): KpiPeriod[] {
  const step = MONTHS_PER[frequency];
  const [y0, m0] = yearStart(yearType, year);
  const out: KpiPeriod[] = [];
  for (let i = 0; i < 12 / step; i++) {
    const [sy, sm] = addMonths(y0, m0, i * step);
    const [ey, em] = addMonths(y0, m0, i * step + step - 1);
    const label =
      frequency === "monthly"
        ? `${MONTHS[sm - 1]} ${sy}`
        : frequency === "quarterly"
          ? `Q${i + 1} ${yearType === "FY" ? fyLabel(year) : year}`
          : yearType === "FY"
            ? fyLabel(year)
            : String(year);
    out.push({ start: iso(sy, sm, 1), end: iso(ey, em, daysIn(ey, em)), label, frequency, year_type: yearType, year, index: i + 1 });
  }
  return out;
}

/** The reporting year a date belongs to. */
export const reportingYearOf = (date: string, yearType: YearType): number => {
  const [y, m] = parts(date);
  return yearType === "FY" && m >= FY_START_MONTH ? y + 1 : y;
};

export const periodOf = (date: string, frequency: KpiFrequency, yearType: YearType): KpiPeriod => {
  const periods = periodsFor(frequency, yearType, reportingYearOf(date, yearType));
  return periods.find((p) => p.start <= date && date <= p.end)!;
};

export const isPeriodStart = (date: string, frequency: KpiFrequency, yearType: YearType): boolean => periodOf(date, frequency, yearType).start === date;

/** First and last day of a reporting year. */
export const yearRange = (yearType: YearType, year: number): { start: string; end: string } => {
  const all = periodsFor("annual", yearType, year);
  return { start: all[0].start, end: all[0].end };
};

/** First and last day of a calendar month. */
export const monthRange = (year: number, month: number): { start: string; end: string } => ({ start: iso(year, month, 1), end: iso(year, month, daysIn(year, month)) });

/** Values for a period are due on `dueDay` of the month after it ends (clamped to that month's length). */
export const dueDate = (period: { end: string }, dueDay = DEFAULT_DUE_DAY): string => {
  const [y, m] = parts(period.end);
  const [ny, nm] = addMonths(y, m, 1);
  return iso(ny, nm, Math.min(Math.max(1, dueDay), daysIn(ny, nm)));
};

/** Whether two inclusive date ranges overlap. */
export const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start <= b.end && b.start <= a.end;
