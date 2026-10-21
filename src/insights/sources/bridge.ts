/**
 * IN-5 · what the bridge needs beyond the IN-1 sources: the first reporting year
 * with an approved emission row on the scope's sites (the `compare=base`
 * fallback when no SBTi base year is set). One aggregate query, company-scoped.
 */
import { AppDataSource } from "../../config/data-source";
import { once, type InsightsScope } from "../scope";

/** The reporting year of a date: CY its year; FY the year its April–March year ends in. */
export const reportingYear = (iso: string, yearType: "CY" | "FY"): number => {
  const y = Number(iso.slice(0, 4));
  return yearType === "FY" && Number(iso.slice(5, 7)) >= 4 ? y + 1 : y;
};

export const firstApprovedYear = (scope: InsightsScope): Promise<number | null> =>
  once(scope, "first-approved-year", async () => {
    if (!scope.siteIds.length) return null;
    const [row] = await AppDataSource.query(
      `SELECT to_char(MIN(e.date_of_reporting), 'YYYY-MM-DD') AS first FROM emission e JOIN site s ON s.site_id = e.site_id
        WHERE s.company_id = $1 AND e.site_id = ANY($2::int[]) AND e.status = 'approved'`,
      [scope.companyId, scope.siteIds],
    );
    return row?.first ? reportingYear(String(row.first), scope.period.yearType) : null;
  });
