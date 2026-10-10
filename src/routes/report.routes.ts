import { Router } from "express";
import { ghgReport } from "../controllers/report.controller";
import { authenticateReport } from "../middlewares/reportAuth.middleware";
import { guardCompanyParam, guardQuerySites } from "../middlewares/scope.middleware";

const router = Router();

// Reports require a valid JWT (header or ?token= for browser downloads).
router.use(authenticateReport);

// Per-client branded GHG report (PDF) from emissions_db + brand config.
router.get("/ghg", guardQuerySites(), ghgReport); // ?siteId=<id> — resolves company from the site
router.get("/ghg/:companyId", guardCompanyParam("companyId"), guardQuerySites(), ghgReport);

export default router;
