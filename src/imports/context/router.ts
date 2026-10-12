import { Router } from "express";
import { getImportActivities, getImportContext, getImportReadiness } from "./controller";

// IM3 routes, mounted by src/imports/router.ts (already behind `authenticate`).
const router = Router();
router.get("/context", getImportContext);
router.get("/context/activities", getImportActivities);
router.get("/readiness", getImportReadiness);

export default router;
