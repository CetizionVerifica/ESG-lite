import { Router } from "express";
import { ghgReport } from "../controllers/report.controller";
import { authenticateReport } from "../middlewares/reportAuth.middleware";

const router = Router();

// Reports require a valid JWT (header or ?token= for browser downloads).
router.use(authenticateReport);

// Per-client branded GHG report (PDF) from emissions_db + brand config.
router.get("/ghg", ghgReport); // ?siteId=<id> — resolves company from the site
router.get("/ghg/:companyId", ghgReport);

export default router;
