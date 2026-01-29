import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Site } from "../entities/Site";
import { signToken } from "../utils/jwt";
import { UserRole } from "../types/type";

const userRepo = AppDataSource.getRepository(User);
const siteRepo = AppDataSource.getRepository(Site);

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // Load user with both single site (for regular users) and multiple sites (for managers)
  const user = await userRepo.findOne({
    where: { email },
    relations: ["site", "site.categories", "sites", "sites.categories"],
  });

  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

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

  res.json({ token, role: user.role, user: user });
};

// 🔒 Only Superadmin can register users
export const register = async (req: Request, res: Response) => {
  const { email, password, role, siteId, siteIds } = req.body;

  if (!Object.values(UserRole).includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }

  const exists = await userRepo.findOne({ where: { email } });
  if (exists) {
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
