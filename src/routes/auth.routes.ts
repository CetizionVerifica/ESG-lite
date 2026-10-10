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
import { authRateLimit } from "../middlewares/rateLimit.middleware";
import {
  forgotPassword,
  resetPassword,
  verifyResetToken,
} from "../controllers/passwordReset.controller";

const router = Router();

// Authentication routes
router.post("/login", authRateLimit("login"), login);
router.get("/me", authenticate, getMe);
router.get("/me/appearance", authenticate, getMyAppearance);
router.put("/me/appearance", authenticate, updateMyAppearance);
router.post("/register", authenticate, requireSuperAdmin, register);

// Password reset routes (no authentication required)
// Rate limited per client IP (audit F-20): forgot-password counts every
// request (it always answers 200), the others count failed attempts.
router.post("/forgot-password", authRateLimit("forgot-password", "all"), forgotPassword);
router.post("/reset-password", authRateLimit("reset-password"), resetPassword);
router.get("/verify-reset-token/:token", authRateLimit("verify-reset-token"), verifyResetToken);

export default router;
