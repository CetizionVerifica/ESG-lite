import { Response } from "express";
import * as XLSX from "xlsx";
import { AppDataSource } from "../config/data-source";
import { Emission, EmissionStatus } from "../entities/Emission";
import { AuthRequest } from "../middlewares/auth.middleware";
import { log } from "../utils/logger";

const repo = AppDataSource.getRepository(Emission);

/**
 * GET /user/emissions/export
 * Downloads monthly emission data as a professional Excel (.xlsx)
 * Query params: siteId (required), year (required), month (required), categoryId, status
 */
export const exportEmissions = async (req: AuthRequest, res: Response) => {
  try {
    const { siteId, categoryId, year, month, status } = req.query;

    if (!siteId || !year || !month) {
      return res.status(400).json({ message: "siteId, year, and month are required" });
    }

    const y = parseInt(year as string);
    const m = parseInt(month as string);
    const startDate = new Date(y, m - 1, 1);
    const endDate = new Date(y, m, 0);
    const monthName = new Date(y, m - 1).toLocaleDateString("en-US", { month: "long" });

    // Fetch main emissions (exclude FERA)
    const qb = repo
      .createQueryBuilder("emission")
      .leftJoinAndSelect("emission.site", "site")
      .leftJoinAndSelect("emission.category", "category")
      .leftJoinAndSelect("emission.reviewed_by", "reviewed_by")
      .leftJoinAndSelect("emission.created_by", "created_by")
      .where("site.site_id = :siteId", { siteId: parseInt(siteId as string) })
      .andWhere("emission.date_of_reporting >= :startDate", { startDate })
      .andWhere("emission.date_of_reporting <= :endDate", { endDate })
      .andWhere("LOWER(category.category_name) != :fera", { fera: "fera" });

    if (categoryId) {
      qb.andWhere("category.category_id = :categoryId", { categoryId: parseInt(categoryId as string) });
    }
    if (status) {
      qb.andWhere("emission.status = :status", { status: status as string });
    }

    qb.orderBy("category.category_name", "ASC")
      .addOrderBy("emission.date_of_reporting", "ASC")
      .take(10000);

    const emissions = await qb.getMany();

    if (emissions.length === 0) {
      return res.status(404).json({ message: "No emissions found for the selected filters" });
    }

    // Fetch FERA entries for inline column
    const feraEmissions = await repo
      .createQueryBuilder("e")
      .leftJoin("e.category", "category")
      .where("LOWER(category.category_name) = :fera", { fera: "fera" })
      .andWhere("e.date_of_reporting >= :startDate AND e.date_of_reporting <= :endDate", { startDate, endDate })
      .andWhere("e.site = :siteId", { siteId: parseInt(siteId as string) })
      .getMany();

    const feraMap = new Map<number, Emission>();
    for (const fe of feraEmissions) {
      if (fe.fera_linked_id) feraMap.set(fe.fera_linked_id, fe);
    }

    // Flatten activity_data keys to find all unique keys across emissions
    const allActivityKeys = new Set<string>();
    for (const e of emissions) {
      if (e.activity_data) {
        for (const key of Object.keys(e.activity_data)) {
          if (!key.startsWith("_")) allActivityKeys.add(key);
        }
      }
    }
    const activityKeysList = Array.from(allActivityKeys);

    // ── Build the sheet data ─────────────────────────────────────────────
    const siteName = emissions[0]?.site?.name || "Unknown Site";
    const statusLabel = status ? String(status).charAt(0).toUpperCase() + String(status).slice(1) : "All";

    // Summary rows at top
    const summaryRows: (string | number)[][] = [
      ["ESG Pro — Emission Data Export"],
      [],
      ["Site:", siteName, "", "Month:", `${monthName} ${y}`],
      ["Status Filter:", statusLabel, "", "Exported:", new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })],
      ["Total Entries:", emissions.length, "", "Exported By:", req.user?.userId || ""],
      [],
    ];

    // Column headers
    const headers = [
      "#",
      "Category",
      "Scope",
      ...activityKeysList,
      "Activity Unit",
      "Emission (tCO2e)",
      "FERA (tCO2e)",
      "Date of Reporting",
      "Status",
      "Review Comment",
      "Submitted By",
      "Reviewed By",
      "Submitted At",
    ];

    // Data rows
    const dataRows = emissions.map((e, idx) => {
      const ad = e.activity_data || {};
      const feraEntry = feraMap.get(e.pk_id);

      return [
        idx + 1,
        e.category?.category_name || "",
        (e.category as any)?.scope || "",
        ...activityKeysList.map((key) => ad[key] ?? ""),
        e.activity_data_unit || "",
        Number(e.total_emission),
        feraEntry ? Number(feraEntry.total_emission) : "",
        e.date_of_reporting
          ? new Date(e.date_of_reporting).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : "",
        e.status ? e.status.charAt(0).toUpperCase() + e.status.slice(1) : "",
        e.review_comment || "",
        `${e.created_by?.name || ""}`.trim(),
        `${e.reviewed_by?.name || ""}`.trim(),
        e.created_at
          ? new Date(e.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : "",
      ];
    });

    // Totals row
    const emissionColIdx = headers.indexOf("Emission (tCO2e)");
    const feraColIdx = headers.indexOf("FERA (tCO2e)");
    const totalEmission = emissions.reduce((sum, e) => sum + Number(e.total_emission || 0), 0);
    const totalFera = emissions.reduce((sum, e) => {
      const fe = feraMap.get(e.pk_id);
      return sum + (fe ? Number(fe.total_emission || 0) : 0);
    }, 0);

    const totalsRow = new Array(headers.length).fill("");
    totalsRow[0] = "";
    totalsRow[1] = "TOTAL";
    totalsRow[emissionColIdx] = Math.round(totalEmission * 100) / 100;
    if (totalFera > 0) totalsRow[feraColIdx] = Math.round(totalFera * 100) / 100;
    totalsRow[headers.indexOf("Status")] = `${emissions.length} entries`;

    // Combine all
    const allRows = [
      ...summaryRows,
      headers,
      ...dataRows,
      [],
      totalsRow,
    ];

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(allRows);

    // Column widths
    ws["!cols"] = headers.map((h, i) => {
      let maxLen = h.length;
      for (const row of dataRows) {
        const val = String(row[i] ?? "");
        if (val.length > maxLen) maxLen = val.length;
      }
      return { wch: Math.min(Math.max(maxLen + 2, 8), 45) };
    });

    // Merge the title row across all columns
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    ];

    // Create workbook
    const wb = XLSX.utils.book_new();
    const sheetName = `${monthName.substring(0, 3)} ${y}`;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const statusSuffix = status ? `_${status}` : "";
    const fileName = `${siteName.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_")}_${monthName}_${y}${statusSuffix}.xlsx`;

    log.info("Export", "Monthly data download", {
      siteId, year: y, month: m, status: status || "all",
      rows: emissions.length, userId: req.user?.userId,
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    log.error("Export", "Download failed", { error: (error as Error).message });
    return res.status(500).json({ message: "Failed to export data" });
  }
};
