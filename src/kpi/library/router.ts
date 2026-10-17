/**
 * KPI-2 routes. Library CRUD under /kpi/library/* is Superadmin only and sits
 * before the switch (it is global, not a client's data); /kpi/catalogue sits
 * behind requireKpiTracking (any role of a switched-on company).
 *
 *   GET  /kpi/library/frameworks                 POST, PUT /:id
 *   GET  /kpi/library/definitions?framework=&topic=&source=&active=   GET /:id   POST, PUT /:id
 *   GET  /kpi/library/disclosures?framework=&framework_id=            POST, PUT /:id
 *   GET  /kpi/library/mappings?framework=&kpi=                        POST, PUT /:id
 *   GET  /kpi/library/coverage
 *   GET  /kpi/catalogue
 * No DELETE: retire a framework or KPI with `active: false`.
 */
import { Router } from "express";
import { kpiCaller, requireKpiSuperadmin, type KpiRequest } from "../guard";
import { handle, routeId } from "../http";
import * as lib from "./service";

const uid = (req: KpiRequest) => Number(req.user?.userId) || 0;

export const libraryRouter = Router();
const L = "/library";
libraryRouter.get(`${L}/frameworks`, requireKpiSuperadmin, handle("list frameworks", async (_req, res) => res.json({ frameworks: await lib.listFrameworks() })));
libraryRouter.post(`${L}/frameworks`, requireKpiSuperadmin, handle("create framework", async (req, res) => res.status(201).json({ framework: await lib.createFramework(req.body, uid(req)) })));
libraryRouter.put(`${L}/frameworks/:id`, requireKpiSuperadmin, handle("update framework", async (req, res) => res.json({ framework: await lib.updateFramework(routeId(req.params.id), req.body, uid(req)) })));

libraryRouter.get(`${L}/definitions`, requireKpiSuperadmin, handle("list definitions", async (req, res) => res.json({ definitions: await lib.listDefinitions(req.query) })));
libraryRouter.get(`${L}/definitions/:id`, requireKpiSuperadmin, handle("get definition", async (req, res) => res.json({ definition: await lib.getDefinition(routeId(req.params.id)) })));
libraryRouter.post(`${L}/definitions`, requireKpiSuperadmin, handle("create definition", async (req, res) => res.status(201).json({ definition: await lib.createDefinition(req.body, uid(req)) })));
libraryRouter.put(`${L}/definitions/:id`, requireKpiSuperadmin, handle("update definition", async (req, res) => res.json({ definition: await lib.updateDefinition(routeId(req.params.id), req.body, uid(req)) })));

libraryRouter.get(`${L}/disclosures`, requireKpiSuperadmin, handle("list disclosures", async (req, res) => res.json({ disclosures: await lib.listDisclosures(req.query) })));
libraryRouter.post(`${L}/disclosures`, requireKpiSuperadmin, handle("create disclosure", async (req, res) => res.status(201).json({ disclosure: await lib.createDisclosure(req.body, uid(req)) })));
libraryRouter.put(`${L}/disclosures/:id`, requireKpiSuperadmin, handle("update disclosure", async (req, res) => res.json({ disclosure: await lib.updateDisclosure(routeId(req.params.id), req.body, uid(req)) })));

libraryRouter.get(`${L}/mappings`, requireKpiSuperadmin, handle("list mappings", async (req, res) => res.json({ mappings: await lib.listMappings(req.query) })));
libraryRouter.post(`${L}/mappings`, requireKpiSuperadmin, handle("create mapping", async (req, res) => res.status(201).json({ mapping: await lib.createMapping(req.body, uid(req)) })));
libraryRouter.put(`${L}/mappings/:id`, requireKpiSuperadmin, handle("update mapping", async (req, res) => res.json({ mapping: await lib.updateMapping(routeId(req.params.id), req.body, uid(req)) })));

libraryRouter.get(`${L}/coverage`, requireKpiSuperadmin, handle("library coverage", async (_req, res) => res.json({ coverage: await lib.libraryCoverage() })));

/** Behind requireKpiTracking. */
export const catalogueRouter = Router();
catalogueRouter.get("/catalogue", handle("catalogue", async (req, res) => res.json(await lib.catalogue(kpiCaller(req as KpiRequest).companyId))));
