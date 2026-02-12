import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Site } from "../entities/Site";
import { UserRole } from "../types/type";

const repo = AppDataSource.getRepository(User);
const siteRepo = AppDataSource.getRepository(Site);

export const getUsers = async (_: Request, res: Response) => {
  try {
    const users = await repo.find({
      relations: ["site", "sites"],
      order: { user_id: "ASC" },
    });
    return res.status(200).json(users);
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
    const { name, email, password, role, site_id, site_ids } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({
        message: "Email, password, and role are required",
      });
    }

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
      const sites = await siteRepo.findBy({ site_id: In(site_ids) });

      const user = repo.create({
        name: name?.trim(),
        email: email.toLowerCase(),
        password: hashedPassword,
        role,
        sites: sites,
      });

      await repo.save(user);

      // Reload user with relations to get full site data
      const savedUser = await repo.findOne({
        where: { user_id: user.user_id },
        relations: ["site", "sites"],
      });

      return res.status(201).json({
        message: `${role} created successfully with multiple sites`,
        user: savedUser,
      });
    }

    // For users with single site (Admin, Superadmin, or single-site assignment)
    const user = repo.create({
      name: name?.trim(),
      email: email.trim(),
      password: hashedPassword,
      role,
      site: site_id ? { site_id } : undefined,
    });

    await repo.save(user);

    // Reload user with relations to get full site data
    const savedUser = await repo.findOne({
      where: { user_id: user.user_id },
      relations: ["site", "sites"],
    });

    return res.status(201).json({
      message: "User created successfully",
      user: savedUser,
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
    const { name, email, password, role, site_id, site_ids } = req.body;


    if (!name && !email && !password && !role && site_id === undefined && site_ids === undefined) {
      return res.status(400).json({
        message: "At least one field is required for update",
      });
    }

    const user = await repo.findOne({
      where: { user_id: parseInt(id) },
      relations: ["site", "sites"],
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
        const sites = await siteRepo.findBy({ site_id: In(site_ids) });
        user.sites = sites;
      } else {
        user.sites = [];
      }
      // Clear single site when using multiple sites
      user.site = null as any;
    } else if (site_id !== undefined) {
      // Handle single site for regular users
      user.site = site_id ? ({ site_id } as any) : null;
      // Clear multiple sites when using single site
      user.sites = [];
    }

    await repo.save(user);

    // Reload user with relations for response
    const updatedUser = await repo.findOne({
      where: { user_id: parseInt(id) },
      relations: ["site", "sites"],
    });

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
