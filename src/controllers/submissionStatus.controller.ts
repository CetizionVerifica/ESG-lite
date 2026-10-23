import { Response } from "express";
import { Brackets } from "typeorm";
import { AuthRequest } from "../middlewares/auth.middleware";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { UserRole } from "../types/type";
import { overseenSites } from "../utils/companyScope";

/**
 * GET /manager/submission-status?month=2026-03
 * Returns submission status for all users the manager oversees.
 *
 * A User counts as submitted when they filed for one of the caller's sites that month: entries at
 * other sites (another plant, another client) don't count, and an automatic FERA twin isn't an
 * entry of its own. Each User is listed with the caller's sites they work on, never other sites.
 */
export const getSubmissionStatus = async (req: AuthRequest, res: Response) => {
  try {
    const managerId = req.user?.userId;
    if (!managerId) return res.status(401).json({ message: "Unauthorized" });

    const monthParam = req.query.month as string; // "YYYY-MM"
    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return res.status(400).json({ message: "month query param required in YYYY-MM format" });
    }

    const [yearStr, monthStr] = monthParam.split("-");
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);
    // Calendar dates, independent of the server's time zone.
    const startDate = `${monthParam}-01`;
    const endDate = `${monthParam}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;

    // The manager's sites, or a company Admin's company sites (M5).
    const overseen = await overseenSites(managerId, req.user?.role);
    if (!overseen) return res.status(404).json({ message: "Manager not found" });
    const siteIds = [...overseen.keys()].sort((a, b) => a - b);

    if (siteIds.length === 0) {
      return res.json({ users: [] });
    }

    // The Users of these sites, through either site field.
    const users = await AppDataSource.getRepository(User)
      .createQueryBuilder("user")
      .leftJoinAndSelect("user.site", "site")
      .leftJoinAndSelect("user.sites", "msite")
      .where("user.role = :role", { role: UserRole.USER })
      .andWhere(
        new Brackets((qb) => {
          qb.where("site.site_id IN (:...siteIds)", { siteIds }).orWhere("msite.site_id IN (:...siteIds)", { siteIds });
        })
      )
      .getMany();

    // What each of them filed for these sites in the month, in one query.
    const counts = new Map<number, number>();
    if (users.length) {
      const rows: { created_by: number; n: number }[] = await AppDataSource.query(
        `SELECT e.created_by, COUNT(*)::int AS n
           FROM emission e
           JOIN category c ON c.category_id = e.category_id
          WHERE e.created_by = ANY($1) AND e.site_id = ANY($2)
            -- S3-15 part 2: a Draft isn't submitted yet.
            AND e.status::text <> 'draft'
            AND e.date_of_reporting >= $3 AND e.date_of_reporting <= $4
            AND NOT (LOWER(c.category_name) = 'fera' AND e.fera_linked_id IS NOT NULL)
          GROUP BY e.created_by`,
        [users.map((u) => u.user_id), siteIds, startDate, endDate]
      );
      rows.forEach((r) => counts.set(Number(r.created_by), Number(r.n)));
    }

    const result: {
      user_id: number;
      name: string;
      email: string;
      site_name: string;
      submission_count: number;
      status: "submitted" | "missing";
    }[] = [];

    for (const user of users) {
      // Their sites that the caller oversees, once each, in the caller's site order.
      const theirs = new Set<number>();
      if (user.site) theirs.add(user.site.site_id);
      (user.sites || []).forEach((s) => theirs.add(s.site_id));
      const siteNames = siteIds.filter((id) => theirs.has(id)).map((id) => overseen.get(id));

      const count = counts.get(user.user_id) ?? 0;
      result.push({
        user_id: user.user_id,
        name: `${user.name || ""} ${user.last_name || ""}`.trim() || user.email,
        email: user.email,
        site_name: siteNames.join(", ") || "N/A",
        submission_count: count,
        status: count > 0 ? "submitted" : "missing",
      });
    }

    // Sort: missing first, then by name
    result.sort((a, b) => {
      if (a.status !== b.status) return a.status === "missing" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return res.json({ users: result, month: monthParam });
  } catch (error) {
    console.error("Submission status error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
