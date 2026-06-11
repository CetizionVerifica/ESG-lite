import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Site } from "../entities/Site";
import { signToken } from "../utils/jwt";
import { UserRole } from "../types/type";
import { log } from "../utils/logger";
import { AuthRequest } from "../middlewares/auth.middleware";
import { filterUserSiteCategories } from "../utils/filterUserCategories";

// Relations needed to build the session user (sites + their categories + grants).
const SESSION_USER_RELATIONS = [
  "site",
  "site.company",
  "site.categories",
  "sites",
  "sites.company",
  "sites.categories",
  "categories",
];

const userRepo = AppDataSource.getRepository(User);
const siteRepo = AppDataSource.getRepository(Site);

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const emailLower = email.toLowerCase();
  //console.log("emailLower", emailLower)
  // Load user with both single site (for regular users) and multiple sites (for managers)
  // Also load user.categories for per-user category access control
  const user = await userRepo.findOne({
    where: { email : emailLower },
    relations: SESSION_USER_RELATIONS,
  });

  if (!user) {
    log.warn("Auth", "Login failed — user not found", { email: emailLower });
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    log.warn("Auth", "Login failed — wrong password", { email: emailLower, userId: user.user_id });
    return res.status(401).json({ message: "Invalid credentials" });
  }

  // Filter each site's categories to only include ones the user has access to.
  filterUserSiteCategories(user);

  // For managers and users with multiple sites, use the first site from sites array for backward compatibility
  const primarySiteId =
    (user.role === UserRole.MANAGER || user.role === UserRole.USER) && user.sites?.length > 0
      ? user.sites[0].site_id
      : user.site?.site_id;

  const token = signToken({
    userId: user.user_id,
    role: user.role,
    siteId: primarySiteId,
  });

  log.info("Auth", "Login success", { email: emailLower, userId: user.user_id, role: user.role });
  res.json({ token, role: user.role, user: user });
};

// 🔄 Return the current session user with fresh site/category access.
// Lets the frontend refresh category assignments without forcing a re-login.
export const getMe = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = await userRepo.findOne({
    where: { user_id: userId },
    relations: SESSION_USER_RELATIONS,
  });

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  filterUserSiteCategories(user);

  return res.json({ role: user.role, user });
};

// 🔒 Only Superadmin can register users
export const register = async (req: Request, res: Response) => {
  const { email, password, role, siteId, siteIds } = req.body;

  if (!Object.values(UserRole).includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }

  const exists = await userRepo.findOne({ where: { email } });
  if (exists) {
    log.warn("Auth", "Register failed — email exists", { email });
    return res.status(409).json({ message: "User already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  // For managers and users, use siteIds array for multiple sites
  if ((role === UserRole.MANAGER || role === UserRole.USER) && siteIds && Array.isArray(siteIds)) {
    const sites = await siteRepo.findBy({ site_id: In(siteIds) });

    const user = userRepo.create({
      email,
      password: hashedPassword,
      role,
      sites: sites,
    });

    await userRepo.save(user);

    return res.status(201).json({ message: `${role} registered successfully with multiple sites` });
  }

  // For regular users, use single siteId
  const user = userRepo.create({
    email,
    password: hashedPassword,
    role,
    site: siteId ? { site_id: siteId } : undefined,
  });

  await userRepo.save(user);

  res.status(201).json({ message: "User registered successfully" });
};
