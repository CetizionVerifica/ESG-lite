/**
 * Historical import (P27, Superadmin): the old year/month/equipment… sheet
 * format, checked row by row before anything is saved.
 *
 * `planHistoricalRows` is pure: it decides for every row whether it would be
 * imported (with its total) or skipped (with a reason), and lists the people
 * the sheet names. The controller runs it for the preview (dry run) and again
 * for the import, so both always agree.
 *
 * Totals come from the emission write service (S3-4, historicalEngine.ts):
 * the site's factor for the year, the unit check and the rounding a typed
 * entry gets. The sheet's own emissionFactor and calculatedEmission are kept
 * in activity_data as written but never used for the total (root rule).
 */

export interface HistoricalRow {
  year?: unknown;
  month?: unknown;
  equipment?: unknown;
  fuelState?: unknown;
  fuelType?: unknown;
  unit?: unknown;
  activity?: unknown;
  spend?: unknown;
  currency?: unknown;
  emissionFactor?: unknown;
  emissionFactorUnit?: unknown;
  calculatedEmission?: unknown;
  frequency?: unknown;
  source?: unknown;
  notes?: unknown;
  email?: unknown;
  name?: unknown;
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const text = (v: unknown) => (v == null ? "" : String(v).trim());

/** Month index 0–11 from "January", "jan" or 1–12; null when not recognised. */
export const monthIndex = (v: unknown): number | null => {
  const s = text(v).toLowerCase();
  if (!s) return null;
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= 12 ? n - 1 : null;
  }
  const i = MONTHS.findIndex((m) => m.toLowerCase() === s || m.toLowerCase().slice(0, 3) === s);
  return i === -1 ? null : i;
};

/** "2025-01" for a row, or null when the year or month is missing or not recognised. */
export const rowPeriod = (row: HistoricalRow): string | null => {
  const year = Number(text(row.year));
  const month = monthIndex(row.month);
  if (!Number.isInteger(year) || year < 1990 || year > 2100 || month === null) return null;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
};

/** The reporting date the old import used: the 15th of the month. */
export const periodDate = (period: string): Date => {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 15);
};

/** The engine's answer for one row (S3-4): its total, or why it can't be imported. */
export type EngineResult = { ok: true; total: number; warnings?: string[] } | { ok: false; reason: string };

export type FiledEntry = { date_of_reporting: Date | string; reporting_period?: string | null };

const monthKey = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}`;

/**
 * The months already reported for a site and category, each with why. A
 * monthly entry takes its month whatever its day; a yearly entry's date is
 * its period end and it covers that month and the eleven before it (CY or FY).
 */
export const filedMonths = (entries: FiledEntry[]): Map<string, string> => {
  const filed = new Map<string, string>();
  for (const e of entries) {
    const d = new Date(e.date_of_reporting);
    if (Number.isNaN(d.getTime())) continue;
    if (e.reporting_period === "yearly") {
      for (let i = 0; i < 12; i++) {
        const k = new Date(d.getFullYear(), d.getMonth() - i, 1);
        const key = monthKey(k.getFullYear(), k.getMonth());
        if (!filed.has(key)) filed.set(key, "A yearly entry for this site and category already covers this month.");
      }
    } else {
      filed.set(monthKey(d.getFullYear(), d.getMonth()), "This site already has an entry for this category and month.");
    }
  }
  return filed;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PlannedRow = {
  /** 1 = the first row under the header. */
  row: number;
  period: string | null;
  fuelType: string;
  activity: string;
  unit: string;
  total: number | null;
  /** Always "calculated" (by the engine) for a row that imports; the sheet's figure is never used. */
  totalFrom: "calculated" | null;
  status: "import" | "skip";
  reason: string | null;
  /** The engine's warnings for the row (an older factor year, no FERA factor). */
  warnings?: string[];
};

export type PlannedPerson = { email: string; name: string; exists: boolean };

export type HistoricalPlan = {
  rows: PlannedRow[];
  people: PlannedPerson[];
  /** Emails in the sheet that aren't valid addresses; no account is made for them. */
  invalidEmails: string[];
  toImport: number;
  toSkip: number;
};

/**
 * @param filed months ("2025-01") already reported for the chosen site and
 *   category, with the reason to show (see filedMonths): those rows are skipped.
 * @param existingEmails lower-case emails that already have an account.
 * @param engine the engine's answer per row number (1 = the first row under the
 *   header; historicalEngine.engineResults). A row it refuses is skipped with
 *   the engine's reason; only rows it accepts count for "one entry per month".
 */
export const planHistoricalRows = (
  rows: HistoricalRow[],
  filed: ReadonlyMap<string, string>,
  existingEmails: ReadonlySet<string>,
  engine: ReadonlyMap<number, EngineResult>,
): HistoricalPlan => {
  const firstRowFor = new Map<string, number>();
  const planned = rows.map((r, i): PlannedRow => {
    const row = i + 1;
    const period = rowPeriod(r);
    const base = {
      row,
      period,
      fuelType: text(r.fuelType),
      activity: text(r.activity),
      unit: text(r.unit),
      total: null,
      totalFrom: null,
    };
    const skip = (reason: string): PlannedRow => ({ ...base, status: "skip", reason });

    if (!period) return skip("Year or month is missing or not recognised.");
    const filedReason = filed.get(period);
    if (filedReason) return skip(filedReason);
    const result = engine.get(row);
    if (!result) return skip("Not checked against the site's emission factors.");
    if (!result.ok) return skip(result.reason);
    const first = firstRowFor.get(period);
    if (first !== undefined) return skip(`Same month as row ${first}; only one entry per month is kept.`);
    firstRowFor.set(period, row);
    return { ...base, total: result.total, totalFrom: "calculated", status: "import", reason: null, ...(result.warnings?.length ? { warnings: result.warnings } : {}) };
  });

  const people = new Map<string, PlannedPerson>();
  const invalid = new Set<string>();
  for (const r of rows) {
    const email = text(r.email).toLowerCase();
    if (!email) continue;
    if (!EMAIL.test(email)) {
      invalid.add(text(r.email));
      continue;
    }
    if (!people.has(email)) {
      people.set(email, { email, name: text(r.name) || email.split("@")[0], exists: existingEmails.has(email) });
    }
  }

  const toImport = planned.filter((p) => p.status === "import").length;
  return { rows: planned, people: [...people.values()], invalidEmails: [...invalid], toImport, toSkip: planned.length - toImport };
};

/** What the import stores in activity_data, kept in the old import's shape so existing pages read it. */
export const activityDataFor = (r: HistoricalRow) => ({
  emission_category: r.fuelType,
  "Activity Data": r.activity,
  activity_value: r.activity,
  equipment: r.equipment,
  fuelState: r.fuelState,
  fuelType: r.fuelType,
  activity: r.activity,
  emissionFactor: r.emissionFactor,
  emissionFactorUnit: r.emissionFactorUnit,
  source: r.source || "Unknown",
  frequency: r.frequency || "monthly",
  currency: r.currency,
  spend: r.spend,
});
