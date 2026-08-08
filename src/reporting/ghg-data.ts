// Reusable GHG report computation, extracted verbatim from the
// getGhgReportTables / getGhgReportDetails Express controllers so that BOTH the
// on-screen tables (POST /user/ghg/tables, /user/ghg/details) AND the branded
// server-side PDF (GET /reports/ghg) compute from the SAME source — the
// `Emission` entity, filtered by status=APPROVED, site, category and date range.
// The controllers call these functions and res.json() the result unchanged.
import { AppDataSource } from "../config/data-source";
import { Emission, EmissionStatus } from "../entities/Emission";

export type YearType = "CY" | "FY";
export type Frequency = "monthly" | "quarterly" | "yearly";

export interface GhgFilters {
  siteIds: number[];
  categoryIds?: number[];
  yearType: YearType;
  year: number;
  compareYear?: number;
  /**
   * Narrows the WHOLE report to a single period inside the reporting year.
   * Defaults to "yearly" (the entire reporting year) when absent.
   */
  frequency?: Frequency;
  /** Calendar month 1–12. Required when frequency === "monthly". */
  month?: number;
  /** Quarter 1–4, counted from the START of the reporting year. Required when frequency === "quarterly". */
  quarter?: number;
}

/**
 * The month the financial year starts in (4 = April, so FY runs Apr → Mar).
 * This is the SINGLE definition for the whole system: the fiscal-year rule text
 * and the `fiscalYearStartMonth` returned to clients are both derived from it,
 * and the frontend reads that value from the API instead of keeping its own
 * copy — so the UI and the backend can never disagree.
 */
export const FY_START_MONTH = 4;

export function getDateRange(yearType: YearType, year: number) {
  if (yearType === "CY") {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59, 999);
    return { startDate, endDate };
  }
  const startMonthIndex = FY_START_MONTH - 1;
  const startDate = new Date(year - 1, startMonthIndex, 1);
  const endDate = new Date(year, startMonthIndex, 1);
  endDate.setMilliseconds(endDate.getMilliseconds() - 1);

  return { startDate, endDate };
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Month the FY ends in — the month before it starts (1-12). */
const FY_END_MONTH = ((FY_START_MONTH + 10) % 12) + 1;
/** Last day of the FY end month (2001 is non-leap, so Feb resolves to 28). */
const FY_END_DAY = new Date(2001, FY_END_MONTH, 0).getDate();

/** Human-readable FY rule, derived from FY_START_MONTH so it can never drift. */
export const FISCAL_YEAR_RULE =
  `${MONTH_SHORT[FY_START_MONTH - 1]} 1 → ${MONTH_SHORT[FY_END_MONTH - 1]} ${FY_END_DAY}`;

const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The 12 calendar months of a reporting year, in reporting-calendar order.
 * CY 2025 → Jan 2025 … Dec 2025.
 * FY 2025 → Apr 2024 … Dec 2024, then Jan 2025 … Mar 2025 (FY straddles two
 * calendar years, so each month carries its OWN calendar year).
 */
function reportingMonths(yearType: YearType, year: number): { calYear: number; monthNum: number }[] {
  const months: { calYear: number; monthNum: number }[] = [];
  if (yearType === "FY") {
    for (let mn = FY_START_MONTH; mn <= 12; mn++) months.push({ calYear: year - 1, monthNum: mn });
    for (let mn = 1; mn < FY_START_MONTH; mn++) months.push({ calYear: year, monthNum: mn });
  } else {
    for (let mn = 1; mn <= 12; mn++) months.push({ calYear: year, monthNum: mn });
  }
  return months;
}

/** Calendar year a given calendar month (1–12) belongs to inside the reporting year. */
function calendarYearOfMonth(yearType: YearType, year: number, month: number): number {
  if (yearType === "CY") return year;
  return month >= FY_START_MONTH ? year - 1 : year;
}

const startOfMonth = (calYear: number, monthNum: number) => new Date(calYear, monthNum - 1, 1);

const endOfMonth = (calYear: number, monthNum: number) => {
  const d = new Date(calYear, monthNum, 1);
  d.setMilliseconds(d.getMilliseconds() - 1);
  return d;
};

export interface PeriodRange {
  startDate: Date;
  endDate: Date;
  label: string;
}

/**
 * Resolve the date range the ENTIRE report covers. Frequency is a narrowing
 * filter (like site/category), not a breakdown:
 *   yearly    → the whole reporting year                   ("FY2025")
 *   monthly   → one calendar month of that year            ("June 2024")
 *   quarterly → 3 consecutive months of that year          ("Q2 FY2025 (Jul–Sep 2024)")
 *
 * For FY the reporting year runs Apr → Mar, so months 4–12 resolve to
 * calendar year `year - 1` and months 1–3 to `year`. Quarters are positional
 * within that order (FY Q1 = Apr–Jun, Q4 = Jan–Mar).
 *
 * Falls back to the whole year when the required month/quarter is missing, so a
 * malformed request can never produce an empty/invalid range.
 */
export function getPeriodRange(
  yearType: YearType,
  year: number,
  frequency: Frequency = "yearly",
  month?: number,
  quarter?: number,
): PeriodRange {
  if (frequency === "monthly" && month && month >= 1 && month <= 12) {
    const calYear = calendarYearOfMonth(yearType, year, month);
    return {
      startDate: startOfMonth(calYear, month),
      endDate: endOfMonth(calYear, month),
      label: `${MONTH_LONG[month - 1]} ${calYear}`,
    };
  }

  if (frequency === "quarterly" && quarter && quarter >= 1 && quarter <= 4) {
    const months = reportingMonths(yearType, year);
    const slice = months.slice((quarter - 1) * 3, (quarter - 1) * 3 + 3);
    const first = slice[0];
    const last = slice[slice.length - 1];
    const span = first.calYear === last.calYear
      ? `${MONTH_SHORT[first.monthNum - 1]}–${MONTH_SHORT[last.monthNum - 1]} ${last.calYear}`
      : `${MONTH_SHORT[first.monthNum - 1]} ${first.calYear}–${MONTH_SHORT[last.monthNum - 1]} ${last.calYear}`;
    return {
      startDate: startOfMonth(first.calYear, first.monthNum),
      endDate: endOfMonth(last.calYear, last.monthNum),
      label: `Q${quarter} ${yearType}${year} (${span})`,
    };
  }

  return { ...getDateRange(yearType, year), label: `${yearType}${year}` };
}

export function pct(n: number, d: number, dp = 2) {
  if (!d) return 0;
  return Number(((n / d) * 100).toFixed(dp));
}

export async function computeGhgTables(filters: GhgFilters) {
  const { siteIds, categoryIds, yearType, year, compareYear, month, quarter } = filters;
  const frequency: Frequency = filters.frequency ?? "yearly";

  const selectedYear = year;
  const compYear = compareYear ?? year - 1;

  // The comparison range is the SAME period one year earlier (June 2025 vs June
  // 2024, Q2 vs prior-year Q2) so the YoY columns stay like-for-like.
  const rangeComp = getPeriodRange(yearType, compYear, frequency, month, quarter);
  const rangeSelected = getPeriodRange(yearType, selectedYear, frequency, month, quarter);

  const repo = AppDataSource.getRepository(Emission);

  const baseQB = (range: { startDate: Date; endDate: Date }) => {
    const qb = repo
      .createQueryBuilder("emission")
      .leftJoin("emission.site", "site")
      .leftJoin("emission.category", "category")
      .where("emission.status = :status", { status: EmissionStatus.APPROVED })
      .andWhere("site.site_id IN (:...siteIds)", { siteIds })
      .andWhere("emission.date_of_reporting >= :startDate", { startDate: range.startDate })
      .andWhere("emission.date_of_reporting <= :endDate", { endDate: range.endDate });

    if (categoryIds && categoryIds.length > 0) {
      qb.andWhere("category.category_id IN (:...categoryIds)", { categoryIds });
    }

    return qb;
  };

  const sumByScope = async (range: { startDate: Date; endDate: Date }) => {
    const raw = await baseQB(range)
      .select([
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 1' THEN emission.total_emission ELSE 0 END), 0) AS "scope1"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 2' THEN emission.total_emission ELSE 0 END), 0) AS "scope2"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 3' THEN emission.total_emission ELSE 0 END), 0) AS "scope3"`,
      ])
      .getRawOne();

    const scope1 = Number(raw.scope1) || 0;
    const scope2 = Number(raw.scope2) || 0;
    const scope3 = Number(raw.scope3) || 0;
    const total = scope1 + scope2 + scope3;

    return { scope1, scope2, scope3, total };
  };

  const totalsComp = await sumByScope(rangeComp);
  const totalsSelected = await sumByScope(rangeSelected);

  const table1 = [
    {
      scope: "Scope 1",
      values: {
        [String(compYear)]: {
          emissions: totalsComp.scope1,
          pctOfTotal: pct(totalsComp.scope1, totalsComp.total),
        },
        [String(selectedYear)]: {
          emissions: totalsSelected.scope1,
          pctOfTotal: pct(totalsSelected.scope1, totalsSelected.total),
        },
      },
    },
    {
      scope: "Scope 2",
      values: {
        [String(compYear)]: {
          emissions: totalsComp.scope2,
          pctOfTotal: pct(totalsComp.scope2, totalsComp.total),
        },
        [String(selectedYear)]: {
          emissions: totalsSelected.scope2,
          pctOfTotal: pct(totalsSelected.scope2, totalsSelected.total),
        },
      },
    },
    {
      scope: "Scope 3",
      values: {
        [String(compYear)]: {
          emissions: totalsComp.scope3,
          pctOfTotal: pct(totalsComp.scope3, totalsComp.total),
        },
        [String(selectedYear)]: {
          emissions: totalsSelected.scope3,
          pctOfTotal: pct(totalsSelected.scope3, totalsSelected.total),
        },
      },
    },
    {
      scope: "Total Emissions (Scope 1, 2 and 3)",
      values: {
        [String(compYear)]: { emissions: totalsComp.total, pctOfTotal: 100 },
        [String(selectedYear)]: { emissions: totalsSelected.total, pctOfTotal: 100 },
      },
    },
  ];

  const overviewByLocations = async (range: { startDate: Date; endDate: Date }) => {
    const rows = await baseQB(range)
      .select([
        `category.scope AS "scope"`,
        `category.category_name AS "category"`,
        `site.site_id AS "siteId"`,
        `site.name AS "siteName"`,
        `COALESCE(SUM(emission.total_emission), 0) AS "value"`,
      ])
      .groupBy(`category.scope`)
      .addGroupBy(`category.category_name`)
      .addGroupBy(`site.site_id`)
      .addGroupBy(`site.name`)
      .orderBy(`category.scope`, "ASC")
      .addOrderBy(`category.category_name`, "ASC")
      .addOrderBy(`site.name`, "ASC")
      .getRawMany();

    const map = new Map<
      string,
      {
        scope: string;
        category: string;
        bySite: { siteId: number; siteName: string; value: number }[];
        total: number;
      }
    >();

    for (const r of rows) {
      const scope = String(r.scope || "");
      const category = String(r.category || "");
      const siteId = Number(r.siteId);
      const siteName = String(r.siteName || "");
      const value = Number(r.value) || 0;

      const k = `${scope}||${category}`;
      if (!map.has(k)) {
        map.set(k, { scope, category, bySite: [], total: 0 });
      }

      const item = map.get(k)!;
      item.bySite.push({ siteId, siteName, value: Number(value.toFixed(2)) });
      item.total += value;
    }

    return Array.from(map.values()).map((x) => ({
      scope: x.scope,
      category: x.category,
      bySite: x.bySite,
      total: Number(x.total.toFixed(2)),
    }));
  };

  const overviewComp = await overviewByLocations(rangeComp);
  const overviewSelected = await overviewByLocations(rangeSelected);

  return {
    filters: {
      siteIds,
      categoryIds: categoryIds?.length ? categoryIds : null,
      yearType,
      year: selectedYear,
      compareYear: compYear,
      fiscalYearRule: FISCAL_YEAR_RULE,
      fiscalYearStartMonth: FY_START_MONTH,
      frequency,
      month: frequency === "monthly" ? (month ?? null) : null,
      quarter: frequency === "quarterly" ? (quarter ?? null) : null,
      periodLabel: rangeSelected.label,
      comparePeriodLabel: rangeComp.label,
    },
    ranges: {
      [String(compYear)]: rangeComp,
      [String(selectedYear)]: rangeSelected,
    },
    totals: {
      [String(compYear)]: totalsComp,
      [String(selectedYear)]: totalsSelected,
    },
    tables: {
      table1_emissionsByScope_twoYears: table1,
      table_overviewByLocations_compareYear: {
        year: compYear,
        rows: overviewComp,
      },
      table_overviewByLocations_selectedYear: {
        year: selectedYear,
        rows: overviewSelected,
      },
    },
  };
}

type AggRow = {
  scope: string;
  categoryId: number;
  categoryName: string;
  siteId: number;
  siteName: string;
  fuelType: string;
  consumption: number;
  unit: string;
  emissions: number;
};

type YearBlock = { consumption: number; unit: string; emissions: number };

export async function computeGhgDetails(filters: GhgFilters) {
  const { siteIds, categoryIds, yearType, year, compareYear, month, quarter } = filters;
  const frequency: Frequency = filters.frequency ?? "yearly";

  const selectedYear = year;
  const compYear = compareYear ?? year - 1;

  // Same period, previous year — keeps the two consumption/emissions columns
  // comparable when the report is narrowed to a month or quarter.
  const rangeComp = getPeriodRange(yearType, compYear, frequency, month, quarter);
  const rangeSelected = getPeriodRange(yearType, selectedYear, frequency, month, quarter);

  const repo = AppDataSource.getRepository(Emission);

  const fuelExpr = `
      COALESCE(
        NULLIF(emission.activity_data->>'fuelType', ''),
        NULLIF(emission.activity_data->>'emission_category', ''),
        'Unknown'
      )
    `;

  const consumptionExpr = `
      COALESCE(
        NULLIF((emission.activity_data->>'Activity Data')::numeric, NULL),
        NULLIF((emission.activity_data->>'activity_value')::numeric, NULL),
        NULLIF((emission.activity_data->>'value')::numeric, NULL),
        NULLIF((emission.activity_data->>'quantity')::numeric, NULL),
        0
      )
    `;

  const unitExpr = `
  COALESCE(
    NULLIF(emission.activity_data_unit, ''),
    ''
  )
`;

  const buildAgg = async (range: { startDate: Date; endDate: Date }) => {
    const qb = repo
      .createQueryBuilder("emission")
      .leftJoin("emission.site", "site")
      .leftJoin("emission.category", "category")
      .where("emission.status = :status", { status: EmissionStatus.APPROVED })
      .andWhere("site.site_id IN (:...siteIds)", { siteIds })
      .andWhere("emission.date_of_reporting >= :startDate", { startDate: range.startDate })
      .andWhere("emission.date_of_reporting <= :endDate", { endDate: range.endDate });

    if (categoryIds && categoryIds.length > 0) {
      qb.andWhere("category.category_id IN (:...categoryIds)", { categoryIds });
    }
    const raw = await qb
      .select([
        `category.scope AS "scope"`,
        `category.category_id AS "categoryId"`,
        `category.category_name AS "categoryName"`,
        `site.site_id AS "siteId"`,
        `site.name AS "siteName"`,

        `${fuelExpr} AS "fuelType"`,
        `${unitExpr} AS "unit"`,

        `COALESCE(SUM(${consumptionExpr}), 0) AS "consumption"`,
        `COALESCE(SUM(emission.total_emission), 0) AS "emissions"`,
      ])
      .groupBy(`category.scope`)
      .addGroupBy(`category.category_id`)
      .addGroupBy(`category.category_name`)
      .addGroupBy(`site.site_id`)
      .addGroupBy(`site.name`)
      .addGroupBy(fuelExpr)
      .addGroupBy(unitExpr)
      .orderBy(`category.scope`, "ASC")
      .addOrderBy(`category.category_name`, "ASC")
      .addOrderBy(`site.name`, "ASC")
      .addOrderBy(`"fuelType"`, "ASC")
      .getRawMany();

    const rows: AggRow[] = raw.map((r: any) => ({
      scope: String(r.scope ?? ""),
      categoryId: Number(r.categoryId),
      categoryName: String(r.categoryName ?? ""),
      siteId: Number(r.siteId),
      siteName: String(r.siteName ?? ""),
      fuelType: String(r.fuelType ?? "Unknown"),
      unit: String(r.unit ?? ""),
      consumption: Number(r.consumption) || 0,
      emissions: Number(r.emissions) || 0,
    }));

    return rows;
  };

  const [compareRows, selectedRows] = await Promise.all([
    buildAgg(rangeComp),
    buildAgg(rangeSelected),
  ]);
  const keyOf = (r: AggRow) => `${r.scope}||${r.categoryId}||${r.fuelType}||${r.siteId}`;

  const map = new Map<
    string,
    {
      scope: string;
      categoryId: number;
      categoryName: string;
      fuelType: string;
      siteId: number;
      siteName: string;
      compare: YearBlock;
      selected: YearBlock;
    }
  >();

  const initYear = (): YearBlock => ({ consumption: 0, unit: "", emissions: 0 });

  for (const r of compareRows) {
    const k = keyOf(r);
    if (!map.has(k)) {
      map.set(k, {
        scope: r.scope,
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        fuelType: r.fuelType,
        siteId: r.siteId,
        siteName: r.siteName,
        compare: initYear(),
        selected: initYear(),
      });
    }
    const item = map.get(k)!;
    item.compare = {
      consumption: Number(r.consumption.toFixed(2)),
      unit: r.unit,
      emissions: Number(r.emissions.toFixed(2)),
    };
  }

  for (const r of selectedRows) {
    const k = keyOf(r);
    if (!map.has(k)) {
      map.set(k, {
        scope: r.scope,
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        fuelType: r.fuelType,
        siteId: r.siteId,
        siteName: r.siteName,
        compare: initYear(),
        selected: initYear(),
      });
    }
    const item = map.get(k)!;
    item.selected = {
      consumption: Number(r.consumption.toFixed(2)),
      unit: r.unit,
      emissions: Number(r.emissions.toFixed(2)),
    };
    if (!item.compare.unit) item.compare.unit = r.unit;
  }

  const rows = Array.from(map.values());

  return {
    filters: {
      siteIds,
      categoryIds: categoryIds?.length ? categoryIds : null,
      yearType,
      year: selectedYear,
      compareYear: compYear,
      fiscalYearRule: FISCAL_YEAR_RULE,
      fiscalYearStartMonth: FY_START_MONTH,
      frequency,
      month: frequency === "monthly" ? (month ?? null) : null,
      quarter: frequency === "quarterly" ? (quarter ?? null) : null,
      periodLabel: rangeSelected.label,
      comparePeriodLabel: rangeComp.label,
    },
    ranges: {
      [String(compYear)]: rangeComp,
      [String(selectedYear)]: rangeSelected,
    },
    rows,
  };
}

export type GhgTablesResult = Awaited<ReturnType<typeof computeGhgTables>>;
export type GhgDetailsResult = Awaited<ReturnType<typeof computeGhgDetails>>;
