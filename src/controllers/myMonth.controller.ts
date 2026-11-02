import { Response } from "express";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../types/type";
import { CONTRIBUTOR_RELATIONS } from "../services/contributorObligations";
import { computeMyMonth, previousMonth } from "../services/myMonth.service";

// AS-2: the computation lives in src/services/myMonth.service.ts (moved, unchanged).
export { previousMonth } from "../services/myMonth.service";

/**
 * GET /user/my-month?month=YYYY-MM  (default: the previous month, the one
 * currently due, in the user's timezone; UTC when none is set)
 *
 * For the signed-in contributor: every category they owe for the month, per
 * site, with its status:
 *   todo      nothing filed yet
 *   pending   filed, waiting for approval
 *   approved  filed and approved
 *   rejected  at least one entry was sent back (always wins: it needs action)
 *   covered   no monthly data needed: an approved yearly batch covers this
 *             month and its period ends in another month
 * Categories are the site's categories narrowed by the user's grants (an empty
 * grant list means all), without FERA (FERA rows are generated from their
 * parent entry). Entries count per site + category, whoever filed them.
 * Yearly batches count as entries in their period-end month. In the other
 * months they cover, a batch that is not fully approved shows its real status
 * (pending/rejected, with rejections) but adds no tCO2e, so summing months
 * never counts a batch twice.
 *
 * Review workflow v2 (S3-15 part 2), only for a company with the switch on:
 * `review_workflow_v2: true`; per site `locked`; per category `entries.draft`,
 * `nothing` and the statuses `draft` (after `rejected`) and `nothing` (nothing
 * filed, marked "Nothing this month"); `summary.draft`. With the switch off
 * the response is exactly as before. Drafts never add to `total_emission`.
 */
export const getMyMonth = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (req.user?.role !== UserRole.USER && req.user?.role !== UserRole.MANAGER) {
      return res.status(403).json({ message: "Only contributors have a monthly checklist" });
    }

    const monthQuery = req.query.month as string | undefined;
    if (monthQuery !== undefined && !/^(\d{4})-(\d{2})$/.test(String(monthQuery))) {
      return res.status(400).json({ message: "month must be YYYY-MM" });
    }

    const user = await AppDataSource.getRepository(User).findOne({
      where: { user_id: userId },
      relations: CONTRIBUTOR_RELATIONS,
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    const monthParam = monthQuery ?? previousMonth(user.timezone);
    const match = /^(\d{4})-(\d{2})$/.exec(monthParam);
    const monthNum = match ? parseInt(match[2], 10) : 0;
    if (!match || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ message: "month must be YYYY-MM" });
    }
    return res.json(await computeMyMonth(user, monthParam));
  } catch (error) {
    console.error("My month error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
