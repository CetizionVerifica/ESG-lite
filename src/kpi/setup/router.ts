/**
 * KPI-3 routes, behind requireKpiTracking (01-contracts §3):
 *   GET  /kpi/setup                any role of the company → {settings, frameworks, material_topics, kpis,
 *                                  assignments, recommended (ids), recommended_reasons, available_frameworks, sites}
 *                                  (+ people, topic_grants, suggested_assignments for Admin/Superadmin)
 *   PUT  /kpi/setup                Admin, Superadmin: any subset of {settings, frameworks, material_topics,
 *                                  kpis, assignments} → the same shape as GET
 *   POST /kpi/setup/custom-kpis    Admin, Superadmin → 201 {definition}
 *   POST /kpi/setup/invite         Admin, Superadmin → {notified}: a kpi_assigned notification to each owner
 *   GET  /kpi/people/:user_id/topics   D17: {user_id, topics, by_site:[{site_id, site_name, topics}]}
 *   PUT  /kpi/people/:user_id/topics   D17 (Admin, Superadmin; a Manager for their own sites):
 *                                  {topics, site_ids?} → {user_id, topics, site_ids, moved:[{site_id, site_name, topic, topic_label, from_user_id, from_name}]}
 * A Superadmin passes company_id (query, or body).
 */
import { Router } from "express";
import { kpiCaller, type KpiRequest } from "../guard";
import { handle, routeId } from "../http";
import { getPeopleTopics, putPeopleTopics } from "./topics";
import { createCustomKpi, getSetup, inviteTeam, putSetup } from "./service";

const router = Router();
const caller = (req: unknown) => kpiCaller(req as KpiRequest);

router.get("/setup", handle("get setup", async (req, res) => res.json(await getSetup(caller(req)))));
router.put("/setup", handle("save setup", async (req, res) => res.json(await putSetup(caller(req), req.body))));
router.post("/setup/invite", handle("invite team", async (req, res) => res.json(await inviteTeam(caller(req)))));
router.post("/setup/custom-kpis", handle("custom KPI", async (req, res) => res.status(201).json({ definition: await createCustomKpi(caller(req), req.body) })));

router.get("/people/:user_id/topics", handle("people topics", async (req, res) => res.json(await getPeopleTopics(caller(req), routeId(req.params.user_id)))));
router.put("/people/:user_id/topics", handle("save people topics", async (req, res) => res.json(await putPeopleTopics(caller(req), routeId(req.params.user_id), req.body))));

export default router;
