import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { generateGhgReport } from "../reporting/ghg";
import type { GhgFilters, YearType, Frequency } from "../reporting/ghg-data";

// Parse a comma-separated list of ids from a query param into number[].
const parseIds = (v: unknown): number[] => {
  if (v == null) return [];
  const raw = Array.isArray(v) ? v.join(",") : String(v);
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
};

// GET /reports/ghg/:companyId  OR  GET /reports/ghg?siteIds=<csv>
//   Filters (matching the on-screen report):
//     ?siteIds=16,17           comma-separated (also accepts single ?siteId=16)
//     &categoryIds=3,4         comma-separated (optional)
//     &yearType=CY|FY          default CY
//     &year=2025
//     &compareYear=2024        optional
//     &download=1              force attachment download
export const ghgReport = async (req: Request, res: Response) => {
  try {
    // Site selection: siteIds (csv) with single-siteId fallback for back-compat.
    let siteIds = parseIds(req.query.siteIds);
    if (siteIds.length === 0 && req.query.siteId) {
      siteIds = parseIds(req.query.siteId);
    }
    if (siteIds.length === 0) {
      return res.status(400).json({ error: "siteIds (or siteId) required" });
    }

    // Resolve companyId from the first site (or explicit path param).
    let companyId = Number(req.params.companyId);
    if (!companyId) {
      const rows = await AppDataSource.query("SELECT company_id FROM site WHERE site_id=$1", [siteIds[0]]);
      companyId = rows[0]?.company_id;
    }
    if (!companyId) return res.status(400).json({ error: "could not resolve company for the given site" });

    const categoryIds = parseIds(req.query.categoryIds);
    const yearTypeRaw = String(req.query.yearType || "CY").toUpperCase();
    const yearType: YearType = yearTypeRaw === "FY" ? "FY" : "CY";
    const year = Number(req.query.year) || new Date().getFullYear();
    const compareYear = req.query.compareYear ? Number(req.query.compareYear) : undefined;

    const freqRaw = String(req.query.frequency || "yearly").toLowerCase();
    const frequency: Frequency =
      freqRaw === "monthly" ? "monthly" : freqRaw === "quarterly" ? "quarterly" : "yearly";

    const filters: GhgFilters = {
      siteIds,
      ...(categoryIds.length ? { categoryIds } : {}),
      yearType,
      year,
      ...(compareYear ? { compareYear } : {}),
      frequency,
    };

    const r = await generateGhgReport(filters, companyId);

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
