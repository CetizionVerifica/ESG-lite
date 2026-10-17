/**
 * KPI-11 route, behind requireKpiTracking (01-contracts §3):
 *   GET /kpi/reports/:framework?year=&sites=&format=json|xlsx|pdf
 *     json  → {report, audit_trail}
 *     xlsx  → the framework's workbook (GRI content index, BRSR tables or ESRS datapoints,
 *             plus "Audit trail")
 *     pdf   → the GRI content index (GRI only; else 400 KPI_VALIDATION)
 * Manager, Admin, Superadmin. Like the GHG report it also accepts the token as
 * `?token=` (src/kpi/auth.ts), so a browser tab can download it.
 */
import { Router } from "express";
import { KpiError } from "../contracts/errors";
import { kpiCaller, type KpiRequest } from "../guard";
import { handle } from "../http";
import { brsrSheets } from "./brsr";
import { esrsSheets } from "./esrs";
import { griSheets } from "./gri";
import { griPdf } from "./griPdf";
import { loadReport } from "./load";
import { fileSafe, workbook } from "./xlsx";

const router = Router();

router.get("/reports/:framework", handle("framework report", async (req, res) => {
  const { model, audit_trail, format } = await loadReport(kpiCaller(req as KpiRequest), String(req.params.framework), req.query);
  const base = `${model.framework}-${fileSafe(model.company.name)}-${fileSafe(model.label)}`;
  if (format === "json") return res.json({ report: model, audit_trail });
  if (format === "pdf") {
    if (model.framework !== "GRI") throw new KpiError("KPI_VALIDATION", { issues: [{ path: "format", message: "PDF is for the GRI content index only." }] });
    const pdf = await griPdf(model, audit_trail);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${base}-content-index.pdf"`);
    return res.send(pdf);
  }
  const sheets = model.framework === "GRI" ? griSheets(model, audit_trail) : model.framework === "BRSR" ? brsrSheets(model, audit_trail) : esrsSheets(model, audit_trail);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${base}.xlsx"`);
  return res.send(workbook(sheets));
}));

export default router;
