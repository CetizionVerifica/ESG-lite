/**
 * KPI-4 routes, behind requireKpiTracking (01-contracts §3):
 *   GET    /kpi/values?kpi=&site=&from=&to=&status=&frequency=   → {values}
 *   PUT    /kpi/values {items}                                   → {saved, results:[{index, ok, value | code, message, details}]}
 *   POST   /kpi/values/submit {ids}                              → {submitted:[ids], refused:[{id, code}]}
 *   POST   /kpi/values/:id/evidence  multipart `file`, or JSON {document_url, document_name} → 201 {evidence}
 *   DELETE /kpi/values/:id/evidence/:eid                         → {removed}
 * A Superadmin passes company_id (query, or body for JSON).
 */
import { Router } from "express";
import multer from "multer";
import { KpiIdsSchema, KpiValuesPutSchema } from "../contracts/schemas";
import { kpiCaller, type KpiRequest } from "../guard";
import { handle, parse, routeId } from "../http";
import { withUploadErrors } from "../../middlewares/upload.middleware";
import { addEvidence, removeEvidence } from "./evidence";
import { listValues, submit, upsertDrafts } from "./service";

const evidenceUpload = withUploadErrors(multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }).single("file"));

const router = Router();
const caller = (req: unknown) => kpiCaller(req as KpiRequest);

router.get("/values", handle("list values", async (req, res) => res.json(await listValues(caller(req), req.query))));
router.put("/values", handle("save values", async (req, res) => {
  const body = parse(KpiValuesPutSchema, req.body ?? {});
  res.json(await upsertDrafts(caller(req), body.items));
}));
router.post("/values/submit", handle("submit values", async (req, res) => {
  const body = parse(KpiIdsSchema, req.body ?? {});
  res.json(await submit(caller(req), body.ids));
}));
router.post("/values/:id/evidence", evidenceUpload, handle("add evidence", async (req, res) => {
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  res.status(201).json({ evidence: await addEvidence(caller(req), routeId(req.params.id), file, req.body) });
}));
router.delete("/values/:id/evidence/:eid", handle("remove evidence", async (req, res) => res.json(await removeEvidence(caller(req), routeId(req.params.id), routeId(req.params.eid)))));

export default router;
