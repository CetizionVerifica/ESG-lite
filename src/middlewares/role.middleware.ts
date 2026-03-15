import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.middleware";
import { UserRole } from "../types/type";

export const requireSuperAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (req.user?.role !== UserRole.SUPERADMIN) {
    return res.status(403).json({ message: "Access denied" });
  }
  next();
};

export const requireManager = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (req.user?.role !== UserRole.MANAGER) {
    return res.status(403).json({ message: "Manager access required" });
  }
  next();
};
