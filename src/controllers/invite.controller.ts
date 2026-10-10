import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Company } from "../entities/Company";
import { UserRole } from "../types/type";
import { resolveUserCompanyId } from "../utils/companyScope";
import { issueInvite } from "../services/invite";

/**
 * POST /admin/users/:id/invite (Superadmin) — email the person a link to
 * choose a password. Sends a fresh link each time; earlier links stop working.
 * The current password (if any) keeps working until they choose a new one.
 */
export const sendUserInvite = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid user id" });

  const user = await AppDataSource.getRepository(User).findOne({ where: { user_id: id } });
  if (!user) return res.status(404).json({ message: "User not found" });
  if (user.role === UserRole.SUPERADMIN) {
    return res.status(400).json({ message: "Superadmins can't be invited; they reset their own password." });
  }

  const companyId = await resolveUserCompanyId(id);
  const company = companyId
    ? await AppDataSource.getRepository(Company).findOne({ where: { company_id: companyId } })
    : null;

  const result = await issueInvite(user, company?.name);
  if (!result.sent) return res.status(503).json({ message: result.reason });
  return res.json({ message: `Invite sent to ${user.email}`, expiresAt: result.expiresAt });
};
