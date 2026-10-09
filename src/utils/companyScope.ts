import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import { UserRole } from "../types/type";

const userRepo = AppDataSource.getRepository(User);
const siteRepo = AppDataSource.getRepository(Site);

// Relations needed to derive an admin's company from their assigned site(s).
const ADMIN_COMPANY_RELATIONS = [
  "site",
  "site.company",
  "sites",
  "sites.company",
];

/**
 * Resolve the company a user belongs to. A user has no direct company link —
 * it is derived from their single site or, for multi-site roles, their first site.
 * Returns null when the user is not linked to any company.
 */
export const resolveUserCompanyId = async (
  userId: number
): Promise<number | null> => {
  const user = await userRepo.findOne({
    where: { user_id: userId },
    relations: ADMIN_COMPANY_RELATIONS,
  });

  if (!user) {
    return null;
  }

  return (
    user.site?.company?.company_id ??
    user.sites?.[0]?.company?.company_id ??
    null
  );
};

/** Load the set of site IDs that belong to a company. */
export const getCompanySiteIds = async (
  companyId: number
): Promise<Set<number>> => {
  const sites = await siteRepo.find({
    where: { company: { company_id: companyId } },
  });
  return new Set(sites.map((site) => site.site_id));
};

/**
 * Whether a loaded user (with "site" and "sites" relations) belongs to the
 * company represented by companySiteIds.
 */
export const userBelongsToCompany = (
  user: User,
  companySiteIds: Set<number>
): boolean => {
  if (user.site && companySiteIds.has(user.site.site_id)) {
    return true;
  }
  return (user.sites || []).some((site) => companySiteIds.has(site.site_id));
};

/** Whether every requested site ID belongs to the company. */
export const sitesWithinCompany = (
  requestedSiteIds: number[],
  companySiteIds: Set<number>
): boolean => requestedSiteIds.every((id) => companySiteIds.has(id));

/** Collect all unique categories across the given sites (loaded with categories). */
export const collectSiteCategories = (sites: Site[]): Category[] => {
  const seen = new Set<number>();
  const result: Category[] = [];
  for (const site of sites) {
    for (const category of site.categories || []) {
      if (!seen.has(category.category_id)) {
        seen.add(category.category_id);
        result.push(category);
      }
    }
  }
  return result;
};

/**
 * Site ids a user may read: their own site(s) for Users and Managers, every
 * site of their company for company Admins. Null means unrestricted
 * (Superadmin).
 */
export const accessibleSiteIds = async (
  userId: number,
  role: string
): Promise<Set<number> | null> => {
  if (role === UserRole.SUPERADMIN) return null;
  if (role === UserRole.ADMIN) {
    const companyId = await resolveUserCompanyId(userId);
    return companyId ? getCompanySiteIds(companyId) : new Set();
  }
  const user = await userRepo.findOne({
    where: { user_id: userId },
    relations: ["site", "sites"],
  });
  const ids = new Set<number>();
  if (user?.site) ids.add(user.site.site_id);
  (user?.sites || []).forEach((site) => ids.add(site.site_id));
  return ids;
};
