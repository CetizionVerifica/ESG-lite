/**
 * KPI-8 routes, behind requireKpiTracking (01-contracts §3):
 *   PUT  /kpi/values/approve {ids, only_ready?}           → {updated:[ids], refused:[{id, code}]}
 *   PUT  /kpi/values/reject  {ids, reason}                → {updated:[ids], refused:[{id, code}]}
 *   GET  /kpi/periods/lock?year=&period=&site=            → the period's status (sites, kpis, left)
 *   POST /kpi/periods/lock   {year, period?, site_id?}    → {lock, status}
 *   POST /kpi/periods/unlock {year, period?, site_id?, reason} → {lock, status}
 * A Superadmin passes company_id (query, or body).
 */
import { Router } from "express";
import { kpiCaller, type KpiRequest } from "../guard";
import { handle } from "../http";
import { reviewValues } from "./approve";
import { getPeriodStatus, lockPeriod, unlockPeriod } from "./lock";

const router = Router();
const caller = (req: unknown) => kpiCaller(req as KpiRequest);

router.put("/values/approve", handle("approve values", async (req, res) => res.json(await reviewValues(caller(req), "approve", req.body))));
router.put("/values/reject", handle("reject values", async (req, res) => res.json(await reviewValues(caller(req), "reject", req.body))));
router.get("/periods/lock", handle("period status", async (req, res) => res.json(await getPeriodStatus(caller(req), req.query))));
router.post("/periods/lock", handle("lock period", async (req, res) => res.json(await lockPeriod(caller(req), req.body))));
router.post("/periods/unlock", handle("unlock period", async (req, res) => res.json(await unlockPeriod(caller(req), req.body))));

export default router;
