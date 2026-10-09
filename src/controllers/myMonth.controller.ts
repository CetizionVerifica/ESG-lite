import { Response } from "express";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Emission } from "../entities/Emission";
import { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../types/type";
import { periodWindow, yearlyCoversDateSql, YearType } from "../services/reportingPeriod";

type CategoryStatus = "todo" | "pending" | "approved" | "rejected" | "covered";

const pad = (n: number) => String(n).padStart(2, "0");

// Data for month M is due on the 10th of M+1 and escalated on the 15th
// (workers/deadlineScheduler.ts).
const deadlines = (year: number, month: number) => {
  const next = new Date(Date.UTC(year, month, 1));
  const ym = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`;
  return { due_date: `${ym}-10`, escalation_date: `${ym}-15` };
};

const previousMonth = (): string => {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}`;
};

/**
 * GET /user/my-month?month=YYYY-MM  (default: the previous month, the one
 * currently due)
 *
 * For the signed-in contributor: every category they owe for the month, per
 * site, with its status:
 *   todo      nothing filed yet
 *   pending   filed, waiting for approval
 *   approved  filed and approved
 *   rejected  at least one entry was sent back (always wins: it needs action)
 *   covered   no monthly data needed: a yearly batch covers this month and
 *             its period ends in another month
 * Categories are the site's categories narrowed by the user's grants (an empty
 * grant list means all), without FERA (FERA rows are generated from their
 * parent entry). Entries count per site + category, whoever filed them.
 * Yearly batches count as entries only in their period-end month.
 */
export const getMyMonth = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (req.user?.role !== UserRole.USER && req.user?.role !== UserRole.MANAGER) {
      return res.status(403).json({ message: "Only contributors have a monthly checklist" });
    }

    const monthParam = (req.query.month as string | undefined) ?? previousMonth();
    const match = /^(\d{4})-(\d{2})$/.exec(monthParam);
    const monthNum = match ? parseInt(match[2], 10) : 0;
    if (!match || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ message: "month must be YYYY-MM" });
    }
    const year = parseInt(match[1], 10);
    const monthStart = `${year}-${pad(monthNum)}-01`;
    const monthEnd = `${year}-${pad(monthNum)}-${pad(new Date(Date.UTC(year, monthNum, 0)).getUTCDate())}`;

    const user = await AppDataSource.getRepository(User).findOne({
      where: { user_id: userId },
      relations: ["site", "site.categories", "sites", "sites.categories", "categories"],
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    const granted = new Set((user.categories || []).map((c) => c.category_id));
    const sites = [user.site, ...(user.sites || [])]
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .filter((s, i, all) => all.findIndex((o) => o.site_id === s.site_id) === i)
      .sort((a, b) => a.site_id - b.site_id);

    const siteCategories = sites.map((site) => ({
      site,
      categories: (site.categories || [])
        .filter((c) => c.category_name?.toLowerCase() !== "fera")
        .filter((c) => granted.size === 0 || granted.has(c.category_id))
        .sort((a, b) => (a.scope ?? "~").localeCompare(b.scope ?? "~") || a.category_name.localeCompare(b.category_name)),
    }));

    const siteIds = sites.map((s) => s.site_id);
    const categoryIds = [...new Set(siteCategories.flatMap((s) => s.categories.map((c) => c.category_id)))];

    const rows =
      siteIds.length && categoryIds.length
        ? await AppDataSource.getRepository(Emission)
            .createQueryBuilder("e")
            .leftJoin("e.reviewed_by", "rb")
            .select([
              "e.pk_id AS pk_id",
              "e.site_id AS site_id",
              "e.category_id AS category_id",
              "e.status AS status",
              "e.total_emission AS total_emission",
              "e.reporting_period AS reporting_period",
              "e.year_type AS year_type",
              "to_char(e.date_of_reporting, 'YYYY-MM-DD') AS date_of_reporting",
              "e.created_at AS created_at",
              "e.review_comment AS review_comment",
              "e.reviewed_at AS reviewed_at",
              "rb.name AS reviewed_by_name",
            ])
            .where("e.site_id IN (:...siteIds)", { siteIds })
            .andWhere("e.category_id IN (:...categoryIds)", { categoryIds })
            .andWhere(
              `((e.reporting_period <> 'yearly' AND e.date_of_reporting BETWEEN :monthStart AND :monthEnd)
                OR ${yearlyCoversDateSql("e")})`,
              { monthStart, monthEnd, coveredDate: monthStart },
            )
            .orderBy("e.pk_id", "ASC")
            .getRawMany()
        : [];

    const summary = { total: 0, due: 0, done: 0, pending: 0, rejected: 0 };

    const result = siteCategories.map(({ site, categories }) => ({
      site_id: site.site_id,
      name: site.name,
      categories: categories.map((category) => {
        const mine = rows.filter((r) => r.site_id === site.site_id && r.category_id === category.category_id);
        const monthly = mine.filter((r) => r.reporting_period !== "yearly");
        const yearly = mine.filter((r) => r.reporting_period === "yearly");
        // A yearly batch is "this month's" data only in its period-end month.
        const yearlyDueNow = yearly.filter((r) => r.date_of_reporting >= monthStart && r.date_of_reporting <= monthEnd);
        const entries = monthly.length ? monthly : yearlyDueNow;

        const counts = {
          total: entries.length,
          pending: entries.filter((r) => r.status === "pending").length,
          approved: entries.filter((r) => r.status === "approved").length,
          rejected: entries.filter((r) => r.status === "rejected").length,
        };

        let status: CategoryStatus;
        if (counts.rejected) status = "rejected";
        else if (counts.pending) status = "pending";
        else if (counts.approved) status = "approved";
        else if (!monthly.length && yearly.length) status = "covered";
        else status = "todo";

        const yearlyRow = !monthly.length ? yearly[0] : undefined;
        const filing = monthly.length ? "monthly" : yearly.length ? "yearly" : null;

        summary.total++;
        if (status === "todo") summary.due++;
        else if (status === "approved" || status === "covered") summary.done++;
        else if (status === "pending") summary.pending++;
        else summary.rejected++;

        return {
          category_id: category.category_id,
          category_name: category.category_name,
          scope: category.scope,
          status,
          filing,
          year_type: yearlyRow ? (yearlyRow.year_type as YearType) : null,
          period: yearlyRow
            ? periodWindow(yearlyRow.year_type as YearType, new Date(`${yearlyRow.date_of_reporting}T00:00:00Z`))
            : null,
          entries: counts,
          // tCO2e of entries that still count (pending + approved)
          total_emission: entries
            .filter((r) => r.status !== "rejected")
            .reduce((sum, r) => sum + Number(r.total_emission || 0), 0),
          last_entry_at: entries.length
            ? entries.map((r) => new Date(r.created_at).toISOString()).sort().pop()
            : null,
          rejections: entries
            .filter((r) => r.status === "rejected")
            .map((r) => ({
              pk_id: r.pk_id,
              review_comment: r.review_comment,
              reviewed_by: r.reviewed_by_name,
              reviewed_at: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
            })),
        };
      }),
    }));

    return res.json({ month: monthParam, ...deadlines(year, monthNum), summary, sites: result });
  } catch (error) {
    console.error("My month error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
