import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { requireCompanyAdmin } from "../middlewares/role.middleware";
import {
  getCompanyUsers,
  getCompanySites,
  createCompanyUser,
  updateCompanyUser,
  deleteCompanyUser,
} from "../controllers/companyAdmin.controller";

const router = Router();

// Company Admin portal — scoped to the logged-in admin's own company.
router.use(authenticate, requireCompanyAdmin);

router.get("/users", getCompanyUsers);
router.post("/users", createCompanyUser);
router.patch("/users/:id", updateCompanyUser);
router.delete("/users/:id", deleteCompanyUser);

router.get("/sites", getCompanySites);

export default router;
