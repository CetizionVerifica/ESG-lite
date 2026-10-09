import { Router } from "express";
import {
  login,
  register,
  getMe,
  getMyAppearance,
  updateMyAppearance,
} from "../controllers/auth.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { requireSuperAdmin } from "../middlewares/role.middleware";
import {
  forgotPassword,
  resetPassword,
  verifyResetToken,
} from "../controllers/passwordReset.controller";

const router = Router();

// Authentication routes
router.post("/login", login);
router.get("/me", authenticate, getMe);
router.get("/me/appearance", authenticate, getMyAppearance);
router.put("/me/appearance", authenticate, updateMyAppearance);
router.post("/register", authenticate, requireSuperAdmin, register);

// Password reset routes (no authentication required)
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/verify-reset-token/:token", verifyResetToken);

export default router;
