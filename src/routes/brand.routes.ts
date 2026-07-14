import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middlewares/auth.middleware";
import { requireSuperAdmin } from "../middlewares/role.middleware";
import { getBrand, upsertBrand, uploadBrandLogo } from "../controllers/brand.controller";

const router = Router();

// Logos are small; cap at 5MB, memory storage (streamed to Cloudinary).
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Brand management is superadmin-only (per-client onboarding/config).
router.use(authenticate, requireSuperAdmin);

router.get("/:companyId", getBrand);
router.put("/:companyId", upsertBrand);
router.post("/:companyId/logo", logoUpload.single("logo"), uploadBrandLogo);

export default router;
