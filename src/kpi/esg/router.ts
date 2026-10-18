/**
 * D19 (wave E) route, behind requireKpiTracking (01-contracts §3):
 *   GET /kpi/esg?year=&site=&pillar=&topic=  → {year, year_type, label, filters, pillars, trends, sites, movers, pending_not_in}
 * Manager, Admin, Superadmin (a Superadmin passes company_id); a User → 403 KPI_FORBIDDEN.
 */
import { Router } from "express";
import { kpiCaller, type KpiRequest } from "../guard";
import { handle } from "../http";
import { esg } from "./service";

const router = Router();

router.get("/esg", handle("ESG dashboard", async (req, res) => res.json(await esg(kpiCaller(req as KpiRequest), req.query))));

export default router;
