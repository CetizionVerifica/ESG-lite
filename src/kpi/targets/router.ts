/**
 * KPI-9 routes, behind requireKpiTracking (01-contracts §3):
 *   GET    /kpi/targets?kpi=&site=   → {targets: [target with progress and series]}
 *   PUT    /kpi/targets {id?, kpi_definition_id, site_id?, baseline_year, baseline_value,
 *                        target_year, target_value, direction, note?}  → {target}
 *   DELETE /kpi/targets/:id          → {removed: id}
 * A Superadmin passes company_id (query, or body).
 */
import { Router } from "express";
import { kpiCaller, type KpiRequest } from "../guard";
import { handle, routeId } from "../http";
import { deleteTarget, listTargets, putTarget } from "./service";

const router = Router();
const caller = (req: unknown) => kpiCaller(req as KpiRequest);

router.get("/targets", handle("list targets", async (req, res) => res.json(await listTargets(caller(req), req.query))));
router.put("/targets", handle("save target", async (req, res) => res.json(await putTarget(caller(req), req.body))));
router.delete("/targets/:id", handle("delete target", async (req, res) => res.json(await deleteTarget(caller(req), routeId(req.params.id)))));

export default router;
