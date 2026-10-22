import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { requireManager } from "../middlewares/role.middleware";
import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../types/type";
import {
  getManagerUsers,
  getUserCategories,
  updateUserCategories,
} from "../controllers/managerUser.controller";
import { getSubmissionStatus } from "../controllers/submissionStatus.controller";
import { getManagerOverview } from "../controllers/managerOverview.controller";

const router = Router();

// M5 (#234): a company Admin reads Overview for their company's sites (Insights links there). Read-only.
const managerOrCompanyAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== UserRole.MANAGER && req.user?.role !== UserRole.ADMIN) {
    return res.status(403).json({ message: "Manager access required" });
  }
  next();
};

router.use(authenticate);

// Submission status overview
router.get("/submission-status", managerOrCompanyAdmin, getSubmissionStatus);

// Aggregated dashboard figures (redesign P06)
router.get("/overview", managerOrCompanyAdmin, getManagerOverview);

router.use(requireManager);

// User access management
router.get("/users", getManagerUsers);
router.get("/users/:userId/categories", getUserCategories);
router.put("/users/:userId/categories", updateUserCategories);

export default router;
