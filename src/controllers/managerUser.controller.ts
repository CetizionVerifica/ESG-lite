import { Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import { AuthRequest } from "../middlewares/auth.middleware";

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
 * List all users on the manager's own sites.
 */
export const getManagerUsers = async (req: AuthRequest, res: Response) => {
  try {
    const managerId = req.user!.userId;
    const managerSites = await getManagerSites(managerId);

    if (managerSites.length === 0) {
      return res.json([]);
    }

    const managerSiteIds = managerSites.map((s) => s.site_id);

    // Find users assigned to any of the manager's sites (via single site or multi-site)
    const allUsers = await userRepo.find({
      relations: ["site", "site.categories", "sites", "sites.categories", "categories"],
      order: { user_id: "ASC" },
    });

    // Filter to users who share at least one site with the manager
    const filteredUsers = allUsers.filter((u) => {
      // Exclude the manager themselves
      if (u.user_id === managerId) return false;

      const userSiteIds = new Set<number>();
      if (u.site?.site_id) userSiteIds.add(u.site.site_id);
      for (const s of u.sites || []) userSiteIds.add(s.site_id);

      return managerSiteIds.some((id) => userSiteIds.has(id));
    });

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

    // Update user's categories
    if (category_ids.length > 0) {
      const categories = await categoryRepo.findBy({ category_id: In(category_ids) });
      targetUser.categories = categories;
    } else {
      targetUser.categories = [];
    }

    await userRepo.save(targetUser);

    return res.json({ message: "User category access updated successfully" });
  } catch (error) {
    console.error("updateUserCategories error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
