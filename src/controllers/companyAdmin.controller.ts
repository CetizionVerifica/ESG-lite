import { Response } from "express";
import bcrypt from "bcrypt";
import { In, Brackets } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import { UserRole } from "../types/type";
import { AuthRequest } from "../middlewares/auth.middleware";
import {
  resolveUserCompanyId,
  getCompanySiteIds,
  userBelongsToCompany,
  sitesWithinCompany,
  collectSiteCategories,
} from "../utils/companyScope";

const userRepo = AppDataSource.getRepository(User);
const siteRepo = AppDataSource.getRepository(Site);

// A company admin may only view and manage Users and Managers within their company.
const MANAGEABLE_ROLES: UserRole[] = [UserRole.USER, UserRole.MANAGER];

/**
 * Resolve the company scope (companyId + its site IDs) for the logged-in admin.
 * Writes an error response and returns null when the admin has no company.
 */
const loadCompanyScope = async (
  req: AuthRequest,
  res: Response
): Promise<{ companyId: number; siteIds: Set<number> } | null> => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }

  const companyId = await resolveUserCompanyId(userId);
  if (!companyId) {
    res.status(403).json({
      message: "Company admin is not linked to a company",
    });
    return null;
  }

  const siteIds = await getCompanySiteIds(companyId);
  return { companyId, siteIds };
};

/** GET /company-admin/users — list Users and Managers of the admin's company. */
export const getCompanyUsers = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await loadCompanyScope(req, res);
    if (!scope) return;

    if (scope.siteIds.size === 0) {
      return res.status(200).json([]);
    }

    const siteIds = Array.from(scope.siteIds);

    // Find the IDs of users linked to any company site via either relation.
    const rows = await userRepo
      .createQueryBuilder("user")
      .leftJoin("user.site", "site")
      .leftJoin("user.sites", "msite")
      .where("user.role IN (:...roles)", { roles: MANAGEABLE_ROLES })
      .andWhere(
        new Brackets((qb) => {
          qb.where("site.site_id IN (:...siteIds)", { siteIds }).orWhere(
            "msite.site_id IN (:...siteIds)",
            { siteIds }
          );
        })
      )
      .select("user.user_id", "user_id")
      .distinct(true)
      .getRawMany();

    const userIds = rows.map((row) => row.user_id);
    if (userIds.length === 0) {
      return res.status(200).json([]);
    }

    // Reload with full relations so site collections are not truncated by the filter.
    const users = await userRepo.find({
      where: { user_id: In(userIds) },
      relations: ["site", "sites"],
      order: { user_id: "ASC" },
    });

    return res.status(200).json(users);
  } catch (error) {
    console.error("Fetch company users error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /company-admin/sites — list the sites of the admin's company. */
export const getCompanySites = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await loadCompanyScope(req, res);
    if (!scope) return;

    const sites = await siteRepo.find({
      where: { company: { company_id: scope.companyId } },
      relations: ["categories"],
      order: { site_id: "ASC" },
    });

    return res.status(200).json(sites);
  } catch (error) {
    console.error("Fetch company sites error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /company-admin/users — create a User or Manager within the admin's company. */
export const createCompanyUser = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await loadCompanyScope(req, res);
    if (!scope) return;

    const { name, email, password, role, site_id, site_ids } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({
        message: "Email, password, and role are required",
      });
    }

    if (!MANAGEABLE_ROLES.includes(role)) {
      return res.status(403).json({
        message: `Company admin can only create these roles: ${MANAGEABLE_ROLES.join(", ")}`,
      });
    }

    // Every requested site must belong to the admin's company.
    const requestedSiteIds = Array.isArray(site_ids)
      ? site_ids
      : site_id
        ? [site_id]
        : [];
    if (!sitesWithinCompany(requestedSiteIds, scope.siteIds)) {
      return res.status(403).json({
        message: "One or more sites do not belong to your company",
      });
    }

    const existingUser = await userRepo.findOne({
      where: { email: email.toLowerCase() },
    });
    if (existingUser) {
      return res.status(400).json({
        message: "User with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Multi-site assignment (Manager / User with several sites).
    if (Array.isArray(site_ids) && site_ids.length > 0) {
      const sites = await siteRepo.find({
        where: { site_id: In(site_ids) },
        relations: ["categories"],
      });

      const user = userRepo.create({
        name: name?.trim(),
        email: email.toLowerCase(),
        password: hashedPassword,
        role,
        sites,
        categories: collectSiteCategories(sites),
      });
      await userRepo.save(user);

      const savedUser = await userRepo.findOne({
        where: { user_id: user.user_id },
        relations: ["site", "sites"],
      });

      return res.status(201).json({
        message: `${role} created successfully with multiple sites`,
        user: savedUser,
      });
    }

    // Single-site assignment.
    let siteCategories: Category[] = [];
    if (site_id) {
      const siteWithCats = await siteRepo.findOne({
        where: { site_id },
        relations: ["categories"],
      });
      siteCategories = siteWithCats?.categories || [];
    }

    const user = userRepo.create({
      name: name?.trim(),
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      site: site_id ? { site_id } : undefined,
      categories: siteCategories,
    });
    await userRepo.save(user);

    const savedUser = await userRepo.findOne({
      where: { user_id: user.user_id },
      relations: ["site", "sites"],
    });

    return res.status(201).json({
      message: "User created successfully",
      user: savedUser,
    });
  } catch (error) {
    console.error("Create company user error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** PATCH /company-admin/users/:id — update a User or Manager within the admin's company. */
export const updateCompanyUser = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await loadCompanyScope(req, res);
    if (!scope) return;

    const { id }: any = req.params;
    const { name, email, password, role, site_id, site_ids } = req.body;

    if (
      !name &&
      !email &&
      !password &&
      !role &&
      site_id === undefined &&
      site_ids === undefined
    ) {
      return res.status(400).json({
        message: "At least one field is required for update",
      });
    }

    const user = await userRepo.findOne({
      where: { user_id: parseInt(id) },
      relations: ["site", "sites", "categories"],
    });

    if (!user || !userBelongsToCompany(user, scope.siteIds)) {
      return res.status(404).json({ message: "User not found" });
    }

    // Company admins may only manage Users and Managers, never elevate a role.
    if (!MANAGEABLE_ROLES.includes(user.role)) {
      return res.status(403).json({
        message: "You cannot manage this user",
      });
    }

    if (role && !MANAGEABLE_ROLES.includes(role)) {
      return res.status(403).json({
        message: `Company admin can only assign these roles: ${MANAGEABLE_ROLES.join(", ")}`,
      });
    }

    // Validate any site changes stay within the company.
    const requestedSiteIds = Array.isArray(site_ids)
      ? site_ids
      : site_id
        ? [site_id]
        : [];
    if (!sitesWithinCompany(requestedSiteIds, scope.siteIds)) {
      return res.status(403).json({
        message: "One or more sites do not belong to your company",
      });
    }

    if (name !== undefined) {
      user.name = name?.trim() || null;
    }

    if (email) {
      const existingUser = await userRepo.findOne({
        where: { email: email.toLowerCase() },
      });
      if (existingUser && existingUser.user_id !== user.user_id) {
        return res.status(400).json({
          message: "User with this email already exists",
        });
      }
      user.email = email.toLowerCase();
    }

    if (password && !password.startsWith("$2b$")) {
      user.password = await bcrypt.hash(password, 10);
    }

    if (role) {
      user.role = role;
    }

    if (site_ids !== undefined && Array.isArray(site_ids)) {
      if (site_ids.length > 0) {
        const sites = await siteRepo.find({
          where: { site_id: In(site_ids) },
          relations: ["categories"],
        });
        user.sites = sites;
        user.categories = collectSiteCategories(sites);
      } else {
        user.sites = [];
        user.categories = [];
      }
      user.site = null as any;
    } else if (site_id !== undefined) {
      user.site = site_id ? ({ site_id } as any) : null;
      user.sites = [];
      if (site_id) {
        const siteWithCats = await siteRepo.findOne({
          where: { site_id },
          relations: ["categories"],
        });
        user.categories = siteWithCats?.categories || [];
      } else {
        user.categories = [];
      }
    }

    await userRepo.save(user);

    const updatedUser = await userRepo.findOne({
      where: { user_id: parseInt(id) },
      relations: ["site", "sites"],
    });

    return res.status(200).json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Update company user error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** DELETE /company-admin/users/:id — delete a User or Manager within the admin's company. */
export const deleteCompanyUser = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await loadCompanyScope(req, res);
    if (!scope) return;

    const { id }: any = req.params;

    const user = await userRepo.findOne({
      where: { user_id: parseInt(id) },
      relations: ["site", "sites"],
    });

    if (!user || !userBelongsToCompany(user, scope.siteIds)) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!MANAGEABLE_ROLES.includes(user.role)) {
      return res.status(403).json({ message: "You cannot delete this user" });
    }

    await userRepo.delete({ user_id: parseInt(id) });

    return res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete company user error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
