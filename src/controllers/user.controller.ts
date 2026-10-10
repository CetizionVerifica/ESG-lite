import { Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import { UserRole } from "../types/type";

const repo = AppDataSource.getRepository(User);
const siteRepo = AppDataSource.getRepository(Site);
const categoryRepo = AppDataSource.getRepository(Category);

// What the Users page (redesign P20) needs per row: sites with their client,
// and the categories the person can enter data for.
const USER_RELATIONS = ["site", "site.company", "sites", "sites.company", "categories"];

/** Keep only the client's id and name on each joined site. */
const trimCompany = (site?: Site | null) => {
  if (site?.company) {
    site.company = { company_id: site.company.company_id, name: site.company.name } as Site["company"];
  }
};

/**
 * Adds last_login_at (select: false on the entity) to each user. Before
 * migrate:user-last-login has run the column is missing; the list then
 * comes back without it rather than failing.
 */
const withLastLogin = async (users: User[]) => {
  if (users.length === 0) return users;
  try {
    const rows: { user_id: number; last_login_at: Date | null }[] = await AppDataSource.query(
      `SELECT user_id, last_login_at FROM "user" WHERE user_id = ANY($1)`,
      [users.map((u) => u.user_id)],
    );
    const byId = new Map(rows.map((r) => [r.user_id, r.last_login_at]));
    for (const u of users) u.last_login_at = byId.get(u.user_id) ?? null;
  } catch (err) {
    console.warn("last_login_at unavailable (run migrate:user-last-login):", String(err));
  }
  return users;
};

const loadUser = async (user_id: number) => {
  const user = await repo.findOne({ where: { user_id }, relations: USER_RELATIONS });
  if (!user) return user;
  trimCompany(user.site);
  for (const site of user.sites || []) trimCompany(site);
  return (await withLastLogin([user]))[0];
};

/** Optional text field: undefined = not sent, "" or null = clear. */
const optionalText = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
};

const isValidTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** A readable one-time password for accounts created without one. */
const temporaryPassword = () => crypto.randomBytes(9).toString("base64url");

/**
 * Narrows a person's categories to `category_ids`, keeping only categories
 * their sites actually have. undefined = keep the site-seeded set.
 */
const pickCategories = async (seeded: Category[], category_ids: unknown) => {
  if (category_ids === undefined) return seeded;
  const wanted = new Set((Array.isArray(category_ids) ? category_ids : []).map(Number));
  const allowed = seeded.filter((c) => wanted.has(c.category_id));
  if (allowed.length === 0) return [];
  // Re-read so the saved relation carries full rows.
  return categoryRepo.find({ where: { category_id: In(allowed.map((c) => c.category_id)) } });
};

/** Validates the P20 profile fields shared by create and update. */
const profileFields = (body: any): { error?: string; fields: Partial<User> } => {
  const fields: Partial<User> = {};
  const last_name = optionalText(body.last_name);
  const phone_number = optionalText(body.phone_number);
  const timezone = optionalText(body.timezone);
  if (last_name !== undefined) fields.last_name = last_name as string;
  if (phone_number !== undefined) fields.phone_number = phone_number as string;
  if (timezone !== undefined) {
    if (timezone !== null && !isValidTimezone(timezone)) {
      return { error: "Invalid timezone. Use an IANA name such as Asia/Dubai.", fields };
    }
    fields.timezone = timezone;
  }
  if (body.category_ids !== undefined && !Array.isArray(body.category_ids)) {
    return { error: "category_ids must be an array", fields };
  }
  return { fields };
};

/** Collect all unique categories from a list of sites (loaded with categories relation). */
const collectSiteCategories = (sites: Site[]): Category[] => {
  const seen = new Set<number>();
  const result: Category[] = [];
  for (const site of sites) {
    for (const cat of site.categories || []) {
      if (!seen.has(cat.category_id)) {
        seen.add(cat.category_id);
        result.push(cat);
      }
    }
  }
  return result;
};

export const getUsers = async (_: Request, res: Response) => {
  try {
    const users = await repo.find({
      relations: USER_RELATIONS,
      order: { user_id: "ASC" },
    });
    for (const u of users) {
      trimCompany(u.site);
      for (const site of u.sites || []) trimCompany(site);
    }
    return res.status(200).json(await withLastLogin(users));
  } catch (error) {
    console.error("Fetch users error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getUserById = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const user = await repo.findOne({
      where: { user_id: parseInt(id) },
      relations: ["site"],
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.status(200).json(user);
  } catch (error) {
    console.error("Fetch user error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const createUser = async (req: Request, res: Response) => {
  try {
    const { name, email, role, site_id, site_ids, category_ids } = req.body;

    if (!email || !role) {
      return res.status(400).json({
        message: "Email and role are required",
      });
    }

    const profile = profileFields(req.body);
    if (profile.error) {
      return res.status(400).json({ message: profile.error });
    }

    // No password given: generate one and return it once, so the admin can
    // pass it on (the person can also use "forgot password").
    const generated = req.body.password ? undefined : temporaryPassword();
    const password: string = req.body.password || generated;

    if (!Object.values(UserRole).includes(role)) {
      return res.status(400).json({
        message: `Invalid role. Must be one of: ${Object.values(UserRole).join(", ")}`,
      });
    }

    const existingUser = await repo.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        message: "User with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // For managers and users with multiple sites
    if ((role === UserRole.MANAGER || role === UserRole.USER) && site_ids && Array.isArray(site_ids) && site_ids.length > 0) {
      const sites = await siteRepo.find({
        where: { site_id: In(site_ids) },
        relations: ["categories"],
      });

      const user = repo.create({
        ...profile.fields,
        name: name?.trim(),
        email: email.toLowerCase(),
        password: hashedPassword,
        role,
        sites: sites,
        categories: await pickCategories(collectSiteCategories(sites), category_ids),
      });

      await repo.save(user);

      // Reload user with relations to get full site data
      const savedUser = await loadUser(user.user_id);

      return res.status(201).json({
        message: `${role} created successfully with multiple sites`,
        user: savedUser,
        ...(generated ? { temporary_password: generated } : {}),
      });
    }

    // For users with single site (Admin, Superadmin, or single-site assignment)
    let siteCategories: Category[] = [];
    if (site_id) {
      const siteWithCats = await siteRepo.findOne({
        where: { site_id },
        relations: ["categories"],
      });
      siteCategories = siteWithCats?.categories || [];
    }

    const user = repo.create({
      ...profile.fields,
      name: name?.trim(),
      // Login looks the address up lower-cased.
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      role,
      site: site_id ? { site_id } : undefined,
      categories: await pickCategories(siteCategories, category_ids),
    });

    await repo.save(user);

    // Reload user with relations to get full site data
    const savedUser = await loadUser(user.user_id);

    return res.status(201).json({
      message: "User created successfully",
      user: savedUser,
      ...(generated ? { temporary_password: generated } : {}),
    });
  } catch (error) {
    console.error("Create user error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;
    const { name, email, password, role, site_id, site_ids, category_ids } = req.body;

    const profile = profileFields(req.body);
    const hasProfileChange = Object.keys(profile.fields).length > 0 || category_ids !== undefined;

    if (!name && !email && !password && !role && site_id === undefined && site_ids === undefined && !hasProfileChange) {
      return res.status(400).json({
        message: "At least one field is required for update",
      });
    }

    if (profile.error) {
      return res.status(400).json({ message: profile.error });
    }

    const user = await repo.findOne({
      where: { user_id: parseInt(id) },
      relations: ["site", "sites", "categories"],
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (name !== undefined) {
      user.name = name?.trim() || null;
    }

    if (email) {
      const existingUser = await repo.findOne({ where: { email } });
      if (existingUser && existingUser.user_id !== user.user_id) {
        return res.status(400).json({
          message: "User with this email already exists",
        });
      }
      user.email = email.toLowerCase();
    }


    if (password&& !password.startsWith("$2b$")) {
      user.password = await bcrypt.hash(password, 10);
    }

    if (role) {
      if (!Object.values(UserRole).includes(role)) {
        return res.status(400).json({
          message: `Invalid role. Must be one of: ${Object.values(UserRole).join(", ")}`,
        });
      }
      user.role = role;
    }

    // Handle multiple sites for managers
    if (site_ids !== undefined && Array.isArray(site_ids)) {
      if (site_ids.length > 0) {
        const sites = await siteRepo.find({
          where: { site_id: In(site_ids) },
          relations: ["categories"],
        });
        user.sites = sites;
        // Re-seed categories: grant all categories from new sites
        user.categories = collectSiteCategories(sites);
      } else {
        user.sites = [];
        user.categories = [];
      }
      // Clear single site when using multiple sites
      user.site = null as any;
    } else if (site_id !== undefined) {
      // Handle single site for regular users
      user.site = site_id ? ({ site_id } as any) : null;
      // Clear multiple sites when using single site
      user.sites = [];
      // Re-seed categories from the new single site
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

    Object.assign(user, profile.fields);

    // Narrow categories within what the person's sites offer. Sites changed
    // above re-seeded user.categories; otherwise read the current sites.
    if (category_ids !== undefined) {
      const siteIds = [user.site?.site_id, ...(user.sites || []).map((s) => s.site_id)].filter(
        (v): v is number => typeof v === "number",
      );
      const sitesWithCats = siteIds.length
        ? await siteRepo.find({ where: { site_id: In(siteIds) }, relations: ["categories"] })
        : [];
      user.categories = await pickCategories(collectSiteCategories(sitesWithCats), category_ids);
    }

    await repo.save(user);

    // Reload user with relations for response
    const updatedUser = await loadUser(parseInt(id));

    return res.status(200).json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Update user error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const user = await repo.findOne({
      where: { user_id: parseInt(id) },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    await repo.delete({ user_id: parseInt(id) });

    return res.status(200).json({
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Delete user error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
