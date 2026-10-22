import { Response } from "express";
import { overseenSites } from "../utils/companyScope";
import { AuthRequest } from "../middlewares/auth.middleware";
import { CATEGORY_IDS_ERROR, hasInvalidCategoryIds, parseCategoryIds } from "../utils/parseCategoryIds";
import { parseSiteIds } from "../utils/parseSiteIds";
import { computeManagerOverview, parseOverviewPeriod } from "../services/managerOverview.service";

// IN-1: the computation lives in src/services/managerOverview.service.ts (moved, unchanged).
export { parseOverviewPeriod, lastYearPeriod, lastYearComparison } from "../services/managerOverview.service";
export type { OverviewPeriod, LastYearStatus } from "../services/managerOverview.service";

/**
 * GET /manager/overview?period=&siteIds=&categoryIds= (or the older categoryId=)
 *
 * Server-side version of what pages/ManagerDashboard aggregates in the
 * browser, using the same rules:
 *  - figures use approved entries only; counts cover every status;
 *  - "Scope 1/2/3" make up gross, a null scope (e.g. Renewable Electricity)
 *    is saved, net = gross - saved;
 *  - yearly batches count in the KPIs, by_scope, by_site and by_category only
 *    for a whole year of the same type (or all time); yearly_total holds every
 *    approved yearly batch whose year overlaps the period;
 *  - the monthly series leaves out yearly batches;
 *  - tCO2e figures are rounded to 3 decimals;
 *  - by_category leaves out null-scope categories;
 *  - trend: monthly gross/saved/net, 12 months for CY/FY, else the 6 months
 *    ending with the period's last month (yearly batches left out; P06's
 *    "Yearly filing" bar uses yearly_total);
 *  - last_year: the same period a year earlier, cut to the same due months
 *    while the period is running (status complete / year_to_date / not_due),
 *    with kpis.net_vs_last_year_pct and by_site[].net_vs_last_year_pct
 *    (null when last year's net is 0 or nothing is due yet).
 * siteIds defaults to every site the manager manages; any other site is 403.
 */
export const getManagerOverview = async (req: AuthRequest, res: Response) => {
  try {
    const managerId = req.user?.userId;
    if (!managerId) return res.status(401).json({ message: "Unauthorized" });

    const period = parseOverviewPeriod(req.query.period);
    if (!period) {
      return res.status(400).json({ message: "period must be YYYY, YYYY-MM, YYYY-Qn or FYYYYY-YY (e.g. FY2025-26)" });
    }
    // categoryIds=1,2 (several) or the older categoryId=1.
    const categoryQuery = req.query as { categoryIds?: unknown; categoryId?: unknown };
    if (hasInvalidCategoryIds(categoryQuery)) {
      return res.status(400).json({ message: CATEGORY_IDS_ERROR });
    }
    const categoryIds = parseCategoryIds(categoryQuery);

    // A Manager's sites, or a company Admin's company sites (M5).
    const managed = await overseenSites(managerId, req.user?.role);
    if (!managed) return res.status(404).json({ message: "Manager not found" });

    const requested = parseSiteIds(req.query as { siteIds?: unknown; siteId?: unknown });
    if (requested.some((id) => !managed.has(id))) {
      return res.status(403).json({ message: "You do not manage one or more of the requested sites" });
    }
    const siteIds = (requested.length ? requested : [...managed.keys()]).sort((a, b) => a - b);

    return res.json(await computeManagerOverview({ period, siteIds, managed, categoryIds }));
  } catch (error) {
    console.error("Manager overview error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
