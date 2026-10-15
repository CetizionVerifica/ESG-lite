// S3-9 routes, mounted through src/scope3/router.ts (/scope3, behind authenticate).
import { Router } from "express";
import { getCommutingSites, postCommutingSurvey } from "./controller";

const router = Router();

router.get("/commuting/sites", getCommutingSites);
router.post("/commuting/surveys", postCommutingSurvey);

export default router;
