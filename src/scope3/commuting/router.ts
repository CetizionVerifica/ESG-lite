// S3-9 routes, mounted through src/scope3/router.ts (/scope3, behind authenticate).
import { Router } from "express";
import { postCommutingSurvey } from "./controller";

const router = Router();

router.post("/commuting/surveys", postCommutingSurvey);

export default router;
