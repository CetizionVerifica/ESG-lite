import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { requireManager } from "../middlewares/role.middleware";
import {
  getManagerUsers,
  getUserCategories,
  updateUserCategories,
} from "../controllers/managerUser.controller";
import { getSubmissionStatus } from "../controllers/submissionStatus.controller";
import { getManagerOverview } from "../controllers/managerOverview.controller";

const router = Router();

router.use(authenticate, requireManager);

// User access management
router.get("/users", getManagerUsers);
router.get("/users/:userId/categories", getUserCategories);
router.put("/users/:userId/categories", updateUserCategories);

// Submission status overview
router.get("/submission-status", getSubmissionStatus);

// Aggregated dashboard figures (redesign P06)
router.get("/overview", getManagerOverview);

export default router;
