import { Router } from "express";
import { login, register } from "../controllers/auth.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { requireSuperAdmin } from "../middlewares/role.middleware";

const router = Router();

router.post("/login", login);
router.post("/register", authenticate, requireSuperAdmin, register);

export default router;
