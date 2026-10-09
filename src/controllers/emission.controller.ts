import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Emission, EmissionStatus } from "../entities/Emission";
import { EmissionFactor } from "../entities/EmissionFactor";
import { Site } from "../entities/Site";
import { AuthRequest } from "../middlewares/auth.middleware";
import { In } from "typeorm";
import { ProductionData, ProductionDataStatus } from "../entities/ProductionData";
import { EmissionDocument } from "../entities/EmissionDocument";
import { findEmissionFactorForCategory } from "../utils/findEmissionFactor";
import { getUsdRate } from "../services/fxRate";
import * as XLSX from "xlsx";
import { AuditLog } from "../entities/AuditLog";
import { User } from "../entities/User";
import { UserRole } from "../types/type";
import axios from "axios";
import { sendToQueue } from "../queues/emailProducer";
import { log } from "../utils/logger";
import { createNotification } from "../services/notificationService";
import { validatePeriodFields, findModeLockConflict } from "../services/reportingPeriod";
import { getCalculationSpec, computeSpecActivityValue, specIdentityMatches } from "../services/calculationSpec";
import { ColumnConfig } from "../entities/ColumnConfig";
import { computeBreakdown, type BreakdownSourceRow } from "../services/emissionBreakdown";
import { parseSiteIds } from "../utils/parseSiteIds";
import { scopeSiteIds, siteFilterSql, SITE_ACCESS_DENIED } from "../utils/companyScope";
import {
  computeGhgTables,
  computeGhgDetails,
  type GhgFilters,
} from "../reporting/ghg-data";

const repo = AppDataSource.getRepository(Emission);
const emissionFactorRepo = AppDataSource.getRepository(EmissionFactor);
const siteRepo = AppDataSource.getRepository(Site);
const columnConfigRepo = AppDataSource.getRepository(ColumnConfig);

// Common unit conversions
const unitConversions: Record<string, Record<string, number>> = {
  // Volume
  litre: { gallon: 0.264172, ml: 1000, "cubic meter": 0.001, "kilo litre": 0.001, kl: 0.001 },
  kl: { litre: 1000, gallon: 264.172, ml: 1000000, "cubic meter": 1 },
  "kilo litre": { litre: 1000, gallon: 264.172, ml: 1000000, "cubic meter": 1 },
  gallon: { litre: 3.78541, ml: 3785.41, "cubic meter": 0.00378541, kl: 0.00378541 },
  ml: { litre: 0.001, gallon: 0.000264172, kl: 0.000001 },
  "cubic meter": { litre: 1000, gallon: 264.172, kl: 1 },
  // Weight
  //
  kg: { lb: 2.20462, tonne: 0.001, g: 1000, ton: 0.00110231, tonnes : 0.001 },
  lb: { kg: 0.453592, tonne: 0.000453592, g: 453.592, tonnes : 0.000453592 },
  ton: {kg: 907.185, lb: 2000, g: 907185},
  tonne: { kg: 1000, lb: 2204.62, g: 1000000 , tonnes : 1},
  Tonnes : { kg: 1000, lb: 2204.62, g: 1000000, tonne : 1 },
  tonnes: { kg: 1000, lb: 2204.62, g: 1000000, tonne: 1 }, 
  g: { kg: 0.001, lb: 0.00220462 },
  // Energy
  kwh: { mwh: 0.001, gj: 0.0036, mj: 3.6 },
  mwh: { kwh: 1000, gj: 3.6, mj: 3600 },
  gj: { kwh: 277.778, mwh: 0.277778, mj: 1000 },
  mj: { kwh: 0.277778, gj: 0.001 },
  // Currency — seed values only. These are refreshed from the live FX service
  // below (refreshCurrencyRates), because a frozen rate silently skews every
  // spend-based Scope 3 figure: the previous hardcoded 83.5 had drifted ~15%
  // from the real rate, inflating every INR spend line by the same 15%.
  inr: { usd: 1 / 95.77 },
  usd: { inr: 95.77, eur: 0.86 },
  eur: { usd: 1 / 0.86 },

  "tonne.km": { "kg.km": 1000, "g.km": 1000000 },
"kg.km": { "tonne.km": 0.001, "g.km": 1000 },
"g.km": { "tonne.km": 0.000001, "kg.km": 0.001},
};

//comment

// Keep the currency rows of `unitConversions` in step with the live market.
// Done as a periodic refresh rather than an async lookup so that
// getConversionFactor stays synchronous and no call site has to change.
// Both directions are written as exact inverses, so converting INR->USD->INR
// can no longer drift (the old table had 0.012 vs 83.5, which did not agree).
async function refreshCurrencyRates(): Promise<void> {
  try {
    const [inr, eur] = await Promise.all([getUsdRate("INR"), getUsdRate("EUR")]);
    unitConversions.usd.inr = inr.rate;
    unitConversions.inr.usd = 1 / inr.rate;
    unitConversions.usd.eur = eur.rate;
    unitConversions.eur.usd = 1 / eur.rate;
  } catch (err) {
    console.warn("[fx] Could not refresh currency rates; keeping previous values.", err);
  }
}
void refreshCurrencyRates();
setInterval(refreshCurrencyRates, 12 * 60 * 60 * 1000).unref?.();

// Get conversion factor between two units
const getConversionFactor = (fromUnit: string, toUnit: string): number | null => {
  const from = fromUnit?.toLowerCase().trim();
  const to = toUnit?.toLowerCase().trim();
  return unitConversions[from]?.[to] || null;
};

// Check if units match (handles null/undefined like frontend)
const unitsMatchExact = (unit1: string | null | undefined, unit2: string | null | undefined): boolean => {
  if (!unit1 || !unit2) return true; // Treat null/undefined as match (like frontend)
  return unit1.toLowerCase().trim() === unit2.toLowerCase().trim();
};

// Ledger sort keys for GET /user/emissions?sort= (redesign B6) → column.
// A Map, not an object literal: a plain lookup would also accept inherited
// keys such as "__proto__" or "constructor".
const EMISSION_SORTS = new Map<string, string>([
  ["id", "emission.pk_id"],
  ["date", "emission.date_of_reporting"],
  ["total_emission", "emission.total_emission"],
  ["status", "emission.status"],
  ["category", "category.category_name"],
  ["scope", "category.scope"],
  ["site", "site.name"],
  ["submitted_by", "created_by.name"],
  ["created_at", "emission.created_at"],
  ["reviewed_at", "emission.reviewed_at"],
]);

// Free-text ledger search (B6): case-insensitive match on category, site,
// submitter, units, review comment and the entered activity values, or the
// exact entry id. Activity data matches on its values (at any depth), never on
// key names. Aliases differ between the list and summary queries.
const emissionSearchSql = (a: { e: string; c: string; s: string; u: string }) =>
  `(${a.c}.category_name ILIKE :search ESCAPE '\\'
    OR ${a.s}.name ILIKE :search ESCAPE '\\'
    OR ${a.u}.name ILIKE :search ESCAPE '\\'
    OR ${a.u}.last_name ILIKE :search ESCAPE '\\'
    OR ${a.u}.email ILIKE :search ESCAPE '\\'
    OR ${a.e}.unit ILIKE :search ESCAPE '\\'
    OR ${a.e}.activity_data_unit ILIKE :search ESCAPE '\\'
    OR ${a.e}.review_comment ILIKE :search ESCAPE '\\'
    OR EXISTS (SELECT 1 FROM jsonb_path_query(CAST(${a.e}.activity_data AS jsonb), 'strict $.**') AS v(val)
               WHERE jsonb_typeof(v.val) IN ('string', 'number', 'boolean')
                 AND (v.val #>> '{}') ILIKE :search ESCAPE '\\')
    OR CAST(${a.e}.pk_id AS text) = :searchExact)`;

// Get emissions by site, category, and date (with optional pagination).
// Optional sort=<EMISSION_SORTS key>&order=asc|desc and search=<text>; without
// them the result is exactly as before (newest id first, no text filter).
export const getEmissions = async (req: AuthRequest, res: Response) => {
  try {
    const { categoryId, date, year, month, page, limit, status, scope, sort, order } = req.query;
    const siteIds = parseSiteIds(req.query as { siteIds?: unknown; siteId?: unknown });

    if (sort !== undefined && !EMISSION_SORTS.has(String(sort))) {
      return res.status(400).json({ message: `sort must be one of ${[...EMISSION_SORTS.keys()].join(", ")}` });
    }
    if (order !== undefined && !["asc", "desc"].includes(String(order).toLowerCase())) {
      return res.status(400).json({ message: "order must be asc or desc" });
    }
    // Only the caller's sites (all of them when none are named).
    const scoped = await scopeSiteIds(req.user!.userId, req.user!.role, siteIds);
    if (scoped.forbidden) return res.status(403).json(SITE_ACCESS_DENIED);
    const scopedSiteIds = scoped.siteIds;

    const searchText = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    const searchParams = searchText
      ? { search: `%${searchText.replace(/[\\%_]/g, (ch) => "\\" + ch)}%`, searchExact: searchText }
      : null;

    const qb = repo
      .createQueryBuilder("emission")
      .leftJoinAndSelect("emission.site", "site")
      .leftJoinAndSelect("emission.category", "category")
      .leftJoinAndSelect("emission.reviewed_by", "reviewed_by")
      .leftJoinAndSelect("emission.created_by", "created_by");

    if (searchParams) {
      qb.andWhere(emissionSearchSql({ e: "emission", c: "category", s: "site", u: "created_by" }), searchParams);
    }

    if (scopedSiteIds) {
      qb.andWhere(siteFilterSql("site.site_id", scopedSiteIds), { scopedSiteIds });
    }

    if (categoryId) {
      qb.andWhere("category.category_id = :categoryId", { categoryId: parseInt(categoryId as string) });
    }

    if (scope) {
      qb.andWhere("category.scope = :scope", { scope: scope as string });
    }

    if (status) {
      qb.andWhere("emission.status = :status", { status: status as string });
    }

    if (date) {
      // Date format: YYYY-MM (e.g., 2024-01)
      const [y, m] = (date as string).split("-");
      const startDate = new Date(parseInt(y), parseInt(m) - 1, 1);
      const endDate = new Date(parseInt(y), parseInt(m), 0);
      qb.andWhere("emission.date_of_reporting >= :startDate", { startDate });
      qb.andWhere("emission.date_of_reporting <= :endDate", { endDate });
    } else {
      // Support separate year/month filters
      if (year) {
        const y = parseInt(year as string);
        qb.andWhere("EXTRACT(YEAR FROM emission.date_of_reporting) = :year", { year: y });
      }
      if (month) {
        const m = parseInt(month as string);
        qb.andWhere("EXTRACT(MONTH FROM emission.date_of_reporting) = :month", { month: m });
      }
    }

    if (sort !== undefined) {
      const direction = String(order ?? "desc").toUpperCase() as "ASC" | "DESC";
      qb.orderBy(EMISSION_SORTS.get(String(sort)) as string, direction, direction === "ASC" ? "NULLS FIRST" : "NULLS LAST");
      // Stable pages when many rows share the sort value.
      if (sort !== "id") qb.addOrderBy("emission.pk_id", "DESC");
    } else {
      qb.orderBy("emission.pk_id", "DESC");
    }

    // If page & limit are provided, return paginated result with total count + summary
    if (page && limit) {
      const pageNum = Math.max(1, parseInt(page as string));
      const limitNum = Math.max(1, parseInt(limit as string));

      // Build a separate summary query with the same filters
      const summaryQb = repo
        .createQueryBuilder("emission")
        .select("COALESCE(SUM(emission.total_emission), 0)", "total_emission")
        .addSelect("COUNT(*) FILTER (WHERE emission.status = 'pending')", "pending_count")
        .addSelect("COUNT(*) FILTER (WHERE emission.status = 'approved')", "approved_count")
        .addSelect("COUNT(*) FILTER (WHERE emission.status = 'rejected')", "rejected_count")
        .leftJoin("emission.site", "s")
        .leftJoin("emission.category", "c");

      if (searchParams) {
        summaryQb
          .leftJoin("emission.created_by", "cb")
          .andWhere(emissionSearchSql({ e: "emission", c: "c", s: "s", u: "cb" }), searchParams);
      }
      if (scopedSiteIds) {
        summaryQb.andWhere(siteFilterSql("s.site_id", scopedSiteIds), { scopedSiteIds });
      }
      if (categoryId) {
        summaryQb.andWhere("c.category_id = :categoryId", { categoryId: parseInt(categoryId as string) });
      }
      if (scope) {
        summaryQb.andWhere("c.scope = :scope", { scope: scope as string });
      }
      if (status) {
        summaryQb.andWhere("emission.status = :status", { status: status as string });
      }
      if (date) {
        const [y, m] = (date as string).split("-");
        const startDate = new Date(parseInt(y), parseInt(m) - 1, 1);
        const endDate = new Date(parseInt(y), parseInt(m), 0);
        summaryQb.andWhere("emission.date_of_reporting >= :startDate", { startDate });
        summaryQb.andWhere("emission.date_of_reporting <= :endDate", { endDate });
      } else {
        if (year) {
          summaryQb.andWhere("EXTRACT(YEAR FROM emission.date_of_reporting) = :year", { year: parseInt(year as string) });
        }
        if (month) {
          summaryQb.andWhere("EXTRACT(MONTH FROM emission.date_of_reporting) = :month", { month: parseInt(month as string) });
        }
      }

      const [[data, total], summaryRow] = await Promise.all([
        qb.skip((pageNum - 1) * limitNum).take(limitNum).getManyAndCount(),
        summaryQb.getRawOne(),
      ]);

      // Enrich FERA rows with parent category name
      const feraRows = data.filter(
        (e: any) => e.category?.category_name?.toLowerCase() === "fera" && e.fera_linked_id
      );
      if (feraRows.length > 0) {
        const parentIds = feraRows.map((e: any) => e.fera_linked_id);
        const parents = await repo
          .createQueryBuilder("e")
          .leftJoinAndSelect("e.category", "c")
          .where("e.pk_id IN (:...parentIds)", { parentIds })
          .getMany();
        const parentMap = new Map(parents.map((p: any) => [p.pk_id, p.category?.category_name]));
        for (const row of feraRows) {
          (row as any).parent_category_name = parentMap.get(row.fera_linked_id) || null;
        }
      }

      return res.status(200).json({
        data,
        total,
        summary: {
          total_emission: parseFloat(summaryRow?.total_emission) || 0,
          pending_count: parseInt(summaryRow?.pending_count) || 0,
          approved_count: parseInt(summaryRow?.approved_count) || 0,
          rejected_count: parseInt(summaryRow?.rejected_count) || 0,
        },
      });
    }

    // Backwards compatible: return plain array when no pagination params
    const emissions = await qb.getMany();

    // Enrich FERA rows with parent category name
    const feraEmissions = emissions.filter(
      (e: any) => e.category?.category_name?.toLowerCase() === "fera" && e.fera_linked_id
    );
    if (feraEmissions.length > 0) {
      const parentIds = feraEmissions.map((e: any) => e.fera_linked_id);
      const parents = await repo
        .createQueryBuilder("e")
        .leftJoinAndSelect("e.category", "c")
        .where("e.pk_id IN (:...parentIds)", { parentIds })
        .getMany();
      const parentMap = new Map(parents.map((p: any) => [p.pk_id, p.category?.category_name]));
      for (const row of feraEmissions) {
        (row as any).parent_category_name = parentMap.get(row.fera_linked_id) || null;
      }
    }

    return res.status(200).json(emissions);
  } catch (error) {
    console.error("Fetch emissions error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// GET /user/emissions/breakdown?categoryId=… (+ siteIds, year, month, status,
// search as on GET /user/emissions): consumption and tCO₂e per emission
// category for one category, computed here instead of paging every row to
// the browser. FERA rows have their own category, so they never mix in.
export const getEmissionBreakdown = async (req: AuthRequest, res: Response) => {
  try {
    const { year, month, status } = req.query;
    const categoryId = parseInt(String(req.query.categoryId ?? ""));
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return res.status(400).json({ message: "categoryId is required" });
    }
    if (status !== undefined && !["pending", "approved", "rejected"].includes(String(status))) {
      return res.status(400).json({ message: "status must be pending, approved or rejected" });
    }
    const siteIds = parseSiteIds(req.query as { siteIds?: unknown; siteId?: unknown });
    const scoped = await scopeSiteIds(req.user!.userId, req.user!.role, siteIds);
    if (scoped.forbidden) return res.status(403).json(SITE_ACCESS_DENIED);

    const searchText = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";

    const qb = repo
      .createQueryBuilder("emission")
      .select(["emission.pk_id", "emission.activity_data", "emission.activity_data_unit", "emission.total_emission"])
      .leftJoin("emission.site", "site")
      .leftJoin("emission.category", "category")
      .leftJoin("emission.created_by", "created_by")
      .where("category.category_id = :categoryId", { categoryId });
    if (scoped.siteIds) qb.andWhere(siteFilterSql("site.site_id", scoped.siteIds), { scopedSiteIds: scoped.siteIds });
    if (status) qb.andWhere("emission.status = :status", { status: String(status) });
    if (year) qb.andWhere("EXTRACT(YEAR FROM emission.date_of_reporting) = :year", { year: parseInt(String(year)) });
    if (month) qb.andWhere("EXTRACT(MONTH FROM emission.date_of_reporting) = :month", { month: parseInt(String(month)) });
    if (searchText) {
      qb.andWhere(emissionSearchSql({ e: "emission", c: "category", s: "site", u: "created_by" }), {
        search: `%${searchText.replace(/[\\%_]/g, (ch) => "\\" + ch)}%`,
        searchExact: searchText,
      });
    }

    // Number columns of the category's capture forms: the fallback activity value.
    const configQb = columnConfigRepo
      .createQueryBuilder("config")
      .leftJoin("config.category", "c")
      .leftJoin("config.site", "s")
      .leftJoinAndSelect("config.columns", "col")
      .where("c.category_id = :categoryId", { categoryId });
    if (scoped.siteIds) configQb.andWhere(siteFilterSql("s.site_id", scoped.siteIds), { scopedSiteIds: scoped.siteIds });

    const [rows, configs] = await Promise.all([qb.getMany(), configQb.getMany()]);
    const numberColumns = [
      ...new Set(configs.flatMap((cfg) => (cfg.columns ?? []).filter((c) => c.column_type === "number").map((c) => c.column_name))),
    ];
    const groups = computeBreakdown(rows as BreakdownSourceRow[], numberColumns);
    return res.status(200).json({ category_id: categoryId, entries: rows.length, groups });
  } catch (error) {
    console.error("Emission breakdown error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get emissions by site and category with date filter
export const getEmissionsBySiteAndCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { siteId, categoryId }: any = req.params;
    const { date }: any = req.query;

    const scoped = await scopeSiteIds(req.user!.userId, req.user!.role, [parseInt(siteId)]);
    if (scoped.forbidden) return res.status(403).json(SITE_ACCESS_DENIED);

    const queryBuilder = repo
      .createQueryBuilder("emission")
      .leftJoinAndSelect("emission.site", "site")
      .leftJoinAndSelect("emission.category", "category")
      .leftJoinAndSelect("emission.reviewed_by", "reviewed_by")
      .leftJoinAndSelect("emission.created_by", "created_by")
      .where("site.site_id = :siteId", { siteId: parseInt(siteId) })
      .andWhere("category.category_id = :categoryId", { categoryId: parseInt(categoryId) });

    if (date) {
      // Date format: YYYY-MM (e.g., 2024-01)
      const [year, month] = (date as string).split("-");
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 0);

      queryBuilder.andWhere("emission.date_of_reporting >= :startDate", { startDate });
      queryBuilder.andWhere("emission.date_of_reporting <= :endDate", { endDate });
    }

    const emissions = await queryBuilder.orderBy("emission.pk_id", "DESC").getMany();

    return res.status(200).json(emissions);
  } catch (error) {
    console.error("Fetch emissions by site and category error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Create a new emission entry
export const createEmission = async (req: AuthRequest, res: Response) => {
  try {
    const { site_id, category_id, activity_data, total_emission, unit, date_of_reporting, extra_data, reporting_period, year_type } = req.body;
    // `let`: per-unit spec categories replace a spelling variant ("Tonne KM")
    // with the canonical unit key so matching and storage stay consistent.
    let activity_data_unit = req.body.activity_data_unit;
    const userId = req.user?.userId;

    if (!site_id || !category_id || !activity_data || !date_of_reporting) {
      return res.status(400).json({
        message: "site_id, category_id, activity_data, and date_of_reporting are required",
      });
    }

    // Yearly data entry: validate period fields, then enforce the mode lock
    // (one site+category+year is either all monthly or all yearly — mixing
    // would double count, since a yearly batch already contains the months).
    const periodError = validatePeriodFields({
      category_id,
      reporting_period,
      year_type,
      date_of_reporting: new Date(date_of_reporting),
    });
    if (periodError) {
      return res.status(400).json({ message: periodError });
    }
    const effectivePeriod: "monthly" | "yearly" = reporting_period === "yearly" ? "yearly" : "monthly";
    const modeConflict = await findModeLockConflict(repo, {
      site_id,
      category_id,
      reporting_period: effectivePeriod,
      year_type: effectivePeriod === "yearly" ? year_type : null,
      date_of_reporting: new Date(date_of_reporting),
    });
    if (modeConflict) {
      let conflictMessage: string;
      if (effectivePeriod === "yearly" && modeConflict.conflicting_period === "monthly") {
        conflictMessage = `This category already has ${modeConflict.conflicting_rows} monthly entr${modeConflict.conflicting_rows === 1 ? "y" : "ies"} in ${modeConflict.window.start} – ${modeConflict.window.end}. Delete them first, or continue entering monthly.`;
      } else if (effectivePeriod === "yearly") {
        // Overlapping yearly batch of the other calendar (CY vs FY): their
        // windows share up to nine months, so both existing double counts.
        conflictMessage = `This year overlaps an existing ${modeConflict.conflicting_year_type} yearly batch on this category. A category uses CY or FY for a given period, not both — delete the ${modeConflict.conflicting_year_type} batch first, or file this data under ${modeConflict.conflicting_year_type} too.`;
      } else {
        conflictMessage = `This category already has a yearly batch covering ${modeConflict.window.start} – ${modeConflict.window.end}. Delete the yearly data first, or file this entry under a different period.`;
      }
      return res.status(409).json({
        message: conflictMessage,
        mode_lock: true,
        conflict: modeConflict,
      });
    }

    // Multi-field categories (e.g. Use of Sold Products) carry a calculation
    // spec on their column config; it changes the duplicate identity below and
    // replaces the one-value heuristic in the calculation block.
    const calcSpec = await getCalculationSpec(columnConfigRepo, site_id, category_id);

    // Check for duplicate emission (same site + category + date + emission_category).
    // Monthly rows only: every row of a yearly batch shares the period-end date,
    // so date-based dedup would wrongly reject a second purchase of the same
    // subcategory within the year.
    const existingEmissions =
      effectivePeriod === "yearly"
        ? []
        : await repo.find({
            where: {
              site: { site_id },
              category: { category_id },
              date_of_reporting: new Date(date_of_reporting),
            },
            relations: ["site", "category", "created_by"],
          });

    // If emission_category is provided, match on it too; otherwise match any entry
    // for that date. For spec categories the emission_category is the country/fuel/
    // gas — two different products in the same country are NOT duplicates, so the
    // spec's identity columns (e.g. Product Name) must match as well.
    const duplicate = activity_data.emission_category
      ? existingEmissions.find(
          (e) =>
            e.activity_data?.emission_category === activity_data.emission_category &&
            (!calcSpec || specIdentityMatches(calcSpec, activity_data, e.activity_data))
        )
      : existingEmissions.length > 0
        ? existingEmissions[0]
        : null;

    if (duplicate) {
      const replace = req.query.replace === "true";
      if (!replace) {
        return res.status(409).json({
          message: "Duplicate emission entry already exists for this site, category, date, and emission subcategory.",
          existing_emission: duplicate,
          duplicate: true,
        });
      }
      // Replace mode: delete the existing entry (and its FERA links) before creating new one
      const idsToDelete = [duplicate.pk_id];
      if (duplicate.fera_linked_id) {
        idsToDelete.push(duplicate.fera_linked_id);
      }
      // Check if any other emission links back to this one (reverse FERA link)
      const linkedBack = await repo.findOne({
        where: { fera_linked_id: duplicate.pk_id },
      });
      if (linkedBack) {
        idsToDelete.push(linkedBack.pk_id);
      }
      // Delete related documents first
      const docRepo = AppDataSource.getRepository(EmissionDocument);
      await docRepo
        .createQueryBuilder()
        .delete()
        .where("emission_id IN (:...ids)", { ids: idsToDelete })
        .execute();
      await repo.delete(idsToDelete);
    }

    let calculatedEmission = total_emission || 0;
    let matchedEmissionFactor: import("../entities/EmissionFactor").EmissionFactor | null = null;

    // Calculate total emission if emission_category is provided in activity_data
    if (activity_data.emission_category && activity_data_unit) {
      // Calculate target year for emission factor (reporting year - 1, matching frontend logic)
      // Use string parsing to avoid timezone issues (frontend does: parseInt(selectedDate.substring(0, 4)) - 1)
      const reportingYearStr = typeof date_of_reporting === 'string'
        ? date_of_reporting.substring(0, 4)
        : new Date(date_of_reporting).getFullYear().toString();
      const targetYear = parseInt(reportingYearStr) - 1;

      // Find the emission factor for the selected emission category and year
      // (exact name/global match with year, then looser fallbacks).
      const emissionFactor = await findEmissionFactorForCategory(emissionFactorRepo, {
        site_id,
        category_id,
        emissionCategory: activity_data.emission_category,
        year: targetYear,
      });

      if (emissionFactor) {
        matchedEmissionFactor = emissionFactor;
        // Try to find the numeric value from activity_data
        let activityValue = 0;

        if (calcSpec) {
          // Spec category: the activity value is the product of the method's
          // fields (e.g. units sold × energy per use × lifetime uses). The
          // one-value heuristic below must not run — with several numeric
          // columns it would pick one of them and store a wrong total.
          const computed = computeSpecActivityValue(calcSpec, activity_data, activity_data_unit);
          if (!computed.ok) {
            return res.status(400).json({ message: computed.message });
          }
          activityValue = computed.value;
          if (computed.unitKey) activity_data_unit = computed.unitKey;
          // Persist the computed product alongside the inputs so reports,
          // exports and the legacy readers (which look for activity_value)
          // see one activity figure for the row.
          activity_data.activity_value = String(activityValue);
        } else {

        // Known dropdown/select column names to skip (these contain IDs, not activity data)
        const skipColumns = new Set(['material', 'disposal_method', 'fuel_type', 'vehicle_type', 'source_type', 'waste_type', 'transport_mode']);

        // Check common field names first (case-insensitive)
        const commonFields = ['activity_value', 'quantity', 'value', 'amount', 'consumption', 'activity data', 'activity_data'];
        for (const field of commonFields) {
          // Case-insensitive search
          const matchingKey = Object.keys(activity_data).find(k => k.toLowerCase() === field.toLowerCase());
          if (matchingKey && activity_data[matchingKey] !== undefined && activity_data[matchingKey] !== '') {
            activityValue = parseFloat(activity_data[matchingKey]);
            if (!isNaN(activityValue) && activityValue > 0) {
              break;
            }
          }
        }

        // If not found in common fields, look for any numeric value
        // Skip: emission_category, known dropdown columns, and small values that look like IDs
        if (activityValue === 0) {
          for (const [key, value] of Object.entries(activity_data)) {
            const keyLower = key.toLowerCase();
            // Skip emission_category and known dropdown columns
            if (key === 'emission_category' || skipColumns.has(keyLower)) {
              continue;
            }
            if (value !== undefined && value !== '') {
              const numValue = parseFloat(value as string);
              // Skip small integers (1-99) as they're likely dropdown IDs, not activity data
              // Real activity data is typically larger (e.g., 10000 kg, 5000 kWh)
              if (!isNaN(numValue) && numValue >= 100) {
                activityValue = numValue;
                break;
              }
            }
          }
        }

        // Fallback: if still not found, accept any positive number (in case activity data is small)
        if (activityValue === 0) {
          for (const [key, value] of Object.entries(activity_data)) {
            const keyLower = key.toLowerCase();
            if (key === 'emission_category' || skipColumns.has(keyLower)) {
              continue;
            }
            if (value !== undefined && value !== '') {
              const numValue = parseFloat(value as string);
              if (!isNaN(numValue) && numValue > 0) {
                activityValue = numValue;
                break;
              }
            }
          }
        }
        }

        if (activityValue > 0) {
          // Check if units match (handles null/undefined like frontend)
          const unitsMatch = unitsMatchExact(emissionFactor.denominator_unit, activity_data_unit);

          if (unitsMatch) {
            // Units match - calculate directly
            calculatedEmission = Math.round((activityValue * emissionFactor.factor_value) / 1000 * 100) / 100;
          } else {
            // Units don't match - try to convert
            const conversionFactor = getConversionFactor(activity_data_unit, emissionFactor.denominator_unit);

            if (conversionFactor) {
              // Apply conversion and calculate
              const convertedValue = activityValue * conversionFactor;
              calculatedEmission = Math.round((convertedValue * emissionFactor.factor_value) / 1000 * 100) / 100;
            } else {
              // No conversion available - reject
              return res.status(400).json({
                message: `Unit mismatch: Expected "${emissionFactor.denominator_unit}" but received "${activity_data_unit}". No conversion available.`,
                expected_unit: emissionFactor.denominator_unit,
                received_unit: activity_data_unit,
              });
            }
          }
        }
      } else {
        return res.status(400).json({
          message: `No emission factor found for emission category "${activity_data.emission_category}" (year ${targetYear})`,
        });
      }
    }

    const emission = repo.create({
      site: { site_id },
      category: { category_id },
      activity_data,
      extra_data: extra_data || {},
      total_emission: calculatedEmission,
      unit: "tCO2e",
      date_of_reporting: new Date(date_of_reporting),
      reporting_period: effectivePeriod,
      year_type: effectivePeriod === "yearly" ? year_type : null,
      activity_data_unit: activity_data_unit || null,
      created_by: userId ? { user_id: userId } as any : null,
      emission_factor_snapshot: matchedEmissionFactor ? {
        emission_factor_id: matchedEmissionFactor.emission_factor_id,
        emission_category_name: matchedEmissionFactor.emission_category_name,
        global_category_name: matchedEmissionFactor.global_category_name || undefined,
        factor_value: matchedEmissionFactor.factor_value,
        denominator_unit: matchedEmissionFactor.denominator_unit,
        source: matchedEmissionFactor.source,
        year: matchedEmissionFactor.year,
      } : null,
    });

    await repo.save(emission);

    // Auto-create FERA entry if the site has a FERA category with a matching emission factor.
    // Never for spec categories: their emission_category is a country/fuel/gas name for
    // downstream USE-phase emissions, not a fuel the company burned — a same-named FERA
    // factor (e.g. a country name) would spawn a phantom twin from one sniffed field.
    let feraEmission: Emission | null = null;
    if (activity_data.emission_category && !calcSpec) {
      try {
        const site = await siteRepo.findOne({
          where: { site_id },
          relations: ["categories"],
        });
        const feraCategory = site?.categories?.find(
          (c) => c.category_name.toLowerCase() === "fera"
        );

        if (feraCategory) {
          // Calculate target year same as above
          const reportingYearStr = typeof date_of_reporting === 'string'
            ? date_of_reporting.substring(0, 4)
            : new Date(date_of_reporting).getFullYear().toString();
          const feraTargetYear = parseInt(reportingYearStr) - 1;

          // Find FERA emission factor for this emission category
          const feraFactor = await emissionFactorRepo.findOne({
            where: {
              site: { site_id },
              category: { category_id: feraCategory.category_id },
              emission_category_name: activity_data.emission_category,
              year: feraTargetYear,
            },
          }) || await emissionFactorRepo.findOne({
            where: {
              site: { site_id },
              category: { category_id: feraCategory.category_id },
              global_category_name: activity_data.emission_category,
              year: feraTargetYear,
            },
          });

          if (feraFactor) {
            // Find the activity value (same logic as above)
            let feraActivityValue = 0;
            const skipCols = new Set(['material', 'disposal_method', 'fuel_type', 'vehicle_type', 'source_type', 'waste_type', 'transport_mode']);
            const commonFlds = ['activity_value', 'quantity', 'value', 'amount', 'consumption', 'activity data', 'activity_data'];
            for (const field of commonFlds) {
              const matchingKey = Object.keys(activity_data).find(k => k.toLowerCase() === field.toLowerCase());
              if (matchingKey && activity_data[matchingKey] !== undefined && activity_data[matchingKey] !== '') {
                feraActivityValue = parseFloat(activity_data[matchingKey]);
                if (!isNaN(feraActivityValue) && feraActivityValue > 0) break;
              }
            }
            // Look for any numeric value >= 100 (skip likely dropdown IDs)
            if (feraActivityValue === 0) {
              for (const [key, value] of Object.entries(activity_data)) {
                if (key === 'emission_category' || skipCols.has(key.toLowerCase())) continue;
                if (value !== undefined && value !== '') {
                  const numValue = parseFloat(value as string);
                  if (!isNaN(numValue) && numValue >= 100) { feraActivityValue = numValue; break; }
                }
              }
            }
            // Fallback: accept any positive number
            if (feraActivityValue === 0) {
              for (const [key, value] of Object.entries(activity_data)) {
                if (key === 'emission_category' || skipCols.has(key.toLowerCase())) continue;
                if (value !== undefined && value !== '') {
                  const numValue = parseFloat(value as string);
                  if (!isNaN(numValue) && numValue > 0) { feraActivityValue = numValue; break; }
                }
              }
            }

            if (feraActivityValue > 0) {
              // Calculate FERA emission (use fallback-to-raw like frontend)
              let feraCalculated = 0;
              const feraUnitsMatch = unitsMatchExact(feraFactor.denominator_unit, activity_data_unit);
              if (feraUnitsMatch) {
                feraCalculated = Math.round((feraActivityValue * feraFactor.factor_value) / 1000 * 100) / 100;
              } else {
                const conv = getConversionFactor(activity_data_unit, feraFactor.denominator_unit);
                if (conv) {
                  feraCalculated = Math.round((feraActivityValue * conv * feraFactor.factor_value) / 1000 * 100) / 100;
                } else {
                  // Fallback to raw (FERA factors account for fuel energy content)
                  feraCalculated = Math.round((feraActivityValue * feraFactor.factor_value) / 1000 * 100) / 100;
                }
              }

              // The FERA twin must carry the same reporting period as its
              // parent: a yearly fuel entry with a monthly FERA twin would
              // draw a false period-end spike on FERA charts and later trip
              // the mode lock. And the twin must respect the lock on ITS OWN
              // category — if FERA already holds the other mode for this
              // window, skip the twin (non-fatal, mirrors the missing-factor
              // behavior) rather than silently creating mixed-mode data.
              const feraModeConflict = await findModeLockConflict(repo, {
                site_id,
                category_id: feraCategory.category_id,
                reporting_period: effectivePeriod,
                year_type: effectivePeriod === "yearly" ? year_type : null,
                date_of_reporting: new Date(date_of_reporting),
              });
              if (feraModeConflict) {
                console.warn(
                  `FERA auto-create skipped: ${effectivePeriod} twin would conflict with existing ${feraModeConflict.conflicting_period} FERA data for this window (site ${site_id}).`,
                );
                throw Object.assign(new Error("fera-mode-lock-skip"), { nonFatal: true });
              }

              feraEmission = repo.create({
                site: { site_id },
                category: { category_id: feraCategory.category_id },
                activity_data,
                total_emission: feraCalculated,
                unit: "tCO2e",
                date_of_reporting: new Date(date_of_reporting),
                reporting_period: effectivePeriod,
                year_type: effectivePeriod === "yearly" ? year_type : null,
                activity_data_unit: activity_data_unit || null,
                created_by: userId ? { user_id: userId } as any : null,
                fera_linked_id: emission.pk_id,
                emission_factor_snapshot: {
                  emission_factor_id: feraFactor.emission_factor_id,
                  emission_category_name: feraFactor.emission_category_name,
                  global_category_name: feraFactor.global_category_name || undefined,
                  factor_value: feraFactor.factor_value,
                  denominator_unit: feraFactor.denominator_unit,
                  source: feraFactor.source,
                  year: feraFactor.year,
                },
              });
              await repo.save(feraEmission);

              // Link back: set fera_linked_id on the regular emission
              emission.fera_linked_id = feraEmission.pk_id;
              await repo.save(emission);
            }
          }
        }
      } catch (feraErr) {
        console.error("FERA auto-create warning (non-fatal):", feraErr);
      }
    }

    const savedEmission = await repo.findOne({
      where: { pk_id: emission.pk_id },
      relations: ["site", "category", "created_by"],
    });

    // Also fetch FERA emission if created
    let savedFera: Emission | null = null;
    if (feraEmission) {
      savedFera = await repo.findOne({
        where: { pk_id: feraEmission.pk_id },
        relations: ["site", "category", "created_by"],
      });
    }

    log.info("Emission", "Created", { id: savedEmission?.pk_id, userId, siteId: site_id, categoryId: category_id });

    return res.status(201).json({
      message: "Emission created successfully",
      emission: savedEmission,
      fera_emission: savedFera,
    });
  } catch (error) {
    console.error("Create emission error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Update an emission entry
export const updateEmission = async (req: AuthRequest, res: Response) => {
  try {
    const { id }: any = req.params;
    const { activity_data, activity_data_unit, date_of_reporting, extra_data, reason } = req.body;

    const emission = await repo.findOne({
      where: { pk_id: parseInt(id) },
      relations: ["site", "category"],
    });

    if (!emission) {
      return res.status(404).json({
        message: "Emission not found",
      });
    }

    // Block edits on approved entries
    if (emission.status === EmissionStatus.APPROVED) {
      return res.status(403).json({ message: "Cannot edit approved emission data" });
    }

    // Capture old values for audit trail
    const oldActivityData = emission.activity_data ? JSON.parse(JSON.stringify(emission.activity_data)) : null;
    const oldDateOfReporting = emission.date_of_reporting;
    const oldActivityDataUnit = emission.activity_data_unit;
    const oldStatus = emission.status;

    if (activity_data !== undefined) {
      emission.activity_data = activity_data;

      // Update unit if provided
      if (activity_data_unit !== undefined) {
        emission.activity_data_unit = activity_data_unit;
      }

      // Reset status to pending when user edits the emission
      emission.status = EmissionStatus.PENDING;
      emission.reviewed_by = null as any;
      emission.review_comment = null as any;
      emission.reviewed_at = null as any;

      // Recalculate total emission if activity_data has emission_category
      if (activity_data.emission_category && emission.activity_data_unit) {
        // Calculate target year for emission factor (reporting year - 1, matching frontend logic)
        // const targetYear = emission.date_of_reporting.getFullYear() - 1;

        const reportingDate = emission.date_of_reporting instanceof Date 
  ? emission.date_of_reporting 
  : new Date(emission.date_of_reporting);

const targetYear = reportingDate.getFullYear() - 1;

        // Find the emission factor for the selected emission category and year
        // (exact name/global match with year, then looser fallbacks).
        const emissionFactor = await findEmissionFactorForCategory(emissionFactorRepo, {
          site_id: emission.site.site_id,
          category_id: emission.category.category_id,
          emissionCategory: activity_data.emission_category,
          year: targetYear,
        });

        if (emissionFactor) {
          // Update emission factor snapshot
          emission.emission_factor_snapshot = {
            emission_factor_id: emissionFactor.emission_factor_id,
            emission_category_name: emissionFactor.emission_category_name,
            global_category_name: emissionFactor.global_category_name || undefined,
            factor_value: emissionFactor.factor_value,
            denominator_unit: emissionFactor.denominator_unit,
            source: emissionFactor.source,
            year: emissionFactor.year,
          } as any;

          // Find activity value from activity_data
          let activityValue = 0;

          // Spec category (e.g. Use of Sold Products): multiply the method's
          // fields instead of sniffing for one value — see createEmission.
          const updateCalcSpec = await getCalculationSpec(
            columnConfigRepo,
            emission.site.site_id,
            emission.category.category_id,
          );
          if (updateCalcSpec) {
            const computed = computeSpecActivityValue(updateCalcSpec, activity_data, emission.activity_data_unit);
            if (!computed.ok) {
              return res.status(400).json({ message: computed.message });
            }
            activityValue = computed.value;
            if (computed.unitKey) emission.activity_data_unit = computed.unitKey;
            activity_data.activity_value = String(activityValue);
          } else {

          // Known dropdown/select column names to skip (these contain IDs, not activity data)
          const skipColumns = new Set(['material', 'disposal_method', 'fuel_type', 'vehicle_type', 'source_type', 'waste_type', 'transport_mode']);

          // Check common field names first (case-insensitive)
          const commonFields = ['activity_value', 'quantity', 'value', 'amount', 'consumption', 'activity data', 'activity_data'];
          for (const field of commonFields) {
            const matchingKey = Object.keys(activity_data).find(k => k.toLowerCase() === field.toLowerCase());
            if (matchingKey && activity_data[matchingKey] !== undefined && activity_data[matchingKey] !== '') {
              activityValue = parseFloat(activity_data[matchingKey]);
              if (!isNaN(activityValue) && activityValue > 0) break;
            }
          }

          // If not found in common fields, look for any numeric value >= 100 (skip likely dropdown IDs)
          if (activityValue === 0) {
            for (const [key, value] of Object.entries(activity_data)) {
              const keyLower = key.toLowerCase();
              if (key === 'emission_category' || skipColumns.has(keyLower)) continue;
              if (value !== undefined && value !== '') {
                const numValue = parseFloat(value as string);
                if (!isNaN(numValue) && numValue >= 100) {
                  activityValue = numValue;
                  break;
                }
              }
            }
          }

          // Fallback: accept any positive number
          if (activityValue === 0) {
            for (const [key, value] of Object.entries(activity_data)) {
              const keyLower = key.toLowerCase();
              if (key === 'emission_category' || skipColumns.has(keyLower)) continue;
              if (value !== undefined && value !== '') {
                const numValue = parseFloat(value as string);
                if (!isNaN(numValue) && numValue > 0) {
                  activityValue = numValue;
                  break;
                }
              }
            }
          }
          }

          if (activityValue > 0) {
            // Check if units match (handles null/undefined like frontend)
            const unitsMatch = unitsMatchExact(emissionFactor.denominator_unit, emission.activity_data_unit);

            if (unitsMatch) {
              emission.total_emission = Math.round((activityValue * emissionFactor.factor_value) / 1000 * 100) / 100;
            } else {
              const conversionFactor = getConversionFactor(emission.activity_data_unit, emissionFactor.denominator_unit);
              if (conversionFactor) {
                const convertedValue = activityValue * conversionFactor;
                emission.total_emission = Math.round((convertedValue * emissionFactor.factor_value) / 1000 * 100) / 100;
              } else {
                return res.status(400).json({
                  message: `Cannot convert unit "${emission.activity_data_unit}" to expected unit "${emissionFactor.denominator_unit}"`,
                });
              }
            }
          } else {
            return res.status(400).json({
              message: "No valid activity value found in the provided data",
            });
          }
        } else {
          return res.status(400).json({
            message: `No emission factor found for category "${activity_data.emission_category}"`,
          });
        }
      }
    }

    if (date_of_reporting !== undefined) emission.date_of_reporting = new Date(date_of_reporting);
    if (extra_data !== undefined) emission.extra_data = extra_data;

    await repo.save(emission);

    // Recalculate linked FERA emission if activity data changed
    let updatedFeraEmission: Emission | null = null;
    if (activity_data !== undefined && emission.fera_linked_id) {
      try {
        const feraEmission = await repo.findOne({
          where: { pk_id: emission.fera_linked_id },
          relations: ["site", "category"],
        });
        // Also check reverse link
        const reverseFeraEmission = !feraEmission
          ? await repo.findOne({ where: { fera_linked_id: emission.pk_id }, relations: ["site", "category"] })
          : null;
        const linkedFera = feraEmission || reverseFeraEmission;

        if (linkedFera && linkedFera.category?.category_name?.toLowerCase() === "fera") {
          const reportingDate = emission.date_of_reporting instanceof Date
            ? emission.date_of_reporting
            : new Date(emission.date_of_reporting);
          const feraTargetYear = reportingDate.getFullYear() - 1;

          // Find FERA emission factor (same 4-level fallback as parent)
          let feraFactor = await emissionFactorRepo.findOne({
            where: {
              site: { site_id: emission.site.site_id },
              category: { category_id: linkedFera.category.category_id },
              emission_category_name: activity_data.emission_category,
              year: feraTargetYear,
            },
          });
          if (!feraFactor) {
            feraFactor = await emissionFactorRepo.findOne({
              where: {
                site: { site_id: emission.site.site_id },
                category: { category_id: linkedFera.category.category_id },
                global_category_name: activity_data.emission_category,
                year: feraTargetYear,
              },
            });
          }
          if (!feraFactor) {
            feraFactor = await emissionFactorRepo.findOne({
              where: {
                site: { site_id: emission.site.site_id },
                category: { category_id: linkedFera.category.category_id },
                emission_category_name: activity_data.emission_category,
              },
            });
          }
          if (!feraFactor) {
            feraFactor = await emissionFactorRepo.findOne({
              where: {
                site: { site_id: emission.site.site_id },
                category: { category_id: linkedFera.category.category_id },
                global_category_name: activity_data.emission_category,
              },
            });
          }

          if (feraFactor) {
            // Extract activity value (same logic as create)
            let feraActivityValue = 0;
            const skipCols = new Set(['material', 'disposal_method', 'fuel_type', 'vehicle_type', 'source_type', 'waste_type', 'transport_mode']);
            const commonFlds = ['activity_value', 'quantity', 'value', 'amount', 'consumption', 'activity data', 'activity_data'];
            for (const field of commonFlds) {
              const matchingKey = Object.keys(activity_data).find(k => k.toLowerCase() === field.toLowerCase());
              if (matchingKey && activity_data[matchingKey] !== undefined && activity_data[matchingKey] !== '') {
                feraActivityValue = parseFloat(activity_data[matchingKey]);
                if (!isNaN(feraActivityValue) && feraActivityValue > 0) break;
              }
            }
            if (feraActivityValue === 0) {
              for (const [key, value] of Object.entries(activity_data)) {
                if (key === 'emission_category' || skipCols.has(key.toLowerCase())) continue;
                if (value !== undefined && value !== '') {
                  const numValue = parseFloat(value as string);
                  if (!isNaN(numValue) && numValue >= 100) { feraActivityValue = numValue; break; }
                }
              }
            }
            if (feraActivityValue === 0) {
              for (const [key, value] of Object.entries(activity_data)) {
                if (key === 'emission_category' || skipCols.has(key.toLowerCase())) continue;
                if (value !== undefined && value !== '') {
                  const numValue = parseFloat(value as string);
                  if (!isNaN(numValue) && numValue > 0) { feraActivityValue = numValue; break; }
                }
              }
            }

            if (feraActivityValue > 0) {
              const feraUnitsMatch = unitsMatchExact(feraFactor.denominator_unit, emission.activity_data_unit);
              let feraCalculated = 0;
              if (feraUnitsMatch) {
                feraCalculated = Math.round((feraActivityValue * feraFactor.factor_value) / 1000 * 100) / 100;
              } else {
                const conv = getConversionFactor(emission.activity_data_unit, feraFactor.denominator_unit);
                if (conv) {
                  feraCalculated = Math.round((feraActivityValue * conv * feraFactor.factor_value) / 1000 * 100) / 100;
                } else {
                  feraCalculated = Math.round((feraActivityValue * feraFactor.factor_value) / 1000 * 100) / 100;
                }
              }

              linkedFera.activity_data = activity_data;
              linkedFera.total_emission = feraCalculated;
              linkedFera.date_of_reporting = emission.date_of_reporting;
              linkedFera.activity_data_unit = emission.activity_data_unit;
              linkedFera.status = EmissionStatus.PENDING;
              linkedFera.reviewed_by = null as any;
              linkedFera.review_comment = null as any;
              linkedFera.reviewed_at = null as any;
              linkedFera.emission_factor_snapshot = {
                emission_factor_id: feraFactor.emission_factor_id,
                emission_category_name: feraFactor.emission_category_name,
                global_category_name: feraFactor.global_category_name || undefined,
                factor_value: feraFactor.factor_value,
                denominator_unit: feraFactor.denominator_unit,
                source: feraFactor.source,
                year: feraFactor.year,
              };
              await repo.save(linkedFera);
              updatedFeraEmission = linkedFera;
            }
          }
        }
      } catch (feraError) {
        console.error("Failed to update linked FERA emission:", feraError);
        // Non-fatal: parent emission was updated successfully
      }
    }

    // Create audit log for user edit
    try {
      const changedFields: Record<string, { old: any; new: any }> = {};

      if (activity_data !== undefined && JSON.stringify(oldActivityData) !== JSON.stringify(emission.activity_data)) {
        changedFields["activity_data"] = { old: oldActivityData, new: emission.activity_data };
      }
      if (date_of_reporting !== undefined && String(oldDateOfReporting) !== String(emission.date_of_reporting)) {
        changedFields["date_of_reporting"] = { old: oldDateOfReporting, new: emission.date_of_reporting };
      }
      if (activity_data_unit !== undefined && oldActivityDataUnit !== emission.activity_data_unit) {
        changedFields["activity_data_unit"] = { old: oldActivityDataUnit, new: emission.activity_data_unit };
      }
      if (oldStatus !== emission.status) {
        changedFields["status"] = { old: oldStatus, new: emission.status };
      }

      if (Object.keys(changedFields).length > 0) {
        const auditLogRepo = AppDataSource.getRepository(AuditLog);
        const userRepo = AppDataSource.getRepository(User);
        const changedByUser = await userRepo.findOne({ where: { user_id: req.user?.userId } });

        const auditLog = auditLogRepo.create({
          entity_type: "emission",
          entity_id: emission.pk_id,
          action: "user_edit",
          changed_fields: changedFields,
          reason: reason || null,
          changed_by: changedByUser || undefined,
        });
        await auditLogRepo.save(auditLog);
      }
    } catch (auditError) {
      console.error("Failed to create audit log for user edit:", auditError);
    }

    return res.status(200).json({
      message: "Emission updated successfully",
      emission,
      fera_emission: updatedFeraEmission || undefined,
    });
  } catch (error) {
    console.error("Update emission error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Delete an emission entry
export const deleteEmission = async (req: Request, res: Response) => {
  try {
    const { id }: any = req.params;

    const emission = await repo.findOne({
      where: { pk_id: parseInt(id) },
    });

    if (!emission) {
      return res.status(404).json({
        message: "Emission not found",
      });
    }

    // Also delete the linked FERA entry (bi-directional)
    const idsToDelete = [emission.pk_id];
    if (emission.fera_linked_id) {
      idsToDelete.push(emission.fera_linked_id);
    }
    // Check if any other emission links back to this one
    const linkedBack = await repo.findOne({
      where: { fera_linked_id: emission.pk_id },
    });
    if (linkedBack) {
      idsToDelete.push(linkedBack.pk_id);
    }

    // Delete related documents first (in case DB cascade is not set)
    const docRepo = AppDataSource.getRepository(EmissionDocument);
    await docRepo
      .createQueryBuilder()
      .delete()
      .where("emission_id IN (:...ids)", { ids: idsToDelete })
      .execute();

    await repo.delete(idsToDelete);

    log.info("Emission", "Deleted", { ids: idsToDelete, userId: (req as AuthRequest).user?.userId });

    return res.status(200).json({
      message: "Emission deleted successfully",
      deleted_ids: idsToDelete,
    });
  } catch (error) {
    console.error("Delete emission error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Bulk delete emissions
export const bulkDeleteEmissions = async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "ids array is required",
      });
    }

    const numericIds = ids.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
    if (numericIds.length === 0) {
      return res.status(400).json({ message: "No valid IDs provided" });
    }

    // Helper to chunk arrays for queries (Postgres max ~32K params)
    const CHUNK_SIZE = 5000;
    const chunk = <T>(arr: T[], size: number): T[][] => {
      const chunks: T[][] = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    };

    // Collect FERA-linked emissions (bi-directional) in chunks
    const allIds = new Set(numericIds);

    for (const batch of chunk(numericIds, CHUNK_SIZE)) {
      const emissions = await repo.find({
        where: { pk_id: In(batch) },
        select: ["pk_id", "fera_linked_id"],
      });
      for (const e of emissions) {
        if (e.fera_linked_id) allIds.add(e.fera_linked_id);
      }

      const reverseLinked = await repo.find({
        where: { fera_linked_id: In(batch) },
        select: ["pk_id"],
      });
      for (const e of reverseLinked) {
        allIds.add(e.pk_id);
      }
    }

    const idsArray = Array.from(allIds);
    let totalDeleted = 0;

    // Delete in chunks within a transaction
    await AppDataSource.transaction(async (manager) => {
      const docRepo = manager.getRepository(EmissionDocument);
      const emRepo = manager.getRepository(Emission);

      for (const batch of chunk(idsArray, CHUNK_SIZE)) {
        // Delete related documents first
        await docRepo
          .createQueryBuilder()
          .delete()
          .where("emission_id IN (:...ids)", { ids: batch })
          .execute();

        const result = await emRepo.delete(batch);
        totalDeleted += result.affected || 0;
      }
    });

    return res.status(200).json({
      message: `Successfully deleted ${totalDeleted} emission(s)`,
      deleted: totalDeleted,
      deleted_ids: idsArray,
    });
  } catch (error: any) {
    console.error("Bulk delete emissions error:", error);
    return res.status(500).json({
      message: error?.message || "Internal server error",
    });
  }
};

// List upload batches with aggregated info
export const getEmissionBatches = async (req: Request, res: Response) => {
  try {
    const { categoryId } = req.query;
    const siteIds = parseSiteIds(req.query as { siteIds?: unknown; siteId?: unknown });

    const qb = repo
      .createQueryBuilder("e")
      .select("e.upload_batch_id", "upload_batch_id")
      .addSelect("COUNT(*)::int", "count")
      .addSelect("SUM(CASE WHEN e.status = 'pending' THEN 1 ELSE 0 END)::int", "pending_count")
      .addSelect("SUM(CASE WHEN e.status = 'approved' THEN 1 ELSE 0 END)::int", "approved_count")
      .addSelect("SUM(CASE WHEN e.status = 'rejected' THEN 1 ELSE 0 END)::int", "rejected_count")
      .addSelect("MIN(e.created_at)", "uploaded_at")
      .addSelect("e.site_id", "site_id")
      .addSelect("site.name", "site_name")
      .addSelect("e.category_id", "category_id")
      .addSelect("category.category_name", "category_name")
      .addSelect(`(SELECT u.name FROM "user" u WHERE u.user_id = MIN(e.created_by) LIMIT 1)`, "uploaded_by")
      .innerJoin("e.site", "site")
      .innerJoin("e.category", "category")
      .where("e.upload_batch_id IS NOT NULL")
      .groupBy("e.upload_batch_id")
      .addGroupBy("e.site_id")
      .addGroupBy("site.name")
      .addGroupBy("e.category_id")
      .addGroupBy("category.category_name")
      .orderBy("MIN(e.created_at)", "DESC");

    if (siteIds.length > 0) {
      qb.andWhere("e.site_id IN (:...siteIds)", { siteIds });
    }
    if (categoryId) {
      qb.andWhere("e.category_id = :categoryId", { categoryId: parseInt(categoryId as string) });
    }

    const batches = await qb.getRawMany();
    return res.status(200).json(batches);
  } catch (error) {
    console.error("Get emission batches error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Approve all pending emissions for a given upload batch
export const approveEmissionsByBatch = async (req: AuthRequest, res: Response) => {
  try {
    const batchId = req.params.batchId as string;
    const userId = req.user?.userId;
    const { comment } = req.body || {};

    if (!batchId) {
      return res.status(400).json({ message: "batchId is required" });
    }

    // Fetch emissions before updating for email notifications
    const emissionsToApprove = await repo.find({
      where: { upload_batch_id: batchId, status: EmissionStatus.PENDING },
      relations: ["created_by", "category", "site"],
    });

    if (emissionsToApprove.length === 0) {
      return res.status(404).json({
        message: "No pending emissions found for this batch",
      });
    }

    const eligibleIds = emissionsToApprove.map((e) => e.pk_id);

    await repo.update(
      { pk_id: In(eligibleIds) },
      {
        status: EmissionStatus.APPROVED,
        review_comment: comment || null,
        reviewed_by: userId ? { user_id: userId } as any : null,
        reviewed_at: new Date(),
      }
    );

    // Auto-approve linked FERA entries
    const feraIds: number[] = [];
    for (const e of emissionsToApprove) {
      if (e.fera_linked_id) feraIds.push(e.fera_linked_id);
    }
    const reverseLinked = await repo.find({
      where: { fera_linked_id: In(eligibleIds), status: EmissionStatus.PENDING },
      select: ["pk_id"],
    });
    for (const e of reverseLinked) feraIds.push(e.pk_id);
    if (feraIds.length > 0) {
      await repo
        .createQueryBuilder()
        .update()
        .set({ status: EmissionStatus.APPROVED, review_comment: comment || null, reviewed_at: new Date() })
        .where("pk_id IN (:...ids) AND status = :status", { ids: feraIds, status: EmissionStatus.PENDING })
        .execute();
      if (userId) await repo.query(`UPDATE emission SET reviewed_by = $1 WHERE pk_id = ANY($2)`, [userId, feraIds]);
    }

    // Fetch manager details
    const userRepo = AppDataSource.getRepository(User);
    const manager = await userRepo.findOne({ where: { user_id: userId } });

    // Build summary for email content
    const totalCount = emissionsToApprove.length;
    const categorySummary: Record<string, number> = {};
    const creatorNames: string[] = [];
    for (const emission of emissionsToApprove) {
      const categoryName = (emission.category as any)?.category_name || "Uncategorized";
      categorySummary[categoryName] = (categorySummary[categoryName] || 0) + 1;
      const creator = emission.created_by;
      if (creator?.name) {
        const fullName = `${creator.name || ""} ${creator.last_name || ""}`.trim();
        if (!creatorNames.includes(fullName)) creatorNames.push(fullName);
      }
    }
    const categories = Object.entries(categorySummary).map(([categoryName, count]) => ({ categoryName, count }));

    const actionInfo = {
      submitterName: creatorNames.join(", ") || "User",
      submitterEmail: "",
      managerName: `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager",
      managerEmail: manager?.email || "",
      managerRole: manager?.role || "",
    };

    // Send email to each unique creator
    const creatorMap = new Map<number, User>();
    for (const emission of emissionsToApprove) {
      const creator = emission.created_by;
      if (creator?.email && !creatorMap.has(creator.user_id)) {
        creatorMap.set(creator.user_id, creator);
      }
    }

    for (const creator of creatorMap.values()) {
      await sendToQueue({
        type: "BULK_APPROVED",
        email: creator.email,
        name: `${creator.name || ""} ${creator.last_name || ""}`.trim() || "User",
        retryCount: 0,
        totalCount,
        categories,
        ...actionInfo,
      });
      const mgrName = `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager";
      await createNotification(
        creator.user_id,
        "BULK_APPROVED",
        "Emissions Approved",
        `${totalCount} emission(s) approved by ${mgrName}`,
        `/my-emissions`
      );
    }

    return res.status(200).json({
      message: `Approved ${eligibleIds.length} emission(s) from batch`,
      approved: eligibleIds.length,
    });
  } catch (error) {
    console.error("Approve emissions by batch error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Reject all emissions for a given upload batch (including approved)
export const rejectEmissionsByBatch = async (req: AuthRequest, res: Response) => {
  try {
    const batchId = req.params.batchId as string;
    const userId = req.user?.userId;
    const { comment } = req.body || {};

    if (!batchId) {
      return res.status(400).json({ message: "batchId is required" });
    }

    // Fetch emissions before updating for email notifications
    const emissionsToReject = await repo.find({
      where: { upload_batch_id: batchId, status: In([EmissionStatus.PENDING, EmissionStatus.APPROVED]) },
      relations: ["created_by", "category", "site"],
    });

    if (emissionsToReject.length === 0) {
      return res.status(404).json({
        message: "No emissions to reject in this batch",
      });
    }

    const eligibleIds = emissionsToReject.map((e) => e.pk_id);

    // Reject all non-rejected emissions in the batch (pending + approved)
    await repo.update(
      { pk_id: In(eligibleIds) },
      {
        status: EmissionStatus.REJECTED,
        review_comment: comment || null,
        reviewed_by: userId ? { user_id: userId } as any : null,
        reviewed_at: new Date(),
      }
    );

    // Auto-reject linked FERA entries
    const feraIds: number[] = [];
    for (const e of emissionsToReject) {
      if (e.fera_linked_id) feraIds.push(e.fera_linked_id);
    }
    const reverseLinked = await repo.find({
      where: { fera_linked_id: In(eligibleIds) },
      select: ["pk_id", "status"],
    });
    for (const e of reverseLinked) {
      if (e.status !== EmissionStatus.REJECTED) feraIds.push(e.pk_id);
    }
    if (feraIds.length > 0) {
      await repo
        .createQueryBuilder()
        .update()
        .set({ status: EmissionStatus.REJECTED, review_comment: comment || null, reviewed_at: new Date() })
        .where("pk_id IN (:...ids)", { ids: feraIds })
        .execute();
      if (userId) await repo.query(`UPDATE emission SET reviewed_by = $1 WHERE pk_id = ANY($2)`, [userId, feraIds]);
    }

    // Fetch manager details
    const userRepo = AppDataSource.getRepository(User);
    const manager = await userRepo.findOne({ where: { user_id: userId } });

    const totalCount = emissionsToReject.length;
    const categorySummary: Record<string, number> = {};
    const creatorNames: string[] = [];
    for (const emission of emissionsToReject) {
      const categoryName = (emission.category as any)?.category_name || "Uncategorized";
      categorySummary[categoryName] = (categorySummary[categoryName] || 0) + 1;
      const creator = emission.created_by;
      if (creator?.name) {
        const fullName = `${creator.name || ""} ${creator.last_name || ""}`.trim();
        if (!creatorNames.includes(fullName)) creatorNames.push(fullName);
      }
    }
    const categories = Object.entries(categorySummary).map(([categoryName, count]) => ({ categoryName, count }));

    const actionInfo = {
      submitterName: creatorNames.join(", ") || "User",
      submitterEmail: "",
      managerName: `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager",
      managerEmail: manager?.email || "",
      managerRole: manager?.role || "",
    };

    // Send email to each unique creator
    const creatorMap = new Map<number, User>();
    for (const emission of emissionsToReject) {
      const creator = emission.created_by;
      if (creator?.email && !creatorMap.has(creator.user_id)) {
        creatorMap.set(creator.user_id, creator);
      }
    }

    for (const creator of creatorMap.values()) {
      await sendToQueue({
        type: "BULK_REJECTED",
        email: creator.email,
        name: `${creator.name || ""} ${creator.last_name || ""}`.trim() || "User",
        retryCount: 0,
        totalCount,
        categories,
        comment: comment || "",
        ...actionInfo,
      });
      const mgrName = `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager";
      await createNotification(
        creator.user_id,
        "BULK_REJECTED",
        "Emissions Rejected",
        `${totalCount} emission(s) rejected by ${mgrName}${comment ? `. Reason: ${comment}` : ""}`,
        `/my-emissions`
      );
    }

    return res.status(200).json({
      message: `Rejected ${eligibleIds.length} emission(s) from batch`,
      rejected: eligibleIds.length,
    });
  } catch (error) {
    console.error("Reject emissions by batch error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get matched emission factor details for a given emission
// Priority: 1) stored snapshot (always accurate), 2) live DB lookup (fallback for old records)
export const getEmissionFactorForEmission = async (req: Request, res: Response) => {
  try {
    const emissionId = parseInt(req.params.id as string);
    if (isNaN(emissionId)) {
      return res.status(400).json({ message: "Valid emission id is required" });
    }

    const emission = await repo.findOne({
      where: { pk_id: emissionId },
      relations: ["site", "category"],
    });

    if (!emission) {
      return res.status(404).json({ message: "Emission not found" });
    }

    // 1) Prefer snapshot — it was captured at creation time and is always accurate
    if (emission.emission_factor_snapshot) {
      return res.status(200).json({
        emission_factor: emission.emission_factor_snapshot,
        source: "snapshot",
      });
    }

    // 2) Fallback: live lookup for emissions created before snapshots were introduced
    const siteId = emission.site.site_id;
    const categoryId = emission.category.category_id;
    const emissionCategory = emission.activity_data?.emission_category;

    if (!emissionCategory) {
      return res.status(200).json({ emission_factor: null, message: "No emission category on this record" });
    }

    // Calculate target year (same logic as createEmission)
    const reportingYearStr = typeof emission.date_of_reporting === "string"
      ? (emission.date_of_reporting as string).substring(0, 4)
      : new Date(emission.date_of_reporting).getFullYear().toString();
    const targetYear = parseInt(reportingYearStr) - 1;

    // 4-fallback lookup: exact name+year → global name+year → exact name any year → global name any year
    let emissionFactor = await emissionFactorRepo.findOne({
      where: { site: { site_id: siteId }, category: { category_id: categoryId }, emission_category_name: emissionCategory, year: targetYear },
    });
    if (!emissionFactor) {
      emissionFactor = await emissionFactorRepo.findOne({
        where: { site: { site_id: siteId }, category: { category_id: categoryId }, global_category_name: emissionCategory, year: targetYear },
      });
    }
    if (!emissionFactor) {
      emissionFactor = await emissionFactorRepo.findOne({
        where: { site: { site_id: siteId }, category: { category_id: categoryId }, emission_category_name: emissionCategory },
      });
    }
    if (!emissionFactor) {
      emissionFactor = await emissionFactorRepo.findOne({
        where: { site: { site_id: siteId }, category: { category_id: categoryId }, global_category_name: emissionCategory },
      });
    }

    // 5th fallback: case-insensitive ILIKE search
    if (!emissionFactor) {
      emissionFactor = await emissionFactorRepo
        .createQueryBuilder("ef")
        .where("ef.site_id = :siteId", { siteId })
        .andWhere("ef.category_id = :categoryId", { categoryId })
        .andWhere("LOWER(ef.emission_category_name) = LOWER(:name)", { name: emissionCategory })
        .orderBy("ABS(ef.year - :targetYear)", "ASC")
        .setParameter("targetYear", targetYear)
        .getOne();
    }

    if (!emissionFactor) {
      return res.status(200).json({ emission_factor: null, message: "No matching emission factor found" });
    }

    const factorData = {
      emission_factor_id: emissionFactor.emission_factor_id,
      emission_category_name: emissionFactor.emission_category_name,
      global_category_name: emissionFactor.global_category_name,
      factor_value: emissionFactor.factor_value,
      denominator_unit: emissionFactor.denominator_unit,
      source: emissionFactor.source,
      year: emissionFactor.year,
    };

    // Backfill: save snapshot on older records so future lookups are instant
    await repo.update(emissionId, { emission_factor_snapshot: factorData });

    return res.status(200).json({
      emission_factor: factorData,
      source: "lookup",
    });
  } catch (error) {
    console.error("Get emission factor for emission error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete all emissions for a given upload batch
export const deleteEmissionsByBatch = async (req: Request, res: Response) => {
  try {
    const batchId = req.params.batchId as string;
    if (!batchId) {
      return res.status(400).json({ message: "batchId is required" });
    }

    // Get all emission IDs in this batch
    const batchEmissions = await repo.find({
      where: { upload_batch_id: batchId },
      select: ["pk_id"],
    });

    if (batchEmissions.length === 0) {
      return res.status(404).json({ message: "No emissions found for this batch" });
    }

    const idsToDelete = batchEmissions.map((e) => e.pk_id);

    // Delete related documents first (in case DB cascade is not set)
    const docRepo = AppDataSource.getRepository(EmissionDocument);
    const CHUNK_SIZE = 5000;
    for (let i = 0; i < idsToDelete.length; i += CHUNK_SIZE) {
      const chunk = idsToDelete.slice(i, i + CHUNK_SIZE);
      await docRepo
        .createQueryBuilder()
        .delete()
        .where("emission_id IN (:...ids)", { ids: chunk })
        .execute();
    }

    const result = await repo.delete({ upload_batch_id: batchId });

    return res.status(200).json({
      message: `Deleted ${result.affected} emission(s) from batch`,
      deleted: result.affected,
    });
  } catch (error) {
    console.error("Delete emissions by batch error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get emissions pending approval (for managers)
export const getPendingEmissions = async (req: AuthRequest, res: Response) => {
  try {
    const { siteId, categoryId } = req.query;

    const whereClause: any = {
      status: EmissionStatus.PENDING,
    };

    // Only the caller's sites (all of them when none is named).
    const scoped = await scopeSiteIds(req.user!.userId, req.user!.role, siteId ? [parseInt(siteId as string)] : []);
    if (scoped.forbidden) return res.status(403).json(SITE_ACCESS_DENIED);
    if (scoped.siteIds) {
      if (!scoped.siteIds.length) return res.status(200).json([]);
      whereClause.site = { site_id: In(scoped.siteIds) };
    }

    if (categoryId) {
      whereClause.category = { category_id: parseInt(categoryId as string) };
    }

    const emissions = await repo.find({
      where: whereClause,
      relations: ["site", "category", "reviewed_by", "created_by"],
      order: { created_at: "DESC" },
    });

    return res.status(200).json(emissions);
  } catch (error) {
    console.error("Fetch pending emissions error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Approve an emission entry
export const approveEmission = async (req: AuthRequest, res: Response) => {
  try {
    const { id }: any = req.params;
    const { comment } = req.body || {};
    const userId = req.user?.userId;

    const emission = await repo.findOne({
      where: { pk_id: parseInt(id) },
      relations: ["site", "category"],
    });

    if (!emission) {
      return res.status(404).json({
        message: "Emission not found",
      });
    }

    if (emission.status !== EmissionStatus.PENDING) {
      return res.status(400).json({
        message: `Emission is already ${emission.status}`,
      });
    }

    emission.status = EmissionStatus.APPROVED;
    emission.review_comment = comment || null;
    emission.reviewed_by = { user_id: userId } as any;
    emission.reviewed_at = new Date();

    await repo.save(emission);

    // Auto-approve linked FERA entries (bidirectional)
    const feraLinkedIds: number[] = [];
    if (emission.fera_linked_id) feraLinkedIds.push(emission.fera_linked_id);
    const linkedBack = await repo.findOne({ where: { fera_linked_id: emission.pk_id } });
    if (linkedBack) feraLinkedIds.push(linkedBack.pk_id);
    for (const fId of feraLinkedIds) {
      const feraEmission = await repo.findOne({ where: { pk_id: fId } });
      if (feraEmission && feraEmission.status === EmissionStatus.PENDING) {
        feraEmission.status = EmissionStatus.APPROVED;
        feraEmission.review_comment = comment || null;
        feraEmission.reviewed_by = { user_id: userId } as any;
        feraEmission.reviewed_at = new Date();
        await repo.save(feraEmission);
      }
    }

    const fullEmission = await repo.findOne({
      where: { pk_id: emission.pk_id },
      relations: ["created_by", "site", "category"],
    });

    // Fetch manager details for email
    const userRepo = AppDataSource.getRepository(User);
    const manager = await userRepo.findOne({ where: { user_id: userId } });

    const creator = fullEmission?.created_by;
    const actionInfo = {
      submitterName: `${creator?.name || ""} ${creator?.last_name || ""}`.trim() || "User",
      submitterEmail: creator?.email || "",
      managerName: `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager",
      managerEmail: manager?.email || "",
      managerRole: manager?.role || "",
      deepLink: `/my-emissions`,
    };

    if (creator?.email) {
      await sendToQueue({
        type: "APPROVED",
        email: creator.email,
        name: `${creator?.name || ""} ${creator?.last_name || ""}`.trim() || "User",
        retryCount: 0,
        categoryName: (fullEmission?.category as any)?.category_name || "Uncategorized",
        siteName: (fullEmission?.site as any)?.name || "",
        ...actionInfo,
      });
    }

    // In-app notification
    if (creator?.user_id) {
      const catName = (fullEmission?.category as any)?.category_name || "Uncategorized";
      const siteName = (fullEmission?.site as any)?.name || "";
      const mgrName = `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager";
      await createNotification(
        creator.user_id,
        "APPROVED",
        "Emission Approved",
        `Your ${catName} emission for ${siteName} was approved by ${mgrName}`,
        `/my-emissions`
      );
    }

    log.info("Emission", "Approved", { id: emission.pk_id, managerId: req.user?.userId });

    return res.status(200).json({
      message: "Emission approved successfully",
      emission: fullEmission,
    });
  } catch (error) {
    console.error("Approve emission error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Reject an emission entry
export const rejectEmission = async (req: AuthRequest, res: Response) => {
  try {
    const { id }: any = req.params;
    const { comment } = req.body || {};
    const userId = req.user?.userId;

    if (!comment) {
      return res.status(400).json({
        message: "Comment is required when rejecting an emission",
      });
    }

    const emission = await repo.findOne({
      where: { pk_id: parseInt(id) },
      relations: ["site", "category"],
    });

    if (!emission) {
      return res.status(404).json({
        message: "Emission not found",
      });
    }

    if (emission.status !== EmissionStatus.PENDING) {
      return res.status(400).json({
        message: `Emission is already ${emission.status}`,
      });
    }

    emission.status = EmissionStatus.REJECTED;
    emission.review_comment = comment;
    emission.reviewed_by = { user_id: userId } as any;
    emission.reviewed_at = new Date();

    await repo.save(emission);

    // Auto-reject linked FERA entries (bidirectional)
    const feraLinkedIds: number[] = [];
    if (emission.fera_linked_id) feraLinkedIds.push(emission.fera_linked_id);
    const linkedBack = await repo.findOne({ where: { fera_linked_id: emission.pk_id } });
    if (linkedBack) feraLinkedIds.push(linkedBack.pk_id);
    for (const fId of feraLinkedIds) {
      const feraEmission = await repo.findOne({ where: { pk_id: fId } });
      if (feraEmission && feraEmission.status === EmissionStatus.PENDING) {
        feraEmission.status = EmissionStatus.REJECTED;
        feraEmission.review_comment = comment;
        feraEmission.reviewed_by = { user_id: userId } as any;
        feraEmission.reviewed_at = new Date();
        await repo.save(feraEmission);
      }
    }

    const fullEmission = await repo.findOne({
      where: { pk_id: emission.pk_id },
      relations: ["created_by", "site", "category"],
    });

    // Fetch manager details for email
    const userRepo = AppDataSource.getRepository(User);
    const manager = await userRepo.findOne({ where: { user_id: userId } });

    const creator = fullEmission?.created_by;
    const actionInfo = {
      submitterName: `${creator?.name || ""} ${creator?.last_name || ""}`.trim() || "User",
      submitterEmail: creator?.email || "",
      managerName: `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager",
      managerEmail: manager?.email || "",
      managerRole: manager?.role || "",
      deepLink: `/my-emissions`,
    };

    if (creator?.email) {
      await sendToQueue({
        type: "REJECTED",
        email: creator.email,
        name: `${creator?.name || ""} ${creator?.last_name || ""}`.trim() || "User",
        retryCount: 0,
        categoryName: (fullEmission?.category as any)?.category_name || "Uncategorized",
        siteName: (fullEmission?.site as any)?.name || "",
        comment: fullEmission?.review_comment || "",
        ...actionInfo,
      });
    }

    // In-app notification
    if (creator?.user_id) {
      const catName = (fullEmission?.category as any)?.category_name || "Uncategorized";
      const siteName = (fullEmission?.site as any)?.name || "";
      const mgrName = `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager";
      await createNotification(
        creator.user_id,
        "REJECTED",
        "Emission Rejected",
        `Your ${catName} emission for ${siteName} was rejected by ${mgrName}${comment ? `. Reason: ${comment}` : ""}`,
        `/my-emissions`
      );
    }

    log.info("Emission", "Rejected", { id: emission.pk_id, managerId: req.user?.userId, comment: comment || "" });

    return res.status(200).json({
      message: "Emission rejected",
      emission: fullEmission,
    });
  } catch (error) {
    console.error("Reject emission error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Bulk approve emissions
export const bulkApproveEmissions = async (req: AuthRequest, res: Response) => {
  try {
    const { ids, comment } = req.body;
    const userId = req.user?.userId;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "ids array is required",
      });
    }

    const emissionsToApprove = await repo.find({
      where: { pk_id: In(ids), status: EmissionStatus.PENDING },
      relations: ["created_by", "category", "site"],
    });

    if (emissionsToApprove.length === 0) {
      return res.status(400).json({
        message: "No pending emissions found to approve",
      });
    }

    const eligibleIds = emissionsToApprove.map((e) => e.pk_id);

    await repo.update(
      { pk_id: In(eligibleIds), status: EmissionStatus.PENDING },
      {
        status: EmissionStatus.APPROVED,
        review_comment: comment || null,
        reviewed_by: { user_id: userId } as any,
        reviewed_at: new Date(),
      }
    );

    // Auto-approve linked FERA entries
    const feraIds: number[] = [];
    for (const e of emissionsToApprove) {
      if (e.fera_linked_id) feraIds.push(e.fera_linked_id);
    }
    const reverseLinked = await repo.find({
      where: { fera_linked_id: In(eligibleIds), status: EmissionStatus.PENDING },
      select: ["pk_id"],
    });
    for (const e of reverseLinked) feraIds.push(e.pk_id);

    if (feraIds.length > 0) {
      await repo
        .createQueryBuilder()
        .update()
        .set({ status: EmissionStatus.APPROVED, review_comment: comment || null, reviewed_at: new Date() })
        .where("pk_id IN (:...ids) AND status = :status", { ids: feraIds, status: EmissionStatus.PENDING })
        .execute();
      if (userId) await repo.query(`UPDATE emission SET reviewed_by = $1 WHERE pk_id = ANY($2)`, [userId, feraIds]);
    }

    // Fetch manager details
    const userRepo = AppDataSource.getRepository(User);
    const manager = await userRepo.findOne({ where: { user_id: userId } });

    const totalCount = emissionsToApprove.length;
    const categorySummary: Record<string, number> = {};
    const creatorNames: string[] = [];
    for (const emission of emissionsToApprove) {
      const categoryName = (emission.category as any)?.category_name || "Uncategorized";
      categorySummary[categoryName] = (categorySummary[categoryName] || 0) + 1;
      const creator = emission.created_by;
      if (creator?.name) {
        const fullName = `${creator.name || ""} ${creator.last_name || ""}`.trim();
        if (!creatorNames.includes(fullName)) creatorNames.push(fullName);
      }
    }
    const categories = Object.entries(categorySummary).map(([categoryName, count]) => ({ categoryName, count }));

    const actionInfo = {
      submitterName: creatorNames.join(", ") || "User",
      submitterEmail: "",
      managerName: `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager",
      managerEmail: manager?.email || "",
      managerRole: manager?.role || "",
    };

    const creatorMap = new Map<number, User>();
    for (const emission of emissionsToApprove) {
      const creator = emission.created_by;
      if (creator?.email && !creatorMap.has(creator.user_id)) {
        creatorMap.set(creator.user_id, creator);
      }
    }

    for (const creator of creatorMap.values()) {
      await sendToQueue({
        type: "BULK_APPROVED",
        email: creator.email,
        name: `${creator.name || ""} ${creator.last_name || ""}`.trim() || "User",
        retryCount: 0,
        totalCount,
        categories,
        ...actionInfo,
      });
      const mgrName = `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager";
      await createNotification(
        creator.user_id,
        "BULK_APPROVED",
        "Emissions Approved",
        `${totalCount} emission(s) approved by ${mgrName}`,
        `/my-emissions`
      );
    }

    log.info("Emission", "Bulk approved", { count: eligibleIds.length, managerId: req.user?.userId });

    return res.status(200).json({
      message: `${eligibleIds.length} emissions approved successfully`,
    });
  } catch (error) {
    log.error("Emission", "Bulk approve failed", { error: (error as Error).message });
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// Bulk reject emissions
export const bulkRejectEmissions = async (req: AuthRequest, res: Response) => {
  try {
    const { ids, comment } = req.body;
    const userId = req.user?.userId;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "ids array is required",
      });
    }

    if (!comment) {
      return res.status(400).json({
        message: "Comment is required when rejecting emissions",
      });
    }

    const emissionsToReject = await repo.find({
      where: { pk_id: In(ids), status: EmissionStatus.PENDING },
      relations: ["created_by", "category", "site"],
    });

    if (emissionsToReject.length === 0) {
      return res.status(400).json({
        message: "No pending emissions found to reject",
      });
    }

    const eligibleIds = emissionsToReject.map((e) => e.pk_id);

    await repo.update(
      { pk_id: In(eligibleIds), status: EmissionStatus.PENDING },
      {
        status: EmissionStatus.REJECTED,
        review_comment: comment,
        reviewed_by: { user_id: userId } as any,
        reviewed_at: new Date(),
      }
    );

    // Auto-reject linked FERA entries
    const feraIds: number[] = [];
    for (const e of emissionsToReject) {
      if (e.fera_linked_id) feraIds.push(e.fera_linked_id);
    }
    const reverseLinked = await repo.find({
      where: { fera_linked_id: In(eligibleIds), status: EmissionStatus.PENDING },
      select: ["pk_id"],
    });
    for (const e of reverseLinked) feraIds.push(e.pk_id);

    if (feraIds.length > 0) {
      await repo
        .createQueryBuilder()
        .update()
        .set({ status: EmissionStatus.REJECTED, review_comment: comment, reviewed_at: new Date() })
        .where("pk_id IN (:...ids) AND status = :status", { ids: feraIds, status: EmissionStatus.PENDING })
        .execute();
      if (userId) await repo.query(`UPDATE emission SET reviewed_by = $1 WHERE pk_id = ANY($2)`, [userId, feraIds]);
    }

    // Fetch manager details
    const userRepo = AppDataSource.getRepository(User);
    const manager = await userRepo.findOne({ where: { user_id: userId } });

    const totalCount = emissionsToReject.length;
    const categorySummary: Record<string, number> = {};
    const creatorNames: string[] = [];
    for (const emission of emissionsToReject) {
      const categoryName = (emission.category as any)?.category_name || "Uncategorized";
      categorySummary[categoryName] = (categorySummary[categoryName] || 0) + 1;
      const creator = emission.created_by;
      if (creator?.name) {
        const fullName = `${creator.name || ""} ${creator.last_name || ""}`.trim();
        if (!creatorNames.includes(fullName)) creatorNames.push(fullName);
      }
    }
    const categories = Object.entries(categorySummary).map(([categoryName, count]) => ({ categoryName, count }));

    const actionInfo = {
      submitterName: creatorNames.join(", ") || "User",
      submitterEmail: "",
      managerName: `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager",
      managerEmail: manager?.email || "",
      managerRole: manager?.role || "",
    };

    const creatorMap = new Map<number, User>();
    for (const emission of emissionsToReject) {
      const creator = emission.created_by;
      if (creator?.email && !creatorMap.has(creator.user_id)) {
        creatorMap.set(creator.user_id, creator);
      }
    }

    for (const creator of creatorMap.values()) {
      await sendToQueue({
        type: "BULK_REJECTED",
        email: creator.email,
        name: `${creator.name || ""} ${creator.last_name || ""}`.trim() || "User",
        retryCount: 0,
        totalCount,
        categories,
        comment,
        ...actionInfo,
      });
      const mgrName = `${manager?.name || ""} ${manager?.last_name || ""}`.trim() || "Manager";
      await createNotification(
        creator.user_id,
        "BULK_REJECTED",
        "Emissions Rejected",
        `${totalCount} emission(s) rejected by ${mgrName}${comment ? `. Reason: ${comment}` : ""}`,
        `/my-emissions`
      );
    }

    log.info("Emission", "Bulk rejected", { count: eligibleIds.length, managerId: req.user?.userId, comment });

    return res.status(200).json({
      message: `${eligibleIds.length} emissions rejected`,
    });
  } catch (error) {
    log.error("Emission", "Bulk reject failed", { error: (error as Error).message });
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getApprovedEmissionsReport = async (req: Request, res: Response) => {
   try {
    const { siteIds, categoryIds, frequency, year, month } = req.body as {
      siteIds: number[];
      categoryIds?: number[];
      frequency: "yearly" | "monthly";
      year: number;
      month?: number;
    };

    if (!siteIds?.length || !year || !frequency) {
      return res.status(400).json({ message: "siteIds, frequency and year are required" });
    }

     let startDate: Date;
    let endDate: Date;

     if (frequency === "monthly") {
      if (!month) {
        return res.status(400).json({ message: "month is required for monthly frequency" });
      }
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0);
    } else {
      startDate = new Date(year, 0, 1);
      endDate = new Date(year, 11, 31);
    }

    const repo = AppDataSource.getRepository(Emission);

    const baseQuery = repo
      .createQueryBuilder("emission")
      .leftJoin("emission.category", "category")
      .leftJoin("emission.site", "site")
      .where("emission.status = :status", { status: EmissionStatus.APPROVED })
      .andWhere("site.site_id IN (:...siteIds)", { siteIds })
      .andWhere("emission.date_of_reporting >= :startDate", { startDate })
      .andWhere("emission.date_of_reporting <= :endDate", { endDate });

    if (categoryIds?.length) {
      baseQuery.andWhere("category.category_id IN (:...categoryIds)", { categoryIds });
    }
     const totalsRaw = await baseQuery.clone().select([
      `SUM(CASE WHEN category.scope = 'Scope 1' THEN emission.total_emission ELSE 0 END) AS "scope1"`,
      `SUM(CASE WHEN category.scope = 'Scope 2' THEN emission.total_emission ELSE 0 END) AS "scope2"`,
      `SUM(CASE WHEN category.scope = 'Scope 3' THEN emission.total_emission ELSE 0 END) AS "scope3"`,
    ]).getRawOne();

    const scope1 = Number(totalsRaw.scope1) || 0;
    const scope2 = Number(totalsRaw.scope2) || 0;
    const scope3 = Number(totalsRaw.scope3) || 0;
    const total = scope1 + scope2 + scope3;
    
   const bySiteRaw = await baseQuery
      .clone()
      .select([
        `site.site_id AS "siteId"`,
        `site.name AS "siteName"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 1' THEN emission.total_emission ELSE 0 END), 0) AS "scope1"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 2' THEN emission.total_emission ELSE 0 END), 0) AS "scope2"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 3' THEN emission.total_emission ELSE 0 END), 0) AS "scope3"`,
      ])
      .groupBy("site.site_id")
      .addGroupBy("site.name")
      .orderBy("site.name", "ASC")
      .getRawMany();

    const bySite = bySiteRaw.map((r) => {
      const s1 = Number(r.scope1) || 0;
      const s2 = Number(r.scope2) || 0;
      const s3 = Number(r.scope3) || 0;
      const siteTotal = s1 + s2 + s3;

      return {
        siteId: Number(r.siteId),
        siteName: String(r.siteName),
        scope1: s1,
        scope2: s2,
        scope3: s3,
        total: siteTotal,
        pctOfTotal: total ? Number(((siteTotal / total) * 100).toFixed(2)) : 0,
      };
    });

    const monthlyRaw = await baseQuery
      .clone()
      .select([
        `to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM') AS "month"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 1' THEN emission.total_emission ELSE 0 END), 0) AS "scope1"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 2' THEN emission.total_emission ELSE 0 END), 0) AS "scope2"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 3' THEN emission.total_emission ELSE 0 END), 0) AS "scope3"`,
      ])
      .groupBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`)
      .orderBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`, "ASC")
      .getRawMany();

    const monthly = monthlyRaw.map((m) => {
      const s1 = Number(m.scope1) || 0;
      const s2 = Number(m.scope2) || 0;
      const s3 = Number(m.scope3) || 0;
      return {
        month: String(m.month),
        scope1: s1,
        scope2: s2,
        scope3: s3,
        total: s1 + s2 + s3,
      };
    });

    return res.status(200).json({
      totals: { scope1, scope2, scope3, total },
      bySite,
      monthly,
    });

  }
  catch (error) {
    console.error("Get approved emissions report error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

type Frequency = "yearly" | "monthly";


export const getEdeReport = async(req:Request, res:Response) =>{
  try {
    const { siteIds, categoryIds, frequency, year, month } = req.body as {
      siteIds: number[];
      categoryIds?: number[];
      frequency: Frequency;
      year: number;
      month?: number;
    };

    if (!siteIds || siteIds.length === 0) {
      return res.status(400).json({ message: "siteIds is required" });
    }
    if (!year || !frequency) {
      return res.status(400).json({ message: "frequency and year are required" });
    }
    if (frequency === "monthly" && (!month || month < 1 || month > 12)) {
      return res.status(400).json({ message: "month (1-12) is required for monthly frequency" });
    }
     let startDate: Date;
    let endDate: Date;

    if (frequency === "monthly") {
      startDate = new Date(year, (month as number) - 1, 1);
      endDate = new Date(year, month as number, 0);
    } else {
      startDate = new Date(year, 0, 1);
      endDate = new Date(year, 11, 31);
    }

    const repo = AppDataSource.getRepository(Emission);

     const base = repo
      .createQueryBuilder("emission")
      .leftJoin("emission.site", "site")
      .leftJoin("emission.category", "category")
      .where("emission.status = :status", { status: EmissionStatus.APPROVED })
      .andWhere("site.site_id IN (:...siteIds)", { siteIds })
      .andWhere("emission.date_of_reporting >= :startDate", { startDate })
      .andWhere("emission.date_of_reporting <= :endDate", { endDate });

      if (categoryIds && categoryIds.length > 0) {
      base.andWhere("category.category_id IN (:...categoryIds)", { categoryIds });
    }
    const totalsRaw = await base.clone().select([
      `COALESCE(SUM(CASE WHEN category.scope = 'Scope 1' THEN emission.total_emission ELSE 0 END), 0) AS "scope1"`,
      `COALESCE(SUM(CASE WHEN category.scope = 'Scope 2' THEN emission.total_emission ELSE 0 END), 0) AS "scope2"`,
      `COALESCE(SUM(CASE WHEN category.scope = 'Scope 3' THEN emission.total_emission ELSE 0 END), 0) AS "scope3"`,
    ]).getRawOne();

    const scope1 = Number(totalsRaw.scope1) || 0;
    const scope2 = Number(totalsRaw.scope2) || 0;
    const scope3 = Number(totalsRaw.scope3) || 0;
    const total = scope1 + scope2 + scope3;
    const bySiteRaw = await base.clone()
      .select([
        `site.site_id AS "siteId"`,
        `site.name AS "siteName"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 1' THEN emission.total_emission ELSE 0 END), 0) AS "scope1"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 2' THEN emission.total_emission ELSE 0 END), 0) AS "scope2"`,
        `COALESCE(SUM(CASE WHEN category.scope = 'Scope 3' THEN emission.total_emission ELSE 0 END), 0) AS "scope3"`,
      ])
      .groupBy("site.site_id")
      .addGroupBy("site.name")
      .orderBy("site.name", "ASC")
      .getRawMany();

    const bySite = bySiteRaw.map((r) => {
      const s1 = Number(r.scope1) || 0;
      const s2 = Number(r.scope2) || 0;
      const s3 = Number(r.scope3) || 0;
      const siteTotal = s1 + s2 + s3;

      return {
        siteId: Number(r.siteId),
        siteName: String(r.siteName),
        scope1: s1,
        scope2: s2,
        scope3: s3,
        total: siteTotal,
        pctOfTotal: total ? Number(((siteTotal / total) * 100).toFixed(2)) : 0,
      };
    });
     const siteDonut = bySite.map((s) => ({
      name: s.siteName,
      value: Number(s.total.toFixed(2)),
      pct: s.pctOfTotal,
    }));
    const monthlyBySiteRaw = await base.clone()
      .select([
        `to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM') AS "month"`,
        `site.site_id AS "siteId"`,
        `site.name AS "siteName"`,
        `COALESCE(SUM(CASE WHEN category.scope IN ('Scope 1','Scope 2','Scope 3') THEN emission.total_emission ELSE 0 END), 0) AS "total"`,
      ])
      .groupBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`)
      .addGroupBy("site.site_id")
      .addGroupBy("site.name")
      .orderBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`, "ASC")
      .addOrderBy("site.name", "ASC")
      .getRawMany();

       const monthlyBySite = monthlyBySiteRaw.map((m) => ({
      month: String(m.month), 
      siteId: Number(m.siteId),
      siteName: String(m.siteName),
      total: Number(m.total) || 0,
    }));

    const savedBySiteRaw = await base.clone()
      .select([
        `site.site_id AS "siteId"`,
        `site.name AS "siteName"`,
        `COALESCE(SUM(CASE WHEN category.scope IS NULL THEN emission.total_emission ELSE 0 END), 0) AS "saved"`,
      ])
      .groupBy("site.site_id")
      .addGroupBy("site.name")
      .orderBy("site.name", "ASC")
      .getRawMany();

    const savedBySite = savedBySiteRaw.map((r) => ({
      siteId: Number(r.siteId),
      siteName: String(r.siteName),
      saved: Number(r.saved) || 0, 
    }));

     const renewableKwhBySiteRaw = await base.clone()
      .select([
        `site.site_id AS "siteId"`,
        `site.name AS "siteName"`,
        `
          COALESCE(
            SUM(
              CASE WHEN category.scope IS NULL THEN
                COALESCE(
                  NULLIF((emission.activity_data->>'Activity Data')::numeric, NULL),
                  NULLIF((emission.activity_data->>'activity_value')::numeric, NULL),
                  NULLIF((emission.activity_data->>'value')::numeric, NULL),
                  NULLIF((emission.activity_data->>'quantity')::numeric, NULL),
                  0
                )
              ELSE 0 END
            ),
          0) AS "kwh"
        `,
      ])
      .groupBy("site.site_id")
      .addGroupBy("site.name")
      .orderBy("site.name", "ASC")
      .getRawMany();

    const renewableKwhBySite = renewableKwhBySiteRaw.map((r) => ({
      siteId: Number(r.siteId),
      siteName: String(r.siteName),
      kwh: Number(r.kwh) || 0,
      unit: "kWh",
    }));

    const intensityEmissionsRaw = await base.clone()
   .select([
    `to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM') AS "month"`,
    `site.site_id AS "siteId"`,
    `site.name AS "siteName"`,
    `
      COALESCE(
        SUM(
          CASE 
            WHEN category.scope IN ('Scope 1','Scope 2','Scope 3')
            THEN emission.total_emission
            ELSE 0
          END
        ),
      0) AS "emissions"
    `,
  ])
  .groupBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`)
  .addGroupBy("site.site_id")
  .addGroupBy("site.name")
  .orderBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`, "ASC")
  .addOrderBy("site.name", "ASC")
  .getRawMany();


  const prodRepo = AppDataSource.getRepository(ProductionData);

const monthlyProductionRaw = await prodRepo
  .createQueryBuilder("pd")
  .leftJoin("pd.site", "site")
  .select([
    `to_char(date_trunc('month', pd.start_date), 'YYYY-MM') AS "month"`,
    `site.site_id AS "siteId"`,
    `site.name AS "siteName"`,
    `COALESCE(SUM(pd.quantity), 0) AS "production"`,
    `MAX(pd.unit) AS "unit"`,
  ])
  .where("pd.status = :status", { status: ProductionDataStatus.APPROVED })
  .andWhere("site.site_id IN (:...siteIds)", { siteIds })
  .andWhere("pd.start_date <= :endDate AND pd.end_date >= :startDate", {
    startDate,
    endDate,
  })
  .groupBy(`to_char(date_trunc('month', pd.start_date), 'YYYY-MM')`)
  .addGroupBy("site.site_id")
  .addGroupBy("site.name")
  .orderBy(`to_char(date_trunc('month', pd.start_date), 'YYYY-MM')`, "ASC")
  .addOrderBy("site.name", "ASC")
  .getRawMany();

  const productionBySiteMonth = new Map<string, { production: number; unit: string }>();


monthlyProductionRaw.forEach((r) => {
  const key = `${Number(r.siteId)}|${String(r.month)}`;
  productionBySiteMonth.set(key, {
    production: Number(r.production) || 0,
    unit: String(r.unit || "unit"),
  });
});
  const intensityMonthly = intensityEmissionsRaw.map((r) => {
  const siteId = Number(r.siteId);
  const siteName = String(r.siteName);
  const month = String(r.month);
  const emissions = Number(r.emissions) || 0;

  const key = `${siteId}|${month}`;
  const prod = productionBySiteMonth.get(key);

  const production = prod?.production || 0;
  const unit = prod?.unit || "unit";

  const intensity =
    production > 0
      ? Number((emissions / production).toFixed(6))
      : 0;

  return {
    siteId,
    siteName,
    month,
    emissions,
    production,
    intensity,
    unit,
  };
});

      return res.status(200).json({
      range: {
        frequency,
        year,
        month: frequency === "monthly" ? month : null,
        startDate,
        endDate,
      },
      totals: { scope1, scope2, scope3, total },

      bySite,      
      siteDonut,    

      monthlyBySite,        
      savedBySite,          
      renewableKwhBySite,   

      intensityMonthly,    
    });

  }
  catch(error)
  {
    console.error("EDE report error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }

}

function yearStartEnd(year: number) {
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);
  return { startDate, endDate };
}

function powTarget(base: number, rate: number, n: number) {
  // Protect against negative/NaN
  const r = Math.max(0, Math.min(rate, 1));
  return base * Math.pow(1 - r, n);
}


export const getNearTermTargetTables = async (req: Request, res: Response) => {
  try {
    const { siteIds, baseYear, targetYear, annualRate } = req.body as {
      siteIds: number[];
      baseYear: number;
      targetYear: number;
      annualRate?: number;
    };

    if (!siteIds?.length || !baseYear || !targetYear) {
      return res.status(400).json({ message: "siteIds, baseYear and targetYear are required" });
    }

    const horizonYears = targetYear - baseYear;

    if (horizonYears < 5 || horizonYears > 10) {
      return res.status(400).json({
        message: `Target year must be 5 to 10 years from base year as per SBTi Near-Term rules. Got ${horizonYears} years.`,
      });
    }

    const RATE = typeof annualRate === "number" ? annualRate : 0.042;

    const repo = AppDataSource.getRepository(Emission);

    const buildBaseQuery = (startDate: Date, endDate: Date) => {
      return repo
        .createQueryBuilder("emission")
        .leftJoin("emission.category", "category")
        .leftJoin("emission.site", "site")
        .where("emission.status = :status", { status: EmissionStatus.APPROVED })
        .andWhere("site.site_id IN (:...siteIds)", { siteIds })
        .andWhere("emission.date_of_reporting >= :startDate", { startDate })
        .andWhere("emission.date_of_reporting <= :endDate", { endDate })
        .andWhere("LOWER(category.category_name) != :ren", { ren: "renewable electricity" });
    };

    const getTotalsForYear = async (year: number) => {
      const { startDate, endDate } = yearStartEnd(year);

      const raw = await buildBaseQuery(startDate, endDate)
        .select([
          `SUM(CASE WHEN LOWER(category.scope) = 'scope 1' THEN emission.total_emission ELSE 0 END) AS "scope1"`,
          `SUM(CASE WHEN LOWER(category.scope) = 'scope 2' THEN emission.total_emission ELSE 0 END) AS "scope2"`,
          `SUM(CASE WHEN LOWER(category.scope) = 'scope 3' THEN emission.total_emission ELSE 0 END) AS "scope3"`,
        ])
        .getRawOne();

      const scope1 = Number(raw?.scope1) || 0;
      const scope2 = Number(raw?.scope2) || 0;
      const scope3 = Number(raw?.scope3) || 0;

      return { scope1, scope2, scope3, total: scope1 + scope2 + scope3 };
    };

    const baseTotalsAll = await getTotalsForYear(baseYear);

    if (!baseTotalsAll.total) {
      return res.status(400).json({
        message: `No approved emissions found for baseYear=${baseYear} with the provided filters.`,
      });
    }

    const scope3Share = baseTotalsAll.total > 0 ? baseTotalsAll.scope3 / baseTotalsAll.total : 0;
    const scope3TargetRequired = scope3Share >= 0.4;

    const scope1And2Total = baseTotalsAll.scope1 + baseTotalsAll.scope2;
    const scope1And2CoveragePct =
      baseTotalsAll.total > 0 ? (scope1And2Total / baseTotalsAll.total) * 100 : 0;
    const scope1And2CoverageValid = scope1And2CoveragePct >= 95;

    const targetBoundaryBase = scope3TargetRequired
      ? baseTotalsAll.scope1 + baseTotalsAll.scope2 + baseTotalsAll.scope3
      : baseTotalsAll.scope1 + baseTotalsAll.scope2;

    const table1: Array<{
      year: number;
      n: number;
      calculation: string;
      targetEmission: number;
      reducedBy: number | null;
      reducedByPct: number | null;
    }> = [];

    const table2: Array<{
      year: number;
      n: number;
      scope1Target: number;
      scope2Target: number;
      scope3Target: number | null;
      totalTarget: number;
      reducedBy: number | null;
      reducedByPct: number | null;
    }> = [];

    for (let year = baseYear; year <= targetYear; year++) {
      const n = year - baseYear;

      const totalTarget = powTarget(targetBoundaryBase, RATE, n);
      const scope1Target = powTarget(baseTotalsAll.scope1, RATE, n);
      const scope2Target = powTarget(baseTotalsAll.scope2, RATE, n);
      const scope3Target = scope3TargetRequired ? powTarget(baseTotalsAll.scope3, RATE, n) : null;
      const totalFromScopes = scope1Target + scope2Target + (scope3Target ?? 0);

      const prevTotalTarget = n === 0 ? null : powTarget(targetBoundaryBase, RATE, n - 1);
      const reducedBy = prevTotalTarget === null ? null : prevTotalTarget - totalTarget;
      const reducedByPct =
        prevTotalTarget === null || prevTotalTarget === 0
          ? null
          : (reducedBy! / prevTotalTarget) * 100;

      table1.push({
        year,
        n,
        calculation: `${targetBoundaryBase.toFixed(0)} × (${(1 - RATE).toFixed(3)})^${n}`,
        targetEmission: Number(totalTarget.toFixed(3)),
        reducedBy: reducedBy === null ? null : Number(reducedBy.toFixed(3)),
        reducedByPct: reducedByPct === null ? null : Number(reducedByPct.toFixed(3)),
      });

      table2.push({
        year,
        n,
        scope1Target: Number(scope1Target.toFixed(3)),
        scope2Target: Number(scope2Target.toFixed(3)),
        scope3Target: scope3Target === null ? null : Number(scope3Target.toFixed(3)),
        totalTarget: Number(totalFromScopes.toFixed(3)),
        reducedBy: reducedBy === null ? null : Number(reducedBy.toFixed(3)),
        reducedByPct: reducedByPct === null ? null : Number(reducedByPct.toFixed(3)),
      });
    }

    const table3: Array<{
      year: number;
      actualScope1: number;
      actualScope2: number;
      actualScope3: number | null;
      actualTotal: number;
      targetTotal: number;
      variance: number;
      variancePct: number | null;
      status: "Base Year" | "Reached" | "Not Reached" | "No Data";
    }> = [];

    for (let year = baseYear; year <= targetYear; year++) {
      const actualAll = await getTotalsForYear(year);
      const targetTotal = table1.find((r) => r.year === year)!.targetEmission;

      const actualBoundaryTotal = scope3TargetRequired
        ? actualAll.scope1 + actualAll.scope2 + actualAll.scope3
        : actualAll.scope1 + actualAll.scope2;

      const isBaseYear = year === baseYear;
      const hasBoundaryData = actualBoundaryTotal > 0;
      const variance = hasBoundaryData ? actualBoundaryTotal - targetTotal : 0;
      const variancePct =
        hasBoundaryData && targetTotal > 0 ? (variance / targetTotal) * 100 : null;

      table3.push({
        year,
        actualScope1: Number(actualAll.scope1.toFixed(3)),
        actualScope2: Number(actualAll.scope2.toFixed(3)),
        actualScope3: scope3TargetRequired ? Number(actualAll.scope3.toFixed(3)) : null,
        actualTotal: Number(actualBoundaryTotal.toFixed(3)),
        targetTotal: Number(targetTotal.toFixed(3)),
        variance: Number(variance.toFixed(3)),
        variancePct: variancePct === null ? null : Number(variancePct.toFixed(2)),
        status: isBaseYear
          ? "Base Year"
          : !hasBoundaryData
          ? "No Data"
          : actualBoundaryTotal <= targetTotal
          ? "Reached"
          : "Not Reached",
      });
    }

    return res.status(200).json({
      heading: "Near-Term Target",
      method: "ABSOLUTE_CONTRACTION",
      annualRate: RATE,
      baseYear,
      targetYear,
      horizonYears,
      scope3Share: Number((scope3Share * 100).toFixed(2)),
      scope3TargetRequired,
      scope1And2CoveragePct: Number(scope1And2CoveragePct.toFixed(2)),
      scope1And2CoverageValid,
      baseTotals: baseTotalsAll,
      targetBoundaryBase: Number(targetBoundaryBase.toFixed(3)),
      tables: { table1, table2, table3 },
    });
  } catch (error) {
    console.error("getNearTermTargetTables error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const getLongTermTargetChart = async (req: Request, res: Response) => {
  try {
    const { siteIds, baseYear } = req.body as {
      siteIds: number[];
      baseYear: number;
    };

    if (!siteIds?.length || !baseYear) {
      return res.status(400).json({ message: "siteIds and baseYear are required" });
    }

    const NET_ZERO_YEAR = 2050;
    const NET_ZERO_REDUCTION = 0.9;

    if (baseYear >= NET_ZERO_YEAR) {
      return res.status(400).json({ message: "Base year must be before 2050." });
    }

    const years = NET_ZERO_YEAR - baseYear;

    const repo = AppDataSource.getRepository(Emission);

    const buildBaseQuery = (startDate: Date, endDate: Date) => {
      return repo
        .createQueryBuilder("emission")
        .leftJoin("emission.category", "category")
        .leftJoin("emission.site", "site")
        .where("emission.status = :status", { status: EmissionStatus.APPROVED })
        .andWhere("site.site_id IN (:...siteIds)", { siteIds })
        .andWhere("emission.date_of_reporting >= :startDate", { startDate })
        .andWhere("emission.date_of_reporting <= :endDate", { endDate })
        .andWhere("LOWER(category.category_name) != :ren", { ren: "renewable electricity" });
    };

    const getTotalsForYear = async (year: number) => {
      const { startDate, endDate } = yearStartEnd(year);
      const raw = await buildBaseQuery(startDate, endDate)
        .select([
          `SUM(CASE WHEN LOWER(category.scope) = 'scope 1' THEN emission.total_emission ELSE 0 END) AS "scope1"`,
          `SUM(CASE WHEN LOWER(category.scope) = 'scope 2' THEN emission.total_emission ELSE 0 END) AS "scope2"`,
          `SUM(CASE WHEN LOWER(category.scope) = 'scope 3' THEN emission.total_emission ELSE 0 END) AS "scope3"`,
        ])
        .getRawOne();

      const scope1 = Number(raw?.scope1) || 0;
      const scope2 = Number(raw?.scope2) || 0;
      const scope3 = Number(raw?.scope3) || 0;

      return { scope1, scope2, scope3, total: scope1 + scope2 + scope3 };
    };

    const getMaxDataYear = async () => {
      const raw = await repo
        .createQueryBuilder("emission")
        .leftJoin("emission.category", "category")
        .leftJoin("emission.site", "site")
        .where("emission.status = :status", { status: EmissionStatus.APPROVED })
        .andWhere("site.site_id IN (:...siteIds)", { siteIds })
        .andWhere("LOWER(category.category_name) != :ren", { ren: "renewable electricity" })
        .select(`MAX(EXTRACT(YEAR FROM emission.date_of_reporting))`, "maxYear")
        .getRawOne();

      const maxYear = Number(raw?.maxYear);
      return Number.isFinite(maxYear) ? maxYear : baseYear;
    };

    const baseTotals = await getTotalsForYear(baseYear);

    if (!baseTotals.total) {
      return res.status(400).json({
        message: `No approved emissions found for baseYear=${baseYear}.`,
      });
    }

    const scope3Share = baseTotals.total > 0 ? baseTotals.scope3 / baseTotals.total : 0;
    const scope3TargetRequired = scope3Share >= 0.4;

    const baselineBoundary = scope3TargetRequired
      ? baseTotals.scope1 + baseTotals.scope2 + baseTotals.scope3
      : baseTotals.scope1 + baseTotals.scope2;

    const targetEmissions = Number((baselineBoundary * (1 - NET_ZERO_REDUCTION)).toFixed(3));

    const annualRate = 1 - Math.pow(targetEmissions / baselineBoundary, 1 / years);

    const rows: Array<{
      year: number;
      n: number;
      targetEmission: number;
      scope1Target: number;
      scope2Target: number;
      scope3Target: number | null;
      reducedBy: number | null;
      reducedByPct: number | null;
    }> = [];

    for (let year = baseYear; year <= NET_ZERO_YEAR; year++) {
      const n = year - baseYear;
      const factor = Math.pow(1 - annualRate, n);

      const totalTarget = Number((baselineBoundary * factor).toFixed(3));
      const scope1Target = Number((baseTotals.scope1 * factor).toFixed(3));
      const scope2Target = Number((baseTotals.scope2 * factor).toFixed(3));
      const scope3Target = scope3TargetRequired ? Number((baseTotals.scope3 * factor).toFixed(3)) : null;

      const prevTotal =
        n === 0 ? null : Number((baselineBoundary * Math.pow(1 - annualRate, n - 1)).toFixed(3));
      const reducedBy = prevTotal === null ? null : Number((prevTotal - totalTarget).toFixed(3));
      const reducedByPct =
        prevTotal === null || prevTotal === 0 ? null : Number(((reducedBy! / prevTotal) * 100).toFixed(3));

      rows.push({
        year,
        n,
        targetEmission: totalTarget,
        scope1Target,
        scope2Target,
        scope3Target,
        reducedBy,
        reducedByPct,
      });
    }

    const targetByYear = new Map(rows.map((r) => [r.year, r]));

    const currentYear = new Date().getFullYear();
    const maxDataYear = await getMaxDataYear();

    const endYear = Math.min(NET_ZERO_YEAR, Math.max(currentYear, maxDataYear));

    const actualVsTargetRows: Array<{
      year: number;
      actualScope1: number | null;
      actualScope2: number | null;
      actualScope3: number | null;
      actualTotal: number | null;
      targetTotal: number;
      variance: number | null;
      variancePct: number | null;
      status: "Base Year" | "Reached" | "Not Reached" | "No Data";
    }> = [];

    for (let year = baseYear; year <= endYear; year++) {
      const targetRow = targetByYear.get(year);
      if (!targetRow) continue;

      const actualTotals = await getTotalsForYear(year);

      const isBase = year === baseYear;
      const hasData = actualTotals.total > 0;

      const actualBoundaryTotal = scope3TargetRequired
        ? actualTotals.scope1 + actualTotals.scope2 + actualTotals.scope3
        : actualTotals.scope1 + actualTotals.scope2;

      let status: "Base Year" | "Reached" | "Not Reached" | "No Data";
      if (isBase) status = "Base Year";
      else if (!hasData) status = "No Data";
      else status = actualBoundaryTotal <= targetRow.targetEmission ? "Reached" : "Not Reached";

      const variance = hasData || isBase ? Number((actualBoundaryTotal - targetRow.targetEmission).toFixed(3)) : null;

      const variancePct =
        hasData || isBase
          ? targetRow.targetEmission > 0
            ? Number(((variance! / targetRow.targetEmission) * 100).toFixed(2))
            : null
          : null;

      actualVsTargetRows.push({
        year,
        actualScope1: hasData || isBase ? Number(actualTotals.scope1.toFixed(3)) : null,
        actualScope2: hasData || isBase ? Number(actualTotals.scope2.toFixed(3)) : null,
        actualScope3: scope3TargetRequired && (hasData || isBase) ? Number(actualTotals.scope3.toFixed(3)) : null,
        actualTotal: hasData || isBase ? Number(actualBoundaryTotal.toFixed(3)) : null,
        targetTotal: targetRow.targetEmission,
        variance,
        variancePct,
        status,
      });
    }

    return res.status(200).json({
      heading: "Net-Zero Target",
      method: "NET_ZERO_90",
      baseYear,
      targetYear: NET_ZERO_YEAR,
      years,
      annualRate: Number((annualRate * 100).toFixed(4)),
      baseEmissions: Number(baselineBoundary.toFixed(3)),
      targetEmissions,
      totalReductionPct: 90,
      scope3Share: Number((scope3Share * 100).toFixed(2)),
      scope3TargetRequired,
      baseTotals,
      rows,
      actualVsTarget: actualVsTargetRows,
    });
  } catch (error) {
    console.error("getLongTermTargetChart error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};



// Core GHG report computation now lives in ../reporting/ghg-data so the branded
// server-side PDF (GET /reports/ghg) can reuse the exact same figures. These
// controllers stay thin: validate the request, delegate, and return the result
// unchanged.
type GhgReportRequest = GhgFilters;
type GhgDetailsRequest = GhgFilters;

function validateGhgFilters(body: GhgFilters): { error?: string } {
  if (!body.siteIds || body.siteIds.length === 0) {
    return { error: "siteIds is required" };
  }
  if (!body.year || !body.yearType) {
    return { error: "yearType and year are required" };
  }
  if (body.yearType !== "CY" && body.yearType !== "FY") {
    return { error: "yearType must be CY or FY" };
  }
  // Optional (older clients omit it and get the yearly default), but when sent
  // it must be a known value — otherwise it silently echoes back as-is.
  if (
    body.frequency !== undefined &&
    body.frequency !== "monthly" &&
    body.frequency !== "quarterly" &&
    body.frequency !== "yearly"
  ) {
    return { error: "frequency must be monthly, quarterly or yearly" };
  }
  // Monthly/quarterly narrow the whole report to one period, so the period
  // itself has to be supplied — otherwise there is nothing to narrow to.
  if (body.frequency === "monthly") {
    if (!Number.isInteger(body.month) || (body.month as number) < 1 || (body.month as number) > 12) {
      return { error: "month must be an integer between 1 and 12 for monthly frequency" };
    }
  }
  if (body.frequency === "quarterly") {
    if (!Number.isInteger(body.quarter) || (body.quarter as number) < 1 || (body.quarter as number) > 4) {
      return { error: "quarter must be an integer between 1 and 4 for quarterly frequency" };
    }
  }
  return {};
}

export const getGhgReportTables = async (req: Request, res: Response) => {
  try {
    const { siteIds, categoryIds, yearType, year, compareYear, frequency, month, quarter } =
      req.body as GhgReportRequest;

    const { error } = validateGhgFilters({ siteIds, categoryIds, yearType, year, compareYear, frequency, month, quarter });
    if (error) return res.status(400).json({ message: error });

    const filters: GhgFilters = { siteIds, categoryIds, yearType, year, compareYear, frequency, month, quarter };

    const data = await computeGhgTables(filters);
    return res.status(200).json(data);
  } catch (error) {
    console.error("GHG report tables error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getGhgReportDetails = async (req: Request, res: Response) => {
  try {
    const { siteIds, categoryIds, yearType, year, compareYear, frequency, month, quarter } =
      req.body as GhgDetailsRequest;

    const { error } = validateGhgFilters({ siteIds, categoryIds, yearType, year, compareYear, frequency, month, quarter });
    if (error) return res.status(400).json({ message: error });

    const data = await computeGhgDetails({ siteIds, categoryIds, yearType, year, compareYear, frequency, month, quarter });
    return res.status(200).json(data);
  } catch (error) {
    console.error("GHG report details error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Download emissions as Excel with emission factor details
export const downloadEmissions = async (req: AuthRequest, res: Response) => {
  try {
    const { siteId, categoryId, date, year, month } = req.query;

    if (!siteId) {
      return res.status(400).json({ message: "siteId is required" });
    }

    const scoped = await scopeSiteIds(req.user!.userId, req.user!.role, [parseInt(siteId as string)]);
    if (scoped.forbidden) return res.status(403).json(SITE_ACCESS_DENIED);

    const qb = repo
      .createQueryBuilder("emission")
      .leftJoinAndSelect("emission.site", "site")
      .leftJoinAndSelect("emission.category", "category")
      .leftJoinAndSelect("emission.created_by", "created_by")
      .where("site.site_id = :siteId", { siteId: parseInt(siteId as string) });

    if (categoryId) {
      qb.andWhere("category.category_id = :categoryId", { categoryId: parseInt(categoryId as string) });
    }

    if (date) {
      const [y, m] = (date as string).split("-");
      const startDate = new Date(parseInt(y), parseInt(m) - 1, 1);
      const endDate = new Date(parseInt(y), parseInt(m), 0);
      qb.andWhere("emission.date_of_reporting >= :startDate", { startDate });
      qb.andWhere("emission.date_of_reporting <= :endDate", { endDate });
    } else {
      if (year) {
        qb.andWhere("EXTRACT(YEAR FROM emission.date_of_reporting) = :year", { year: parseInt(year as string) });
      }
      if (month) {
        qb.andWhere("EXTRACT(MONTH FROM emission.date_of_reporting) = :month", { month: parseInt(month as string) });
      }
    }

    qb.orderBy("emission.pk_id", "DESC");

    const emissions = await qb.getMany();

    // Collect all unique keys from activity_data and extra_data across all emissions
    const activityDataKeys = new Set<string>();
    const extraDataKeys = new Set<string>();

    for (const em of emissions) {
      if (em.activity_data && typeof em.activity_data === "object") {
        Object.keys(em.activity_data).forEach((k) => activityDataKeys.add(k));
      }
      if (em.extra_data && typeof em.extra_data === "object") {
        Object.keys(em.extra_data).forEach((k) => extraDataKeys.add(k));
      }
    }

    // Remove emission_category from activity_data keys (it gets its own column)
    activityDataKeys.delete("emission_category");

    // For each emission, look up the matching emission factor
    const emissionFactorCache = new Map<string, EmissionFactor | null>();

    const getFactorForEmission = async (em: Emission): Promise<{ factor_value: number; denominator_unit: string; source: string; year: number } | null> => {
      // Prefer stored snapshot (always accurate, fast)
      if (em.emission_factor_snapshot) {
        return em.emission_factor_snapshot;
      }

      const emCategory = em.activity_data?.emission_category;
      if (!emCategory) return null;

      const cacheKey = `${em.site.site_id}-${em.category.category_id}-${emCategory}`;
      if (emissionFactorCache.has(cacheKey)) return emissionFactorCache.get(cacheKey)!;

      let factor = await emissionFactorRepo.findOne({
        where: {
          site: { site_id: em.site.site_id },
          category: { category_id: em.category.category_id },
          emission_category_name: emCategory,
        },
      });

      if (!factor) {
        factor = await emissionFactorRepo.findOne({
          where: {
            site: { site_id: em.site.site_id },
            category: { category_id: em.category.category_id },
            global_category_name: emCategory,
          },
        });
      }

      emissionFactorCache.set(cacheKey, factor);
      return factor;
    };

    // Build flat rows
    const rows: Record<string, any>[] = [];

    for (const em of emissions) {
      const factor = await getFactorForEmission(em);
      const row: Record<string, any> = {};

      row["Date of Reporting"] = em.date_of_reporting;
      row["Site"] = em.site?.name || "";
      row["Category"] = em.category?.category_name || "";
      row["Emission Category"] = em.activity_data?.emission_category || "";

      // Flatten activity_data columns
      for (const key of activityDataKeys) {
        const colTitle = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        row[colTitle] = em.activity_data?.[key] ?? "";
      }

      row["Activity Data Unit"] = em.activity_data_unit || "";

      // Flatten extra_data columns
      for (const key of extraDataKeys) {
        const colTitle = `[Extra] ${key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`;
        row[colTitle] = em.extra_data?.[key] ?? "";
      }

      row["Total Emission (tCO2e)"] = em.total_emission != null ? Number(em.total_emission) : "";
      row["Status"] = em.status;

      // Emission factor details
      row["EF Value"] = factor?.factor_value != null ? Number(factor.factor_value) : "";
      row["EF Unit"] = factor?.denominator_unit ?? "";
      row["EF Source"] = factor?.source ?? "";
      row["EF Year"] = factor?.year ?? "";

      row["Created By"] = em.created_by?.name || em.created_by?.email || "";
      row["Created At"] = em.created_at;

      rows.push(row);
    }

    // Build Excel workbook
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Emissions");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=emissions_export.xlsx");
    return res.send(buffer);
  } catch (error) {
    console.error("Download emissions error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Manager edit emission (with audit trail, allows editing approved entries)
export const managerUpdateEmission = async (req: AuthRequest, res: Response) => {
  try {
    const { id }: any = req.params;
    const userId = req.user?.userId;
    const { activity_data: activityDataInput, date_of_reporting, activity_data_unit, reason } = req.body;

    // Verify the user is a manager
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { user_id: userId } });
    if (!user || user.role !== UserRole.MANAGER) {
      return res.status(403).json({ message: "Only managers can use this endpoint" });
    }

    const emission = await repo.findOne({
      where: { pk_id: parseInt(id) },
      relations: ["site", "category"],
    });

    if (!emission) {
      return res.status(404).json({ message: "Emission not found" });
    }

    // A unit-only change must recalculate too — relabelling tonne.km as kg.km
    // while keeping the old total would leave the row off by the conversion
    // factor. Treat it as an activity_data edit using the stored data.
    const unitChanged = activity_data_unit !== undefined && activity_data_unit !== emission.activity_data_unit;
    const activity_data = activityDataInput !== undefined
      ? activityDataInput
      : (unitChanged ? emission.activity_data : undefined);

    // Capture changes for audit trail
    const changedFields: Record<string, { old: any; new: any }> = {};
    if (activityDataInput !== undefined) {
      changedFields.activity_data = { old: emission.activity_data, new: activityDataInput };
    }
    if (date_of_reporting !== undefined) {
      changedFields.date_of_reporting = { old: emission.date_of_reporting, new: date_of_reporting };
    }
    if (activity_data_unit !== undefined && activity_data_unit !== emission.activity_data_unit) {
      changedFields.activity_data_unit = { old: emission.activity_data_unit, new: activity_data_unit };
    }

    if (Object.keys(changedFields).length === 0) {
      return res.status(200).json({ message: "No changes detected", emission });
    }

    // Apply changes (do NOT change approval status)
    if (activity_data_unit !== undefined) {
      emission.activity_data_unit = activity_data_unit;
    }
    if (activity_data !== undefined) {
      emission.activity_data = activity_data;

      // Recalculate total emission if activity_data has emission_category
      if (activity_data.emission_category && emission.activity_data_unit) {
        const reportingDate = emission.date_of_reporting instanceof Date
          ? emission.date_of_reporting
          : new Date(emission.date_of_reporting);
        const targetYear = reportingDate.getFullYear() - 1;

        let emissionFactor = await emissionFactorRepo.findOne({
          where: {
            site: { site_id: emission.site.site_id },
            category: { category_id: emission.category.category_id },
            emission_category_name: activity_data.emission_category,
            year: targetYear,
          },
        });

        if (!emissionFactor) {
          emissionFactor = await emissionFactorRepo.findOne({
            where: {
              site: { site_id: emission.site.site_id },
              category: { category_id: emission.category.category_id },
              global_category_name: activity_data.emission_category,
              year: targetYear,
            },
          });
        }

        if (!emissionFactor) {
          emissionFactor = await emissionFactorRepo.findOne({
            where: {
              site: { site_id: emission.site.site_id },
              category: { category_id: emission.category.category_id },
              emission_category_name: activity_data.emission_category,
            },
          });
        }

        if (!emissionFactor) {
          emissionFactor = await emissionFactorRepo.findOne({
            where: {
              site: { site_id: emission.site.site_id },
              category: { category_id: emission.category.category_id },
              global_category_name: activity_data.emission_category,
            },
          });
        }

        if (emissionFactor) {
          const skipColumns = new Set(['material', 'disposal_method', 'fuel_type', 'vehicle_type', 'source_type', 'waste_type', 'transport_mode']);
          const commonFields = ['activity_value', 'quantity', 'value', 'amount', 'consumption', 'activity data', 'activity_data'];
          let activityValue = 0;

          // Spec category (e.g. Use of Sold Products): multiply the method's
          // fields instead of sniffing for one value — see createEmission.
          // Keep the factor snapshot in step with the recalculation (the
          // factor panel and the Excel export read the snapshot first).
          emission.emission_factor_snapshot = {
            emission_factor_id: emissionFactor.emission_factor_id,
            emission_category_name: emissionFactor.emission_category_name,
            global_category_name: emissionFactor.global_category_name || undefined,
            factor_value: emissionFactor.factor_value,
            denominator_unit: emissionFactor.denominator_unit,
            source: emissionFactor.source,
            year: emissionFactor.year,
          } as any;

          const managerCalcSpec = await getCalculationSpec(
            columnConfigRepo,
            emission.site.site_id,
            emission.category.category_id,
          );
          if (managerCalcSpec) {
            const computed = computeSpecActivityValue(managerCalcSpec, activity_data, emission.activity_data_unit);
            if (!computed.ok) {
              return res.status(400).json({ message: computed.message });
            }
            activityValue = computed.value;
            if (computed.unitKey) emission.activity_data_unit = computed.unitKey;
            activity_data.activity_value = String(activityValue);
          } else {

          for (const field of commonFields) {
            const matchingKey = Object.keys(activity_data).find(k => k.toLowerCase() === field.toLowerCase());
            if (matchingKey && activity_data[matchingKey] !== undefined && activity_data[matchingKey] !== '') {
              activityValue = parseFloat(activity_data[matchingKey]);
              if (!isNaN(activityValue) && activityValue > 0) break;
            }
          }

          // Tier 2: try numeric fields >= 100 (skip likely dropdown IDs)
          if (activityValue === 0) {
            for (const [key, value] of Object.entries(activity_data)) {
              const keyLower = key.toLowerCase();
              if (key === 'emission_category' || skipColumns.has(keyLower)) continue;
              if (value !== undefined && value !== '') {
                const numValue = parseFloat(value as string);
                if (!isNaN(numValue) && numValue >= 100) {
                  activityValue = numValue;
                  break;
                }
              }
            }
          }

          // Tier 3: any positive number as last resort
          if (activityValue === 0) {
            for (const [key, value] of Object.entries(activity_data)) {
              const keyLower = key.toLowerCase();
              if (key === 'emission_category' || skipColumns.has(keyLower)) continue;
              if (value !== undefined && value !== '') {
                const numValue = parseFloat(value as string);
                if (!isNaN(numValue) && numValue > 0) {
                  activityValue = numValue;
                  break;
                }
              }
            }
          }
          }

          if (activityValue > 0) {
            const unitsMatch = unitsMatchExact(emissionFactor.denominator_unit, emission.activity_data_unit);
            if (unitsMatch) {
              emission.total_emission = Math.round((activityValue * emissionFactor.factor_value) / 1000 * 100) / 100;
            } else {
              const conversionFactor = getConversionFactor(emission.activity_data_unit, emissionFactor.denominator_unit);
              if (conversionFactor) {
                const convertedValue = activityValue * conversionFactor;
                emission.total_emission = Math.round((convertedValue * emissionFactor.factor_value) / 1000 * 100) / 100;
              } else {
                return res.status(400).json({
                  message: `Cannot convert unit "${emission.activity_data_unit}" to expected unit "${emissionFactor.denominator_unit}"`,
                });
              }
            }
          }
        }
      }
    }

    if (date_of_reporting !== undefined) emission.date_of_reporting = new Date(date_of_reporting);

    await repo.save(emission);

    // Write audit log
    const auditRepo = AppDataSource.getRepository(AuditLog);
    const auditEntry = auditRepo.create({
      entity_type: "emission",
      entity_id: emission.pk_id,
      action: "manager_edit",
      changed_fields: changedFields,
      reason: reason || null,
      changed_by: { user_id: userId } as any,
    });
    await auditRepo.save(auditEntry);

    return res.status(200).json({
      message: "Emission updated by manager",
      emission,
    });
  } catch (error) {
    console.error("Manager update emission error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

type DistanceMode = "road" | "sea";

interface DistanceLocationInput {
  address?: string;
  lat: number;
  lng: number;
  placeId?: string;
}

interface CalculateDistanceBody {
  origin: DistanceLocationInput;
  destination: DistanceLocationInput;
  mode: DistanceMode;
}

const routeAPI = "https://routes.googleapis.com/directions/v2:computeRoutes";
const geocodeAPI = "https://maps.googleapis.com/maps/api/geocode/json";

function formatGoogleDuration(duration?: string | null): string | null {
  if (!duration) return null;

  // Google returns strings like "2200s"
  const totalSeconds = parseInt(duration.replace("s", ""), 10);
  if (Number.isNaN(totalSeconds)) return duration;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);

  if (hours > 0 && minutes > 0) return `${hours} hr ${minutes} min`;
  if (hours > 0) return `${hours} hr`;
  return `${minutes} min`;
}



export const calculateDistance = async (req: AuthRequest, res: Response) => {
  try {
    const { origin, destination, mode } = req.body as CalculateDistanceBody;

    if (!origin || !destination) {
      return res.status(400).json({
        message: "origin and destination are required",
      });
    }

    if (
      typeof origin.lat !== "number" ||
      typeof origin.lng !== "number" ||
      typeof destination.lat !== "number" ||
      typeof destination.lng !== "number"
    ) {
      return res.status(400).json({
        message:
          "origin.lat, origin.lng, destination.lat, destination.lng must be numbers",
      });
    }

    // Validate coordinate ranges
    if (
      origin.lat < -90 || origin.lat > 90 ||
      destination.lat < -90 || destination.lat > 90 ||
      origin.lng < -180 || origin.lng > 180 ||
      destination.lng < -180 || destination.lng > 180
    ) {
      return res.status(400).json({
        message: "Invalid coordinates: lat must be -90 to 90, lng must be -180 to 180",
      });
    }

    if (mode !== "road" && mode !== "sea") {
      return res.status(400).json({
        message: "Only road and sea modes are supported in this endpoint",
      });
    }

    if (mode === "sea") {
      const seaRouteApiUrl = process.env.SEA_ROUTE_API_URL;

      if (!seaRouteApiUrl) {
        return res.status(500).json({
          message: "SEA_ROUTE_API_URL is not configured",
        });
      }

      const response = await axios.post(
        `${seaRouteApiUrl}/v1/sea-route`,
        {
          origin: {
            lat: origin.lat,
            lng: origin.lng,
            address: origin.address || null,
          },
          destination: {
            lat: destination.lat,
            lng: destination.lng,
            address: destination.address || null,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      const data = response.data?.data;

      if (!data || typeof data.distanceMeters !== "number") {
        return res.status(400).json({
          message: "Invalid sea route response returned by Python service",
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          mode: "sea",
          distanceMeters: data.distanceMeters,
          duration: data.duration || null,
          durationText: data.durationText || null,
          encodedPolyline: null,
          seaGeometry: data.seaGeometry || null,
          origin: data.origin || origin.address || `${origin.lat},${origin.lng}`,
          destination:
            data.destination ||
            destination.address ||
            `${destination.lat},${destination.lng}`,
        },
      });
    }

    // road mode continues below exactly as before
    const apiKey = process.env.GOOGLE_ROUTES_API_KEY || process.env.GOOGLE_DISTANCE_MATRIX_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        message: "GOOGLE_ROUTES_API_KEY is not configured",
      });
    }

    const requestBody = {
      origin: {
        location: {
          latLng: {
            latitude: origin.lat,
            longitude: origin.lng,
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: destination.lat,
            longitude: destination.lng,
          },
        },
      },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      polylineQuality: "OVERVIEW",
    };

    const response = await axios.post(routeAPI, requestBody, {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
      },
    });

    const route = response.data?.routes?.[0];

    if (!route) {
      return res.status(400).json({
        message: "No route returned by Google Routes API",
      });
    }

    const distanceMeters = route.distanceMeters;
    const rawDuration = route.duration || null;
    const encodedPolyline = route.polyline?.encodedPolyline || null;

    if (typeof distanceMeters !== "number") {
      return res.status(400).json({
        message: "Invalid distance returned by Google Routes API",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        mode: "road",
        distanceMeters,
        duration: rawDuration,
        durationText: formatGoogleDuration(rawDuration),
        encodedPolyline,
        seaGeometry: null,
        origin: origin.address || `${origin.lat},${origin.lng}`,
        destination: destination.address || `${destination.lat},${destination.lng}`,
      },
    });
  } catch (error: any) {
    console.error("Calculate distance error:", error?.response?.data || error);

    return res.status(500).json({
      message:
        error?.response?.data?.detail ||
        error?.response?.data?.error?.message ||
        error?.message ||
        "Failed to calculate route",
    });
  }
};


interface GeocodeLocationBody {
  query: string;
}

export const geocodeLocation = async (req: AuthRequest, res: Response) => {
  try {
    const { query } = req.body as GeocodeLocationBody;


    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({
        message: "query is required",
      });
    }

    if (query.length > 500) {
      return res.status(400).json({
        message: "query must be 500 characters or less",
      });
    }

    const apiKey =
      process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_ROUTES_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        message: "GOOGLE_GEOCODING_API_KEY is not configured",
      });
    }

    // Clean pasted excel-style input a bit
    const normalizedQuery = query
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ", ")
      .trim();

    const response = await axios.get(
      geocodeAPI,
      {
        params: {
          address: normalizedQuery,
          key: apiKey,
        },
      },
    );

    const data = response.data;

    if (data.status !== "OK" || !data.results?.length) {
      return res.status(404).json({
        message: data.error_message || "Location not found",
        googleStatus: data.status,
      });
    }

    const best = data.results[0];
    const location = best.geometry?.location;

    if (!location) {
      return res.status(404).json({
        message: "Location coordinates not found",
      });
    }

   
    return res.status(200).json({
      success: true,
      data: {
        display_name: best.formatted_address,
        lat: location.lat,
        lon: location.lng,
        place_id: best.place_id || null,
        raw_query: normalizedQuery,
      },
    });
  } catch (error: any) {
    console.error("Geocode location error:", error?.response?.data || error);

    return res.status(500).json({
      message:
        error?.response?.data?.error_message ||
        error?.message ||
        "Failed to geocode location",
    });
  }
};

// Totals one emission category over one reporting period. Data entry calls it
// twice: once for the previous period (approved basis — the reported number)
// and once for the period being entered (entered basis), which cannot have an
// approved total yet because approval happens after entry.
export const getPeriodTotal = async (req: Request, res: Response) => {
  try {
    const {
      site_id,
      category_id,
      emission_category,
      year,
      month,
      year_type,
      reporting_period,
      basis,
    } = req.query;

    if (!site_id || !category_id || !emission_category || !year || !reporting_period) {
      return res.status(400).json({
        message:
          "site_id, category_id, emission_category, year, and reporting_period are required",
      });
    }

    if (reporting_period !== "monthly" && reporting_period !== "yearly") {
      return res.status(400).json({
        message: "reporting_period must be 'monthly' or 'yearly'",
      });
    }

    // 'approved' matches the dashboard and GHG report. 'entered' counts
    // everything a manager has not rejected — the only basis that means
    // anything for a period still being filled in.
    const statusBasis = basis === undefined ? "approved" : String(basis);
    if (statusBasis !== "approved" && statusBasis !== "entered") {
      return res.status(400).json({
        message: "basis must be 'approved' or 'entered'",
      });
    }

    const qb = AppDataSource.getRepository(Emission)
      .createQueryBuilder("emission")
      .where("emission.site_id = :siteId", { siteId: Number(site_id) })
      .andWhere("emission.category_id = :categoryId", { categoryId: Number(category_id) })
      .andWhere("emission.activity_data->>'emission_category' = :emissionCategory", {
        emissionCategory: String(emission_category),
      })
      .andWhere("emission.reporting_period = :reportingPeriod", {
        reportingPeriod: String(reporting_period),
      })
      .andWhere("EXTRACT(YEAR FROM emission.date_of_reporting) = :year", {
        year: Number(year),
      });

    if (statusBasis === "approved") {
      qb.andWhere("emission.status = :status", {
        status: EmissionStatus.APPROVED,
      });
    } else {
      qb.andWhere("emission.status != :rejected", {
        rejected: EmissionStatus.REJECTED,
      });
    }

    // Monthly: pin to the specific month. Yearly: no month filter — sums
    // (in practice, matches) the single period-end-dated row for that year.
    if (reporting_period === "monthly") {
      if (!month) {
        return res.status(400).json({
          message: "month is required when reporting_period is 'monthly'",
        });
      }
      qb.andWhere("EXTRACT(MONTH FROM emission.date_of_reporting) = :month", {
        month: Number(month),
      });
    }

    // Yearly: must also match CY vs FY so we don't mix year types.
    if (reporting_period === "yearly") {
      if (!year_type) {
        return res.status(400).json({
          message: "year_type is required when reporting_period is 'yearly'",
        });
      }
      qb.andWhere("emission.year_type = :yearType", { yearType: String(year_type) });
    }

    const { total } = await qb
      .select("COALESCE(SUM(emission.total_emission), 0)", "total")
      .getRawOne();

    return res.json({ total_emission: Number(total) });
  } catch (error) {
    console.error("Fetch previous period total error:", error);
    return res.status(500).json({ message: "Failed to fetch previous period total" });
  }
};