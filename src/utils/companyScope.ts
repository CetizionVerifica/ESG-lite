import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import { UserRole } from "../types/type";
import { preferredCompanyId } from "./activeCompany";

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
 * Resolve the company a user belongs to. An Admin belongs to a company
 * (`user.company_id`); everyone else's company is derived from their single
 * site or, for multi-site roles, their first site. Returns null when the user
 * is not linked to any company. M6: a person with sites at several clients
 * gets the company chosen in the account menu (`X-Company-Id`) when they
 * belong to it.
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

  const preferred = preferredCompanyId();
  if (
    preferred !== null &&
    (user.company_id === preferred ||
      user.site?.company?.company_id === preferred ||
      (user.sites ?? []).some((s) => s.company?.company_id === preferred))
  ) {
    return preferred;
  }

  return (
    user.company_id ??
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
  companySiteIds: Set<number>,
  companyId?: number
): boolean => {
  if (companyId !== undefined && user.company_id === companyId) return true;
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

/**
 * The sites Overview and submission status cover, by name: a Manager's own sites, or every site of
 * a company Admin's company (M5, read-only). Null when the user doesn't exist.
 */
export const overseenSites = async (userId: number, role: string | undefined): Promise<Map<number, string> | null> => {
  const out = new Map<number, string>();
  if (role === UserRole.ADMIN) {
    const companyId = await resolveUserCompanyId(userId);
    if (!companyId) return out;
    const sites = await siteRepo.find({ where: { company: { company_id: companyId } }, select: { site_id: true, name: true }, order: { site_id: "ASC" } });
    sites.forEach((s) => out.set(s.site_id, s.name));
    return out;
  }
  const user = await userRepo.findOne({ where: { user_id: userId }, relations: ["site", "sites"] });
  if (!user) return null;
  if (user.site) out.set(user.site.site_id, user.site.name);
  (user.sites || []).forEach((s) => out.set(s.site_id, s.name));
  return out;
};

/**
 * The sites a read may cover. With requested ids: forbidden when any is not
 * the caller's, else those ids. Without: every site the caller may read, or
 * null (no filter) for a Superadmin. An empty list means the caller has no
 * sites, so the read must return nothing (see siteFilterSql).
 */
export const scopeSiteIds = async (
  userId: number,
  role: string,
  requested: number[]
): Promise<{ forbidden: true } | { forbidden: false; siteIds: number[] | null }> => {
  const allowed = await accessibleSiteIds(userId, role);
  if (!allowed) return { forbidden: false, siteIds: requested.length ? requested : null };
  if (requested.length) {
    return requested.every((id) => allowed.has(id))
      ? { forbidden: false, siteIds: requested }
      : { forbidden: true };
  }
  return { forbidden: false, siteIds: [...allowed] };
};

/** WHERE clause for a scoped site list; matches nothing when the list is empty. */
export const siteFilterSql = (column: string, siteIds: number[]): string =>
  siteIds.length ? `${column} IN (:...scopedSiteIds)` : "1 = 0";

export const SITE_ACCESS_DENIED = { message: "You do not have access to one or more of these sites" };

/**
 * A person works for one client, so their sites must all belong to one
 * company: a mix would show them (and let them enter) another client's data.
 * A site without a company counts as its own. Sites must be loaded with their
 * company. Returns the 400 message, or null.
 */
export const mixedCompaniesError = (sites: Site[]): string | null => {
  const names = new Map<number, string>();
  for (const site of sites) names.set(site.company?.company_id ?? 0, site.company?.name ?? "no client");
  if (names.size <= 1) return null;
  const listed = [...names.entries()].sort((a, b) => a[0] - b[0]).map(([, name]) => name);
  return `A person's sites must all belong to one client. These sites belong to ${names.size} clients: ${listed.join(", ")}.`;
};
