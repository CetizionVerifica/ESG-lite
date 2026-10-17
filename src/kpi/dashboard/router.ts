/**
 * KPI-10 routes, behind requireKpiTracking (01-contracts §3):
 *   GET  /kpi/dashboard?year=&framework=&site=&topic=  → {year, year_type, label, filters, coverage, gaps, cards, pending_not_in}
 *   POST /kpi/dashboard/remind {kpi, site}             → {sent, notified, already_today}
 * Manager, Admin, Superadmin (a Superadmin passes company_id).
 */
import { Router } from "express";
import { kpiCaller, type KpiRequest } from "../guard";
import { handle } from "../http";
import { remind } from "./remind";
import { dashboard } from "./service";

const router = Router();
const caller = (req: unknown) => kpiCaller(req as KpiRequest);

router.get("/dashboard", handle("dashboard", async (req, res) => res.json(await dashboard(caller(req), req.query))));
router.post("/dashboard/remind", handle("remind", async (req, res) => res.json(await remind(caller(req), req.body))));

export default router;
