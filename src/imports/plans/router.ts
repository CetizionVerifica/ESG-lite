import { Router } from "express";
import { appendRows, cancelPlan, commitPlan, createPlan, getPlan, listBatches, patchPlan } from "./controller";

// Mounted by src/imports/router.ts under /imports (already authenticated).
// Role and client scoping happen in the service (scope.ts), per contracts §4.
const router = Router();

router.post("/plans", createPlan);
router.post("/plans/:id/rows", appendRows);
router.get("/plans/:id", getPlan);
router.patch("/plans/:id", patchPlan);
router.post("/plans/:id/commit", commitPlan);
router.post("/plans/:id/cancel", cancelPlan);
router.get("/batches", listBatches);

export default router;
