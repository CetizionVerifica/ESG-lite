// Who may see which PCF data. Every /pcf/* route is for Managers (their own
// sites) and Superadmins (everything); contributors (User) and company admins
// get 403, as the E1 spec requires.
import { Response, NextFunction } from "express";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../types/type";

export const requirePcfAccess = (req: AuthRequest, res: Response, next: NextFunction) => {
  const role = req.user?.role;
  if (role !== UserRole.MANAGER && role !== UserRole.SUPERADMIN) {
    return res.status(403).json({ message: "Product footprints are for managers" });
  }
  next();
};

export interface PcfScope {
  all: boolean; // superadmin
  userId: number;
  siteIds: number[];
  companyIds: number[];
}

export async function pcfScope(req: AuthRequest): Promise<PcfScope> {
  const userId = req.user!.userId;
  if (req.user!.role === UserRole.SUPERADMIN) return { all: true, userId, siteIds: [], companyIds: [] };
  const manager = await AppDataSource.getRepository(User).findOne({
    where: { user_id: userId },
    relations: ["sites", "sites.company"],
  });
  const sites = manager?.sites ?? [];
  return {
    all: false,
    userId,
    siteIds: sites.map((s) => s.site_id),
    companyIds: Array.from(new Set(sites.map((s) => s.company?.company_id).filter((id): id is number => id != null))),
  };
}

export const canSeeSite = (scope: PcfScope, siteId: number) => scope.all || scope.siteIds.includes(siteId);
export const canSeeCompany = (scope: PcfScope, companyId: number | null) =>
  companyId === null || scope.all || scope.companyIds.includes(companyId);
