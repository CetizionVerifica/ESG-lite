/**
 * KPI tracking API (KPI-0): mounted once at `/kpi` in src/index.ts, behind
 * `authenticate`. Each module appends ONE `router.use` line here, in module
 * order, and keeps its own routes in its folder (docs/kpi/00-plan.md §8):
 *   router.use(libraryRouter); // KPI-2
 */
import { Router } from "express";

const router = Router();

// KPI-0: answers off until KPI-1 adds the switch.
router.get("/status", (_req, res) => res.json({ enabled: false, setup_completed: false }));

export default router;
