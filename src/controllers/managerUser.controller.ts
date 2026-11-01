import { Response } from "express";
import { Brackets, In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../types/type";

/** A manager's team is the contributors (role User) on their sites; Admins, other managers and the team's own internal accounts are not theirs to manage. */
const NOT_TEAM = "You can only manage people with the User role on your sites.";

const userRepo = AppDataSource.getRepository(User);
const siteRepo = AppDataSource.getRepository(Site);
const categoryRepo = AppDataSource.getRepository(Category);

/**
 * Get all sites managed by the current manager (with their categories).
 */
const getManagerSites = async (managerId: number): Promise<Site[]> => {
  const manager = await userRepo.findOne({
    where: { user_id: managerId },
    relations: ["sites", "sites.categories"],
  });
  return manager?.sites || [];
};

/**
 * GET /manager/users
 * List the contributors (role User) on the manager's own sites.
 */
export const getManagerUsers = async (req: AuthRequest, res: Response) => {
  try {
    const managerId = req.user!.userId;
    const managerSites = await getManagerSites(managerId);

    if (managerSites.length === 0) {
      return res.json([]);
    }

    const managerSiteIds = managerSites.map((s) => s.site_id);

    // Contributors on any of the manager's sites (via single site or multi-site),
    // found in the database rather than by loading every contributor.
    const rows = await userRepo
      .createQueryBuilder("user")
      .leftJoin("user.site", "site")
      .leftJoin("user.sites", "msite")
      .where("user.role = :role", { role: UserRole.USER })
      // Internal (PlanetPulse team) accounts are managed by a Superadmin, not the client.
      .andWhere("user.is_internal = false")
      .andWhere(
        new Brackets((qb) => {
          qb.where("site.site_id IN (:...ids)", { ids: managerSiteIds }).orWhere("msite.site_id IN (:...ids)", { ids: managerSiteIds });
        }),
      )
      .select("user.user_id", "user_id")
      .distinct(true)
      .getRawMany();
    const filteredUsers = rows.length
      ? await userRepo.find({
          where: { user_id: In(rows.map((r) => r.user_id)) },
          relations: ["site", "site.categories", "sites", "sites.categories", "categories"],
          order: { user_id: "ASC" },
        })
      : [];

    // Build response with site categories info
    const result = filteredUsers.map((u) => {
      const userCategories = u.categories || [];
      const userCategoryIds = new Set(userCategories.map((c) => c.category_id));
      // Legacy users with no user_categories rows get full access by default
      const hasNoCategories = userCategories.length === 0;

      // Collect all site categories available to this user (from manager's sites only)
      const siteCategoryAccess = managerSites
        .filter((ms) => {
          const userSiteIds = new Set<number>();
          if (u.site?.site_id) userSiteIds.add(u.site.site_id);
          for (const s of u.sites || []) userSiteIds.add(s.site_id);
          return userSiteIds.has(ms.site_id);
        })
        .map((ms) => ({
          site_id: ms.site_id,
          site_name: ms.name,
          categories: (ms.categories || []).map((c) => ({
            category_id: c.category_id,
            category_name: c.category_name,
            has_access: hasNoCategories || userCategoryIds.has(c.category_id),
          })),
        }));

      return {
        user_id: u.user_id,
        name: u.name,
        last_name: u.last_name,
        email: u.email,
        role: u.role,
        sites: siteCategoryAccess,
      };
    });

    return res.json(result);
  } catch (error) {
    console.error("getManagerUsers error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET /manager/users/:userId/categories
 * Get a specific user's category access details.
 */
export const getUserCategories = async (req: AuthRequest, res: Response) => {
  try {
    const managerId = req.user!.userId;
    const userId = parseInt(req.params.userId as string);

    const managerSites = await getManagerSites(managerId);
    const managerSiteIds = new Set(managerSites.map((s) => s.site_id));

    const targetUser = await userRepo.findOne({
      where: { user_id: userId },
      relations: ["site", "sites", "categories"],
    });

    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Verify user belongs to one of the manager's sites
    const userSiteIds = new Set<number>();
    if (targetUser.site?.site_id) userSiteIds.add(targetUser.site.site_id);
    for (const s of targetUser.sites || []) userSiteIds.add(s.site_id);

    const sharedSiteIds = [...userSiteIds].filter((id) => managerSiteIds.has(id));
    if (sharedSiteIds.length === 0) {
      return res.status(403).json({ message: "User is not on your sites" });
    }
    if (targetUser.role !== UserRole.USER || targetUser.is_internal) {
      return res.status(403).json({ message: NOT_TEAM });
    }

    const userCategories = targetUser.categories || [];
    const userCategoryIds = new Set(userCategories.map((c) => c.category_id));
    const hasNoCategories = userCategories.length === 0;

    const siteCategoryAccess = managerSites
      .filter((ms) => userSiteIds.has(ms.site_id))
      .map((ms) => ({
        site_id: ms.site_id,
        site_name: ms.name,
        categories: (ms.categories || []).map((c) => ({
          category_id: c.category_id,
          category_name: c.category_name,
          has_access: hasNoCategories || userCategoryIds.has(c.category_id),
        })),
      }));

    return res.json({
      user_id: targetUser.user_id,
      name: targetUser.name,
      email: targetUser.email,
      sites: siteCategoryAccess,
    });
  } catch (error) {
    console.error("getUserCategories error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * PUT /manager/users/:userId/categories
 * Update a user's category access.
 * Body: { category_ids: number[] }
 */
export const updateUserCategories = async (req: AuthRequest, res: Response) => {
  try {
    const managerId = req.user!.userId;
    const userId = parseInt(req.params.userId as string);
    const { category_ids } = req.body;

    if (!Array.isArray(category_ids)) {
      return res.status(400).json({ message: "category_ids must be an array" });
    }

    const managerSites = await getManagerSites(managerId);
    const managerSiteIds = new Set(managerSites.map((s) => s.site_id));

    const targetUser = await userRepo.findOne({
      where: { user_id: userId },
      relations: ["site", "sites", "categories"],
    });

    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Verify user belongs to one of the manager's sites
    const userSiteIds = new Set<number>();
    if (targetUser.site?.site_id) userSiteIds.add(targetUser.site.site_id);
    for (const s of targetUser.sites || []) userSiteIds.add(s.site_id);

    const sharedSiteIds = [...userSiteIds].filter((id) => managerSiteIds.has(id));
    if (sharedSiteIds.length === 0) {
      return res.status(403).json({ message: "User is not on your sites" });
    }
    if (targetUser.role !== UserRole.USER || targetUser.is_internal) {
      return res.status(403).json({ message: NOT_TEAM });
    }

    // Validate that all category_ids belong to the user's sites
    const allowedCategoryIds = new Set<number>();
    for (const site of managerSites) {
      if (userSiteIds.has(site.site_id)) {
        for (const cat of site.categories || []) {
          allowedCategoryIds.add(cat.category_id);
        }
      }
    }

    const invalidIds = category_ids.filter((id: number) => !allowedCategoryIds.has(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        message: `Categories not available on user's sites: ${invalidIds.join(", ")}`,
      });
    }

    // user_categories has no site column: a grant for a category that isn't on
    // this manager's shared sites came from another manager, so it stays.
    // A person with no grants yet (legacy: every category) keeps every category
    // of the sites this manager doesn't share, rather than losing them.
    const otherSiteIds = [...userSiteIds].filter((id) => !managerSiteIds.has(id));
    const current = targetUser.categories?.length
      ? targetUser.categories.map((c) => c.category_id)
      : otherSiteIds.length
        ? (await AppDataSource.query(`SELECT DISTINCT category_id FROM site_categories WHERE site_id = ANY($1)`, [otherSiteIds])).map((r: { category_id: number }) => Number(r.category_id))
        : [];
    const keptIds = current.filter((id: number) => !allowedCategoryIds.has(id));
    const nextIds = [...new Set<number>([...keptIds, ...category_ids])];
    // No grants at all reads as every category (filterUserCategories, legacy
    // users), so removing the last one would grant everything instead.
    if (nextIds.length === 0) {
      return res.status(400).json({
        code: "CATEGORY_ACCESS_EMPTY",
        message: "Keep at least one category enabled. To remove this person's access, remove them from the site.",
      });
    }
    targetUser.categories = await categoryRepo.findBy({ category_id: In(nextIds) });

    await userRepo.save(targetUser);

    return res.json({ message: "User category access updated successfully" });
  } catch (error) {
    console.error("updateUserCategories error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
