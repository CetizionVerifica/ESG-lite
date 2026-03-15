import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { requireManager } from "../middlewares/role.middleware";
import {
  getManagerUsers,
  getUserCategories,
  updateUserCategories,
} from "../controllers/managerUser.controller";

const router = Router();

router.use(authenticate, requireManager);

// User access management
router.get("/users", getManagerUsers);
router.get("/users/:userId/categories", getUserCategories);
router.put("/users/:userId/categories", updateUserCategories);

export default router;
