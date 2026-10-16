// S3-11 routes, mounted through src/scope3/router.ts (/scope3, behind authenticate).
import { Router } from "express";
import { getInvestments, getLeaseSites, postInvestment, postInvestmentsPlan, putInvestment, putLeaseSite } from "./controller";

const router = Router();

router.get("/investments", getInvestments);
router.post("/investments/plan", postInvestmentsPlan);
router.post("/investments", postInvestment);
router.put("/investments/:id", putInvestment);
router.get("/assets/sites", getLeaseSites);
router.put("/assets/sites/:id", putLeaseSite);

export default router;
