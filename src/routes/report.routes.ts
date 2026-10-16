import { Router } from "express";
import { ghgReport, ghgScope3 } from "../controllers/report.controller";
import { authenticateReport } from "../middlewares/reportAuth.middleware";
import { guardCompanyParam, guardQuerySites } from "../middlewares/scope.middleware";

const router = Router();

// Reports require a valid JWT (header or ?token= for browser downloads).
router.use(authenticateReport);

// Per-client branded GHG report (PDF) from emissions_db + brand config.
// S3-13: Scope 3 by GHG Protocol category (JSON). Before /ghg/:companyId.
router.get("/ghg/scope3", guardQuerySites(), ghgScope3);
router.get("/ghg/scope3/:companyId", guardCompanyParam("companyId"), guardQuerySites(), ghgScope3);
router.get("/ghg", guardQuerySites(), ghgReport); // ?siteId=<id> — resolves company from the site
router.get("/ghg/:companyId", guardCompanyParam("companyId"), guardQuerySites(), ghgReport);

export default router;
