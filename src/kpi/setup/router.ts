/**
 * KPI-3 routes, behind requireKpiTracking (01-contracts §3):
 *   GET  /kpi/setup                any role of the company → {settings, frameworks, material_topics, kpis,
 *                                  assignments, recommended, available_frameworks, sites}
 *                                  (+ people, topic_grants, suggested_assignments for Admin/Superadmin)
 *   PUT  /kpi/setup                Admin, Superadmin: any subset of {settings, frameworks, material_topics,
 *                                  kpis, assignments} → the same shape as GET
 *   POST /kpi/setup/custom-kpis    Admin, Superadmin → 201 {definition}
 * A Superadmin passes company_id (query, or body).
 */
import { Router } from "express";
import { kpiCaller, type KpiRequest } from "../guard";
import { handle } from "../http";
import { createCustomKpi, getSetup, putSetup } from "./service";

const router = Router();
const caller = (req: unknown) => kpiCaller(req as KpiRequest);

router.get("/setup", handle("get setup", async (req, res) => res.json(await getSetup(caller(req)))));
router.put("/setup", handle("save setup", async (req, res) => res.json(await putSetup(caller(req), req.body))));
router.post("/setup/custom-kpis", handle("custom KPI", async (req, res) => res.status(201).json({ definition: await createCustomKpi(caller(req), req.body) })));

export default router;
