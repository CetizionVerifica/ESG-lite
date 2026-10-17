/**
 * KPI tracking API (KPI-0): mounted once at `/kpi` in src/index.ts, behind
 * `authenticate`. Each module appends ONE `router.use` line here, in module
 * order, and keeps its own routes in its folder (docs/kpi/00-plan.md §8).
 *
 * Order matters: GET /kpi/status and /kpi/library/* (Superadmin) come before
 * `requireKpiTracking`; every other route sits behind it (layer rule 1).
 */
import { Router } from "express";
import { kpiStatus, requireKpiTracking } from "./guard";
import { catalogueRouter, libraryRouter } from "./library/router";
import valuesRouter from "./values/router";
import setupRouter from "./setup/router";
import autoRouter from "./auto/router";
import { myRouter } from "./values/my";
import reviewRouter from "./review/router";

const router = Router();

router.get("/status", kpiStatus); // KPI-1: {enabled, setup_completed}, answers when off
router.use(libraryRouter); // KPI-2: /kpi/library/* (Superadmin; not behind the switch)
router.use(requireKpiTracking); // KPI-1: 403 KPI_TRACKING_OFF below this line
router.use(catalogueRouter); // KPI-2: /kpi/catalogue
router.use(valuesRouter); // KPI-4: /kpi/values, /kpi/values/submit, /kpi/values/:id/evidence
router.use(setupRouter); // KPI-3: /kpi/setup, /kpi/setup/custom-kpis
router.use(autoRouter); // KPI-5: /kpi/auto/refresh
router.use(myRouter); // KPI-7 (backend part): /kpi/my
router.use(reviewRouter); // KPI-8: /kpi/values/approve|reject, /kpi/periods/lock|unlock

export default router;
