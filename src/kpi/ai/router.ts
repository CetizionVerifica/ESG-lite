/**
 * KPI-12 routes, behind requireKpiTracking (01-contracts §3; service.ts has the shapes):
 *   POST /kpi/ai/suggest-values    JSON {document_id, site_id?, period?, kpis?} or multipart `file` + fields
 *                                  (the caller's own due KPIs) → {available, …, suggestions}
 *   POST /kpi/ai/suggest-mapping   {name, question, unit?, topic} (Admin, Superadmin) → {available, suggestions}
 * A Superadmin passes company_id (in the query for multipart).
 */
import { Router } from "express";
import multer from "multer";
import { withUploadErrors } from "../../middlewares/upload.middleware";
import { kpiCaller, type KpiRequest } from "../guard";
import { handle } from "../http";
import { suggestMapping, suggestValues } from "./service";

const documentUpload = withUploadErrors(multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }).single("file"));

const router = Router();
const caller = (req: unknown) => kpiCaller(req as KpiRequest);

router.post("/ai/suggest-values", documentUpload, handle("AI value suggestions", async (req, res) => {
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  res.json(await suggestValues(caller(req), req.body, file, req.headers.authorization));
}));
router.post("/ai/suggest-mapping", handle("AI mapping suggestions", async (req, res) => res.json(await suggestMapping(caller(req), req.body))));

export default router;
