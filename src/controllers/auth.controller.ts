import { Request, Response } from "express";
import { CLIENT_INACTIVE_CODE, CLIENT_INACTIVE_MESSAGE, isUserClientInactive } from "../services/clientStatus";
import bcrypt from "bcrypt";
import { In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { User, USER_APPEARANCES } from "../entities/User";
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

  // password is select: false on the entity, so read the hash on its own.
  const credentials = await userRepo
    .createQueryBuilder("user")
    .addSelect("user.password")
    .where("user.user_id = :id", { id: user.user_id })
    .getOne();
  const valid = credentials?.password ? await bcrypt.compare(password, credentials.password) : false;

  if (!valid) {
    log.warn("Auth", "Login failed — wrong password", { email: emailLower, userId: user.user_id });
    return res.status(401).json({ message: "Invalid credentials" });
  }

  // People of a deactivated client can't sign in (same rule as authenticate).
  if (await isUserClientInactive(user.user_id, user.role)) {
    log.warn("Auth", "Login refused — client is inactive", { email: emailLower, userId: user.user_id });
    return res.status(403).json({ code: CLIENT_INACTIVE_CODE, message: CLIENT_INACTIVE_MESSAGE });
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

  // Best effort: a missing column (migration not run yet) must not block login.
  try {
    await userRepo.update(user.user_id, { last_login_at: new Date() });
  } catch (err) {
    log.warn("Auth", "Could not record last login", { userId: user.user_id, error: String(err) });
  }

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

// GET /auth/me/appearance — the signed-in user's colour scheme
export const getMyAppearance = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const user = await userRepo.findOne({ where: { user_id: userId }, select: ["user_id", "appearance"] });
  if (!user) return res.status(404).json({ message: "User not found" });
  return res.json({ appearance: user.appearance });
};

// PUT /auth/me/appearance { appearance: "light" | "dark" | "system" }
// Updates only this column, only for the signed-in user.
export const updateMyAppearance = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const { appearance } = req.body ?? {};
  if (!(USER_APPEARANCES as readonly string[]).includes(appearance)) {
    return res.status(400).json({ message: `appearance must be one of ${USER_APPEARANCES.join(", ")}` });
  }

  const result = await userRepo.update({ user_id: userId }, { appearance });
  if (!result.affected) return res.status(404).json({ message: "User not found" });
  return res.json({ appearance });
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
