import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Emission } from "../entities/Emission";
import { UserRole } from "../types/type";

/**
 * GET /manager/submission-status?month=2026-03
 * Returns submission status for all users the manager oversees.
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
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // last day

    const userRepo = AppDataSource.getRepository(User);
    const emissionRepo = AppDataSource.getRepository(Emission);

    // Get manager's sites
    const manager = await userRepo.findOne({
      where: { user_id: managerId },
      relations: ["sites", "site"],
    });
    if (!manager) return res.status(404).json({ message: "Manager not found" });

    const managerSiteIds = new Set<number>();
    if (manager.site) managerSiteIds.add((manager.site as any).site_id);
    if (manager.sites) manager.sites.forEach((s: any) => managerSiteIds.add(s.site_id));

    if (managerSiteIds.size === 0) {
      return res.json({ users: [] });
    }

    // Get all users under these sites
    const users = await userRepo.find({
      where: { role: UserRole.USER },
      relations: ["site", "sites"],
    });

    const result: {
      user_id: number;
      name: string;
      email: string;
      site_name: string;
      submission_count: number;
      status: "submitted" | "missing";
    }[] = [];

    for (const user of users) {
      // Check if user belongs to any of manager's sites
      const userSiteIds: number[] = [];
      if (user.site) userSiteIds.push((user.site as any).site_id);
      if (user.sites) user.sites.forEach((s: any) => userSiteIds.push(s.site_id));

      const matchingSites = userSiteIds.filter((id) => managerSiteIds.has(id));
      if (matchingSites.length === 0) continue;

      // Count emissions for this user in the target month
      const count = await emissionRepo
        .createQueryBuilder("e")
        .where("e.created_by = :userId", { userId: user.user_id })
        .andWhere("e.date_of_reporting >= :startDate", { startDate: startDate.toISOString().split("T")[0] })
        .andWhere("e.date_of_reporting <= :endDate", { endDate: endDate.toISOString().split("T")[0] })
        .getCount();

      // Get the site name for display
      const primarySite = user.site || (user.sites && user.sites[0]);
      const siteName = (primarySite as any)?.name || "N/A";

      result.push({
        user_id: user.user_id,
        name: `${user.name || ""} ${user.last_name || ""}`.trim() || user.email,
        email: user.email,
        site_name: siteName,
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
