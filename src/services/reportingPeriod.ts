import { Repository } from "typeorm";
import { Emission } from "../entities/Emission";

/**
 * Yearly data entry (see docs: "Yearly Data Entry" spec).
 *
 * Rules agreed with product:
 *  - Only spend-based categories may be entered yearly.
 *  - A year supports two calendars: CY (Jan-Dec) and FY (Indian financial
 *    year, Apr-Mar).
 *  - Mode lock: within one site + category + year, data is either all
 *    monthly or all yearly. Mixing the two would double count (a yearly
 *    batch already contains the months), so conflicting saves are rejected.
 */

// Spend-based categories: Purchased Goods and Services (3), Capital Goods (12).
// These are the only forms with a "Spent Value" column.
export const YEARLY_ALLOWED_CATEGORY_IDS = new Set([3, 12]);

export type ReportingPeriod = "monthly" | "yearly";
export type YearType = "CY" | "FY";

/** Period window for a yearly row, derived from its year_type + end date. */
export const periodWindow = (
    yearType: YearType,
    periodEnd: Date,
): { start: string; end: string } => {
    const y = periodEnd.getUTCFullYear();
    if (yearType === "CY") {
        return { start: `${y}-01-01`, end: `${y}-12-31` };
    }
    // FY ending Mar 31 of year y covers Apr 1 (y-1) .. Mar 31 (y)
    return { start: `${y - 1}-04-01`, end: `${y}-03-31` };
};

/** A yearly row's date_of_reporting must be its period-end date. */
export const isValidPeriodEnd = (yearType: YearType, d: Date): boolean => {
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    return yearType === "CY" ? month === 12 && day === 31 : month === 3 && day === 31;
};

export interface ModeLockConflict {
    conflicting_period: ReportingPeriod;
    conflicting_rows: number;
    window: { start: string; end: string };
    // Set when a yearly save is blocked by an overlapping yearly batch of the
    // other calendar (CY vs FY): their windows share up to nine months, so
    // both existing would double count the overlap.
    conflicting_year_type?: YearType;
}

/**
 * Returns a conflict if saving `period` data would mix modes within a year
 * for this site + category, else null. Yearly-with-yearly is allowed (one
 * annual batch is many rows); only monthly<->yearly mixing is blocked.
 */
export const findModeLockConflict = async (
    repo: Repository<Emission>,
    args: {
        site_id: number;
        category_id: number;
        reporting_period: ReportingPeriod;
        year_type?: YearType | null;
        date_of_reporting: Date;
        exclude_pk_id?: number;
    },
): Promise<ModeLockConflict | null> => {
    const { site_id, category_id, reporting_period, year_type, date_of_reporting, exclude_pk_id } = args;

    if (reporting_period === "yearly") {
        // Block if any monthly rows fall inside the yearly window.
        const window = periodWindow(year_type as YearType, date_of_reporting);
        const qb = repo
            .createQueryBuilder("e")
            .where("e.site_id = :site_id", { site_id })
            .andWhere("e.category_id = :category_id", { category_id })
            .andWhere("e.reporting_period = 'monthly'")
            .andWhere("e.date_of_reporting BETWEEN :start AND :end", window);
        if (exclude_pk_id) qb.andWhere("e.pk_id != :pk", { pk: exclude_pk_id });
        const monthlyRows = await qb.getCount();
        if (monthlyRows > 0) {
            return { conflicting_period: "monthly", conflicting_rows: monthlyRows, window };
        }

        // Block yearly batches of the OTHER calendar whose windows overlap
        // this one. A CY year overlaps each adjacent FY by up to nine months
        // (e.g. CY 2025 vs FY 2025-26 share Apr-Dec 2025), so letting both
        // exist double counts the overlap. Same-calendar rows are fine: same
        // year is one batch, different years never overlap.
        const otherType: YearType = year_type === "CY" ? "FY" : "CY";
        const overlapQb = repo
            .createQueryBuilder("e")
            .where("e.site_id = :site_id", { site_id })
            .andWhere("e.category_id = :category_id", { category_id })
            .andWhere("e.reporting_period = 'yearly'")
            .andWhere("e.year_type = :otherType", { otherType })
            // A yearly row's window is derived from its own type: CY runs
            // Jan 1..Dec 31 of its year; FY runs Apr 1 (prev yr)..Mar 31.
            // Overlap with [start, end]: theirStart <= end AND theirEnd >= start.
            .andWhere(
                `((e.year_type = 'CY' AND date_trunc('year', e.date_of_reporting) <= CAST(:end AS date) AND e.date_of_reporting >= CAST(:start AS date))
                  OR (e.year_type = 'FY' AND (e.date_of_reporting - INTERVAL '1 year' + INTERVAL '1 day') <= CAST(:end AS date) AND e.date_of_reporting >= CAST(:start AS date)))`,
                window,
            );
        if (exclude_pk_id) overlapQb.andWhere("e.pk_id != :pk", { pk: exclude_pk_id });
        const overlapRows = await overlapQb.getCount();
        if (overlapRows > 0) {
            return {
                conflicting_period: "yearly",
                conflicting_rows: overlapRows,
                window,
                conflicting_year_type: otherType,
            };
        }
        return null;
    }

    // Saving monthly: block if a yearly row's window contains this date.
    // CY window ends Dec 31 of its year; FY window ends Mar 31 and starts
    // Apr 1 of the previous year.
    const qb = repo
        .createQueryBuilder("e")
        .where("e.site_id = :site_id", { site_id })
        .andWhere("e.category_id = :category_id", { category_id })
        .andWhere("e.reporting_period = 'yearly'")
        .andWhere(
            `((e.year_type = 'CY' AND EXTRACT(YEAR FROM e.date_of_reporting) = EXTRACT(YEAR FROM CAST(:d AS date)))
              OR (e.year_type = 'FY' AND CAST(:d AS date) > e.date_of_reporting - INTERVAL '1 year'
                  AND CAST(:d AS date) <= e.date_of_reporting))`,
            { d: date_of_reporting.toISOString().slice(0, 10) },
        );
    if (exclude_pk_id) qb.andWhere("e.pk_id != :pk", { pk: exclude_pk_id });
    const conflicting = await qb
        .select(["e.year_type", "e.date_of_reporting"])
        .orderBy("e.pk_id", "ASC")
        .getMany();
    if (conflicting.length === 0) return null;

    // Report the covering batch's actual window so the client can say which
    // date range is locked.
    const sample = conflicting[0];
    const window = periodWindow(
        sample.year_type as YearType,
        new Date(sample.date_of_reporting),
    );
    return {
        conflicting_period: "yearly",
        conflicting_rows: conflicting.length,
        window,
        conflicting_year_type: (sample.year_type as YearType) ?? undefined,
    };
};

/**
 * Validates the reporting-period fields of an incoming save. Returns an
 * error message (HTTP 400 material) or null if valid.
 */
export const validatePeriodFields = (args: {
    category_id: number;
    reporting_period?: string;
    year_type?: string | null;
    date_of_reporting: Date;
}): string | null => {
    const period = args.reporting_period ?? "monthly";
    if (period !== "monthly" && period !== "yearly") {
        return `Invalid reporting_period "${args.reporting_period}". Must be "monthly" or "yearly".`;
    }
    if (period === "monthly") {
        return null; // year_type is ignored for monthly rows
    }
    if (!YEARLY_ALLOWED_CATEGORY_IDS.has(args.category_id)) {
        return "Yearly entry is only available for spend-based categories (Purchased Goods and Services, Capital Goods).";
    }
    if (args.year_type !== "CY" && args.year_type !== "FY") {
        return `Yearly entries require year_type "CY" or "FY" (got ${args.year_type == null ? "none" : `"${args.year_type}"`}).`;
    }
    if (!isValidPeriodEnd(args.year_type, args.date_of_reporting)) {
        return args.year_type === "CY"
            ? "A CY yearly entry must be dated December 31 of its year."
            : "An FY yearly entry must be dated March 31 (the financial year end).";
    }
    return null;
};
