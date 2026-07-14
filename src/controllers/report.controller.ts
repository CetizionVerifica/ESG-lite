import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { generateGhgReport } from "../reporting/ghg";

// GET /reports/ghg/:companyId  OR  GET /reports/ghg?siteId=<id>
//   ?year=2025&frequency=yearly|monthly|quarterly&download=1
export const ghgReport = async (req: Request, res: Response) => {
  try {
    let companyId = Number(req.params.companyId);
    // Resolve company from a site the caller already knows (frontend has site ids).
    if (!companyId && req.query.siteId) {
      const rows = await AppDataSource.query("SELECT company_id FROM site WHERE site_id=$1", [Number(req.query.siteId)]);
      companyId = rows[0]?.company_id;
    }
    if (!companyId) return res.status(400).json({ error: "companyId or siteId required" });
    const year = Number(req.query.year) || new Date().getFullYear();
    const freq = String(req.query.frequency || "yearly").toLowerCase();
    const frequency = (["monthly", "quarterly", "yearly"].includes(freq) ? freq : "yearly") as any;

    const r = await generateGhgReport(companyId, year, frequency);

    if (req.query.download === "1" || req.query.download === "true") {
      return res.download(r.path, r.filename);
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${r.filename}"`);
    return res.sendFile(r.path);
  } catch (e: any) {
    console.error("GHG report error:", e);
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
};
