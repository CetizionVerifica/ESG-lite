import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middlewares/auth.middleware";
import { requireSuperAdmin } from "../middlewares/role.middleware";
import {
  getBrand,
  getMyBrand,
  upsertBrand,
  uploadBrandLogo,
  uploadBrandDarkLogo,
} from "../controllers/brand.controller";

const router = Router();

// Logos are small; cap at 5MB, memory storage (streamed to Cloudinary).
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Any signed-in user can read their own company's brand (to theme the app);
// Superadmins can read any company's. getBrand checks the company.
router.get("/mine", authenticate, getMyBrand);
router.get("/:companyId", authenticate, getBrand);

// Brand management is superadmin-only (per-client onboarding/config).
router.use(authenticate, requireSuperAdmin);

router.put("/:companyId", upsertBrand);
router.post("/:companyId/logo", logoUpload.single("logo"), uploadBrandLogo);
router.post("/:companyId/logo-dark", logoUpload.single("logo"), uploadBrandDarkLogo);

export default router;
