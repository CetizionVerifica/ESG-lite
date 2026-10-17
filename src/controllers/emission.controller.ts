import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { Emission, EmissionStatus } from "../entities/Emission";
import { EmissionFactor } from "../entities/EmissionFactor";
import { Site } from "../entities/Site";
import { AuthRequest } from "../middlewares/auth.middleware";
import { In, IsNull, Not, Or } from "typeorm";
import { ProductionData, ProductionDataStatus } from "../entities/ProductionData";
import { EmissionDocument } from "../entities/EmissionDocument";
import { documentFilesForEmissions, removeDeletedDocumentFiles } from "./document.controller";
import { ContextCache, CheckCache, prepareEntry, insertEntry, modeLockMessage, entryFactorSnapshot, type PreparedEntry, type PrepareResult } from "../services/emissionWrite";
import { parseSupplierRef } from "../scope3/suppliers/entryInput";
import { factorSnapshot, type EngineIssue, type FeraTwin } from "../services/emissionWrite/compute";
import { syncTdLossTwin } from "../services/emissionWrite/tdLossSync";
import { feraFamilyIds } from "../services/emissionWrite/feraFamily";
import * as XLSX from "xlsx";
import { AuditLog } from "../entities/AuditLog";
import { User } from "../entities/User";
import { UserRole } from "../types/type";
import axios from "axios";
import { aiServiceHeaders, routeServiceTimeoutMs } from "../utils/aiServiceHeaders";
import { sendToQueue } from "../queues/emailProducer";
import { log } from "../utils/logger";
import { createNotification } from "../services/notificationService";
import { validatePeriodFields, findModeLockConflict, futurePeriodError } from "../services/reportingPeriod";
import { getCalculationSpec, specIdentityMatches } from "../services/calculationSpec";
import { ColumnConfig } from "../entities/ColumnConfig";
import { computeBreakdown, type BreakdownSourceRow } from "../services/emissionBreakdown";
import { CATEGORY_IDS_ERROR, hasInvalidCategoryIds, parseCategoryIds } from "../utils/parseCategoryIds";
import { parseSiteIds } from "../utils/parseSiteIds";
import { scopeSiteIds, siteFilterSql, SITE_ACCESS_DENIED } from "../utils/companyScope";
import {
  computeGhgTables,
  computeGhgDetails,
  type GhgFilters,
} from "../reporting/ghg-data";
import { pcfDataChanged } from "../pcf/staleness";
import { enrichFeraRows, foldedFeraTwinSql, pendingReviewCountSql } from "../utils/feraFold";
import { attentionSql, ATTENTION_BELOW } from "../utils/importAttention";
import { checkKeysFor, refreshChecks, refreshChecksSafely } from "../scope3/review/service";
import { parseRowQuality } from "../scope3/dq/input";
import { METHOD_KEYS } from "../scope3/contracts/ghgCategory";
import { draftTwinsOf, statusAfterUserEdit, statusForTypedEntry } from "../scope3/review/workflow";

const repo = AppDataSource.getRepository(Emission);
const emissionFactorRepo = AppDataSource.getRepository(EmissionFactor);
const siteRepo = AppDataSource.getRepository(Site);
const columnConfigRepo = AppDataSource.getRepository(ColumnConfig);

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

/**
 * An emission that came from an import keeps `extra_data.import` (channel and
 * row_ref, written by IM1) through every edit, so it stays joined to its plan
 * row, and the edit is recorded on it (`edited: true`, `edited_by`). Review
 * reads both: an edited row needs attention, and the uploader may no longer
 * approve it themselves (smart-import XI5 review fixes, 2026-10-14).
 */
export const keepImportProvenance = (emission: { upload_batch_id?: string | null; extra_data?: any }, before: any, userId: unknown) => {
  const imported = before && typeof before === "object" ? before.import : undefined;
  if (!emission.upload_batch_id || !imported || typeof imported !== "object") return;
  const next = emission.extra_data && typeof emission.extra_data === "object" && !Array.isArray(emission.extra_data) ? emission.extra_data : {};
  emission.extra_data = { ...next, import: { ...imported, edited: true, edited_by: Number(userId) || null } };
};

// XI5 "Needs attention" rule: src/utils/importAttention.ts.

// S3-15: a pending row is ready when its stored review checks all pass; a
// pending row without checks yet is held.
// S3-15 part 2: a Draft is visible only to the person who saved it, never in
// manager lists, exports or totals (nothing is a Draft with the switch off).
const DRAFT_VISIBLE_SQL = (e: string) => `(${e}.status::text <> 'draft' OR ${e}."created_by" = :draftOwner)`;

const READY_SQL = (e: string) => `(${e}.status = 'pending' AND (${e}.checks ->> 'ready') = 'true')`;
const HELD_SQL = (e: string) => `(${e}.status = 'pending' AND COALESCE(${e}.checks ->> 'ready', 'false') <> 'true')`;

// Get emissions by site, category, and date (with optional pagination).
// Optional sort=<EMISSION_SORTS key>&order=asc|desc and search=<text>; without
// them the result is exactly as before (newest id first, no text filter).
export const getEmissions = async (req: AuthRequest, res: Response) => {
  try {
    const { date, year, month, page, limit, status, scope, sort, order } = req.query;
    // batchId=<upload_batch_id>: only that upload batch's rows (P07 "Review rows"
    // on an upload batch). Site scoping below still applies.
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId.trim().slice(0, 100) : "";
    // attention=1 (with batchId only): just the rows that need attention (XI5).
    const attention = Boolean(batchId) && ["1", "true"].includes(String(req.query.attention ?? ""));
    // ready=1|0 (S3-15): pending rows whose review checks all pass, or the rest
    // (no checks yet counts as not ready). Other statuses never match.
    const readyParam = req.query.ready === undefined ? null : String(req.query.ready);
    if (readyParam !== null && !["1", "0", "true", "false"].includes(readyParam)) {
      return res.status(400).json({ message: "ready must be 1 or 0" });
    }
    const readyFilter = readyParam === null ? null : readyParam === "1" || readyParam === "true";
    // S3-3 method=<key>: rows calculated that way. An unknown key is refused
    // rather than quietly matching nothing.
    const methodFilter = typeof req.query.method === "string" ? req.query.method.trim() : "";
    if (methodFilter && !(METHOD_KEYS as readonly string[]).includes(methodFilter)) {
      return res.status(400).json({ message: `method must be one of ${METHOD_KEYS.join(", ")}` });
    }
    // S3-3 dq_max=<1|2|3>: rows whose overall data quality is at least that
    // good (1 is best). A row with no data quality has none to meet, so it is
    // left out rather than counted as good.
    const dqMaxParam = req.query.dq_max === undefined ? null : String(req.query.dq_max);
    if (dqMaxParam !== null && !["1", "2", "3"].includes(dqMaxParam)) {
      return res.status(400).json({ message: "dq_max must be 1, 2 or 3" });
    }
    const siteIds = parseSiteIds(req.query as { siteIds?: unknown; siteId?: unknown });
    // categoryIds=1,2 (several) or the older categoryId=1.
    if (hasInvalidCategoryIds(req.query as { categoryIds?: unknown; categoryId?: unknown })) {
      return res.status(400).json({ message: CATEGORY_IDS_ERROR });
    }
    const categoryIds = parseCategoryIds(req.query as { categoryIds?: unknown; categoryId?: unknown });

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
      .leftJoinAndSelect("emission.created_by", "created_by")
      // S3-6: the supplier the goods came from (id and name only).
      .leftJoin("emission.supplier", "supplier")
      .addSelect(["supplier.supplier_id", "supplier.name"]);

    if (searchParams) {
      qb.andWhere(emissionSearchSql({ e: "emission", c: "category", s: "site", u: "created_by" }), searchParams);
    }

    if (scopedSiteIds) {
      qb.andWhere(siteFilterSql("site.site_id", scopedSiteIds), { scopedSiteIds });
    }
    qb.andWhere(DRAFT_VISIBLE_SQL("emission"), { draftOwner: Number(req.user?.userId) || 0 });

    if (categoryIds.length) {
      qb.andWhere("category.category_id IN (:...categoryIds)", { categoryIds });
    }

    if (scope) {
      qb.andWhere("category.scope = :scope", { scope: scope as string });
    }

    if (status) {
      qb.andWhere("emission.status = :status", { status: status as string });
    }

    if (batchId) {
      qb.andWhere("emission.upload_batch_id = :batchId", { batchId });
      if (attention) qb.andWhere(attentionSql("emission"), { attentionBelow: ATTENTION_BELOW });
    }
    if (readyFilter !== null) qb.andWhere(readyFilter ? READY_SQL("emission") : HELD_SQL("emission"));

    if (methodFilter) qb.andWhere("emission.method = :methodFilter", { methodFilter });
    if (dqMaxParam !== null) {
      qb.andWhere("(emission.dq->>'overall')::int <= :dqMax", { dqMax: Number(dqMaxParam) });
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
        .addSelect(pendingReviewCountSql("emission", "c"), "pending_review_count")
        .addSelect("COUNT(*) FILTER (WHERE emission.status = 'approved')", "approved_count")
        .addSelect("COUNT(*) FILTER (WHERE emission.status = 'rejected')", "rejected_count")
        .addSelect(`COUNT(*) FILTER (WHERE ${READY_SQL("emission")} AND NOT ${foldedFeraTwinSql("emission", "c")})`, "ready_count")
        .addSelect(`COUNT(*) FILTER (WHERE ${HELD_SQL("emission")} AND NOT ${foldedFeraTwinSql("emission", "c")})`, "held_count")
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
      summaryQb.andWhere(DRAFT_VISIBLE_SQL("emission"), { draftOwner: Number(req.user?.userId) || 0 });
      if (categoryIds.length) {
        summaryQb.andWhere("c.category_id IN (:...categoryIds)", { categoryIds });
      }
      if (scope) {
        summaryQb.andWhere("c.scope = :scope", { scope: scope as string });
      }
      if (status) {
        summaryQb.andWhere("emission.status = :status", { status: status as string });
      }
      if (batchId) {
        summaryQb.andWhere("emission.upload_batch_id = :batchId", { batchId });
        // Attention count over the batch's rows as filtered so far (before the
        // attention filter itself), so the chip can say "Needs attention (n)".
        summaryQb.addSelect(`COUNT(*) FILTER (WHERE ${attentionSql("emission")})`, "attention_count").setParameter("attentionBelow", ATTENTION_BELOW);
        if (attention) summaryQb.andWhere(attentionSql("emission"), { attentionBelow: ATTENTION_BELOW });
      }
      if (readyFilter !== null) summaryQb.andWhere(readyFilter ? READY_SQL("emission") : HELD_SQL("emission"));
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

      // FERA rows: parent category name and the partner entry's status.
      await enrichFeraRows(data as any[], (sql, params) => AppDataSource.query(sql, params));

      return res.status(200).json({
        data,
        total,
        summary: {
          total_emission: parseFloat(summaryRow?.total_emission) || 0,
          pending_count: parseInt(summaryRow?.pending_count) || 0,
          // Pending entries as the approvals list shows them (FERA twins of a
          // pending entry fold into it).
          pending_review_count: parseInt(summaryRow?.pending_review_count) || 0,
          approved_count: parseInt(summaryRow?.approved_count) || 0,
          rejected_count: parseInt(summaryRow?.rejected_count) || 0,
          // Rows of the batch that need attention (XI5); only with batchId.
          // `attention` is the spec's and the FE's name; `attention_count` stays for older callers.
          ...(batchId ? { attention: parseInt(summaryRow?.attention_count) || 0, attention_count: parseInt(summaryRow?.attention_count) || 0 } : {}),
          // S3-15 review checks: pending entries (twins folded) whose checks all
          // pass, and the rest ("Needs attention" on the approvals tab). `attention`
          // stays the XI5 batch count above.
          ready: parseInt(summaryRow?.ready_count) || 0,
          held: parseInt(summaryRow?.held_count) || 0,
        },
      });
    }

    // Backwards compatible: return plain array when no pagination params
    const emissions = await qb.getMany();

    // FERA rows: parent category name and the partner entry's status.
    await enrichFeraRows(emissions as any[], (sql, params) => AppDataSource.query(sql, params));

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
    const categoryId = /^\d+$/.test(String(req.query.categoryId ?? "")) ? Number(req.query.categoryId) : NaN;
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return res.status(400).json({ message: "categoryId is required" });
    }
    if ((year !== undefined && !/^\d{4}$/.test(String(year))) || (month !== undefined && !/^(0?[1-9]|1[0-2])$/.test(String(month)))) {
      return res.status(400).json({ message: "year must be YYYY and month 1-12" });
    }
    if (status !== undefined && !["pending", "approved", "rejected", "draft"].includes(String(status))) {
      return res.status(400).json({ message: "status must be draft, pending, approved or rejected" });
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
    qb.andWhere(DRAFT_VISIBLE_SQL("emission"), { draftOwner: Number(req.user?.userId) || 0 });
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
      .where("c.category_id = :categoryId", { categoryId })
      // Same config first as getCalculationSpec, so the fallback column order is stable.
      .orderBy("config.config_name", "ASC")
      .addOrderBy("col.pk_id", "ASC");
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
      .andWhere("category.category_id = :categoryId", { categoryId: parseInt(categoryId) })
      .andWhere(DRAFT_VISIBLE_SQL("emission"), { draftOwner: Number(req.user?.userId) || 0 });

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
    // total_emission and unit from the client are ignored: the server
    // computes the total from the factor (audit finding F-05).
    const { site_id, category_id, activity_data, date_of_reporting, extra_data, reporting_period, year_type } = req.body;
    // `let`: per-unit spec categories replace a spelling variant ("Tonne KM")
    // with the canonical unit key so matching and storage stay consistent.
    let activity_data_unit = req.body.activity_data_unit;
    // S3-3: how the contributor says the row was calculated, whether the
    // figure is an estimate, and a data quality they judged by hand.
    const quality = parseRowQuality(req.body);
    if (!quality.ok) {
      return res.status(400).json({ message: quality.message, code: "FIELD_INVALID", field: quality.field });
    }
    // S3-6: the supplier the goods came from, and the supplier figure to use.
    const supplierRef = parseSupplierRef(req.body);
    if (!supplierRef.ok) {
      return res.status(400).json({ message: supplierRef.message, code: "FIELD_INVALID", field: supplierRef.field });
    }
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
    // S3-15 part 2: someone else's Draft doesn't exist for the caller (never matched, never replaced).
    const visibleExisting = existingEmissions.filter((e) => e.status !== EmissionStatus.DRAFT || Number(e.created_by?.user_id) === Number(userId));

    // If emission_category is provided, match on it too; otherwise match any entry
    // for that date. For spec categories the emission_category is the country/fuel/
    // gas — two different products in the same country are NOT duplicates, so the
    // spec's identity columns (e.g. Product Name) must match as well.
    const duplicate = activity_data.emission_category
      ? visibleExisting.find(
          (e) =>
            e.activity_data?.emission_category === activity_data.emission_category &&
            (!calcSpec || specIdentityMatches(calcSpec, activity_data, e.activity_data))
        )
      : visibleExisting.length > 0
        ? visibleExisting[0]
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
      // Every emission that links back to this one (reverse FERA link; a
      // Scope 2 row may have a T&D-loss twin too, S3-7)
      const linkedBack = await repo.find({
        where: { fera_linked_id: duplicate.pk_id },
      });
      for (const l of linkedBack) {
        if (!idsToDelete.includes(l.pk_id)) idsToDelete.push(l.pk_id);
      }
      // Delete related documents first, then their stored files
      const replacedFiles = await documentFilesForEmissions(idsToDelete);
      const docRepo = AppDataSource.getRepository(EmissionDocument);
      await docRepo
        .createQueryBuilder()
        .delete()
        .where("emission_id IN (:...ids)", { ids: idsToDelete })
        .execute();
      await repo.delete(idsToDelete);
      await removeDeletedDocumentFiles(replacedFiles);
      await pcfDataChanged("emission", idsToDelete);
    }

    // Factor, total and FERA twin come from the emission write service (IM1),
    // the one engine typed entries, bulk uploads and Claude imports share.
    const contexts = new ContextCache(AppDataSource.manager);
    const checks = new CheckCache(AppDataSource.manager);
    const ctx = await contexts.context(site_id, category_id);
    const prepared = await prepareEntry(ctx, checks, {
      site_id,
      category_id,
      activity_data,
      activity_data_unit,
      period: {
        date_of_reporting: typeof date_of_reporting === "string" ? date_of_reporting : new Date(date_of_reporting).toISOString(),
        reporting_period: effectivePeriod,
        year_type: effectivePeriod === "yearly" ? year_type : null,
      },
      extra_data: extra_data || {},
      ...quality.value,
      ...supplierRef.value,
    });
    if (!prepared.ok) {
      return res.status(400).json({ message: prepared.issue.message, code: prepared.issue.code, ...(prepared.issue.field ? { field: prepared.issue.field } : {}), ...(prepared.issue.extra ?? {}) });
    }
    // S3-15 part 2: a User's entry is a Draft while the client's review workflow v2 is on.
    const status = await statusForTypedEntry(AppDataSource.manager, req.user?.role, Number(site_id));
    const { emission, fera: feraEmission, tdLoss } = await AppDataSource.transaction((tx) => insertEntry(tx, userId, prepared.entry, null, null, { status }));

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
      // S3-7: the Category 3 T&D-loss twin of a Scope 2 entry.
      ...(tdLoss ? { td_loss_emission: await repo.findOne({ where: { pk_id: tdLoss.pk_id }, relations: ["site", "category", "created_by"] }) } : {}),
      // Never block (S3-4, S3-7): FACTOR_FALLBACK_YEAR, FERA_FACTOR_MISSING, FACTOR_TYPE_MISMATCH, WTT_ALREADY_IN_FACTOR.
      warnings: prepared.entry.warnings.map(({ code, message }) => ({ code, message })),
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
    // A new date can't move the entry into a period that hasn't started (as the
    // manager edit and imports refuse).
    if (date_of_reporting !== undefined) {
      const notStarted = futurePeriodError(emission.reporting_period === "yearly" ? "yearly" : "monthly", emission.year_type, new Date(date_of_reporting));
      if (notStarted) {
        return res.status(400).json({ message: notStarted });
      }
    }
    const oldDateOfReporting = emission.date_of_reporting;
    const oldActivityDataUnit = emission.activity_data_unit;
    const oldStatus = emission.status;
    const priorCheckKeys = await checkKeysFor(AppDataSource.manager, [emission.pk_id]);

    // Edits use the engine, as a new entry does (S3-4): factor resolution,
    // unit check, snapshot, kgCO₂e total and the FERA twin.
    let warnings: EngineIssue[] = [];
    let feraTwin: FeraTwin | null = null;
    let feraSkipped: string | undefined;
    if (activity_data !== undefined) {
      emission.activity_data = activity_data;

      // Update unit if provided
      if (activity_data_unit !== undefined) {
        emission.activity_data_unit = activity_data_unit;
      }

      // Reset status to pending when user edits the emission. S3-15 part 2: with the
      // review workflow on, a User's edit of a Sent back (or Draft) row leaves a Draft.
      emission.status = await statusAfterUserEdit(AppDataSource.manager, req.user?.role, emission.site.site_id, oldStatus);
      emission.reviewed_by = null as any;
      emission.review_comment = null as any;
      emission.reviewed_at = null as any;

      // The factor year follows the new reporting date when one is sent.
      const prepared = await recalculateEntry(emission, activity_data, extra_data !== undefined ? extra_data : emission.extra_data, date_of_reporting);
      if (!prepared.ok) {
        return res.status(400).json({ message: prepared.issue.message, code: prepared.issue.code, ...(prepared.issue.field ? { field: prepared.issue.field } : {}), ...(prepared.issue.extra ?? {}) });
      }
      if (prepared.entry.computed && !(prepared.entry.computed.activityValue > 0)) {
        return res.status(400).json({
          message: "No valid activity value found in the provided data",
        });
      }
      applyComputed(emission, prepared.entry);
      warnings = prepared.entry.warnings;
      feraTwin = prepared.entry.fera;
      feraSkipped = prepared.entry.feraSkipped;
    }
    if (date_of_reporting !== undefined) emission.date_of_reporting = new Date(date_of_reporting);
    const extraBefore = emission.extra_data;
    if (extra_data !== undefined) emission.extra_data = extra_data;
    if (activity_data !== undefined || date_of_reporting !== undefined || extra_data !== undefined) {
      keepImportProvenance(emission, extraBefore, req.user?.userId);
    }

    await repo.save(emission);
    await pcfDataChanged("emission", [emission.pk_id]);

    // Recalculate linked FERA emission if activity data changed
    let updatedFeraEmission: Emission | null = null;
    if (activity_data !== undefined && emission.fera_linked_id) {
      updatedFeraEmission = await recalculateLinkedFera(emission, activity_data, feraTwin, feraSkipped);
    }
    const tdLossTwin = activity_data !== undefined ? await syncTdLossTwin(emission, activity_data) : null;
    // S3-15 part 2: a twin shares its parent's status, so a Draft parent's twins are Drafts.
    if (emission.status === EmissionStatus.DRAFT) await draftTwinsOf(AppDataSource.manager, emission.pk_id);

    // S3-15 review checks of the row, its twin and the next month (also where the row used to be).
    await refreshChecksSafely(AppDataSource.manager, [emission.pk_id, emission.fera_linked_id, updatedFeraEmission?.pk_id, tdLossTwin?.pk_id].filter(Boolean) as number[], priorCheckKeys);

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
      warnings,
    });
  } catch (error) {
    console.error("Update emission error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

/** The stored date as YYYY-MM-DD: "date" columns read back as strings; a Date set from a request is UTC midnight. */
const ymd = (d: unknown): string => (typeof d === "string" ? d.slice(0, 10) : new Date(d as any).toISOString().slice(0, 10));

/**
 * Recalculates an edited row with the engine, as a new entry (S3-4): factor
 * resolution, unit check, kgCO₂e total, snapshot and the FERA twin. A new
 * reporting date counts, since the factor year follows it. Nothing is written.
 */
async function recalculateEntry(emission: Emission, activity_data: any, extra_data: Record<string, any> | null | undefined, newDate?: string): Promise<PrepareResult> {
  const site_id = emission.site.site_id;
  const category_id = emission.category.category_id;
  const ctx = await new ContextCache(AppDataSource.manager).context(site_id, category_id);
  const yearly = emission.reporting_period === "yearly";
  // S3-6: a supplier-specific or hybrid row is recalculated the same way, from
  // the same supplier (and figure); every other row as before.
  const supplierRow = emission.method === "supplier_specific" || emission.method === "hybrid";
  const [linked] = supplierRow ? await AppDataSource.query(`SELECT supplier_id FROM emission WHERE pk_id = $1`, [emission.pk_id]) : [];
  const snapshotFactorId = Number((emission.emission_factor_snapshot as any)?.supplier_factor_id) || null;
  return prepareEntry(ctx, new CheckCache(AppDataSource.manager), {
    site_id,
    category_id,
    activity_data,
    activity_data_unit: emission.activity_data_unit,
    period: {
      date_of_reporting: ymd(newDate !== undefined ? newDate : emission.date_of_reporting),
      reporting_period: yearly ? "yearly" : "monthly",
      year_type: yearly ? ((emission.year_type as "CY" | "FY" | null) ?? null) : null,
    },
    extra_data: extra_data ?? {},
    // S3-5: a spend row keeps the rate it was saved with while its currency and purchase date don't change.
    storedFx: emission.fx,
    ...(supplierRow
      ? {
          method: emission.method,
          supplier_id: linked?.supplier_id ?? null,
          supplier_factor_id: emission.method === "supplier_specific" ? snapshotFactorId : null,
        }
      : {}),
  });
}

/** Puts the engine's total, kgCO₂e total, snapshot and unit on an edited row; no factor means no total (audit F-05). */
function applyComputed(emission: Emission, entry: PreparedEntry): void {
  const snapshot = entryFactorSnapshot(entry);
  if (!entry.computed || !snapshot) {
    emission.total_emission = 0;
    emission.total_kgco2e = "0.0000";
    emission.gas_kg = null;
    emission.biogenic_kg = null;
    emission.emission_factor_snapshot = null as any;
    emission.fx = null;
    return;
  }
  emission.total_emission = entry.computed.total;
  emission.total_kgco2e = entry.computed.total_kgco2e ?? null;
  emission.gas_kg = entry.computed.gas_kg ?? null;
  emission.biogenic_kg = entry.computed.biogenic_kg ?? null;
  emission.emission_factor_snapshot = snapshot as any;
  emission.fx = entry.computed.fx ?? null;
  emission.activity_data_unit = (entry.input.activity_data_unit ?? emission.activity_data_unit) as any;
}

/**
 * Bring the FERA twin of an edited parent in step, from the engine's twin
 * for the parent's new data (S3-4: the same exact-year factor, unit check and
 * mode lock as a new entry). Returns the updated twin, or null when there is
 * none. When the engine makes no twin, the twin keeps its numbers but goes
 * back to review with the reason, so a stale total is never left approved
 * (audit F-12). Non-fatal on error: the parent edit has already been saved.
 */
async function recalculateLinkedFera(emission: Emission, activity_data: any, twin: FeraTwin | null, skipped: string | undefined): Promise<Emission | null> {
  try {
    // (A null id in `where` is ignored by TypeORM and would match any row.)
    const feraEmission = emission.fera_linked_id
      ? await repo.findOne({ where: { pk_id: emission.fera_linked_id }, relations: ["site", "category"] })
      : null;
    // Also check reverse link
    // (Never the T&D-loss twin: syncTdLossTwin keeps that one in step, S3-7.)
    const reverseFeraEmission = !feraEmission
      ? await repo.findOne({ where: { fera_linked_id: emission.pk_id, scope3_sub: Or(IsNull(), Not("3c_td_losses")) }, relations: ["site", "category"] })
      : null;
    const linkedFera = feraEmission || reverseFeraEmission;
    if (!linkedFera || linkedFera.category?.category_name?.toLowerCase() !== "fera") return null;

    const backToReview = (comment: string | null) => {
      linkedFera.status = EmissionStatus.PENDING;
      linkedFera.reviewed_by = null as any;
      linkedFera.reviewed_at = null as any;
      linkedFera.review_comment = comment as any;
    };

    if (!activity_data?.emission_category || twin) {
      // No category: no factor applies, so the twin carries no total either.
      linkedFera.activity_data = activity_data;
      linkedFera.total_emission = twin ? twin.total : 0;
      linkedFera.total_kgco2e = twin ? twin.total_kgco2e : "0.0000";
      linkedFera.gas_kg = twin?.gas_kg ?? null;
      linkedFera.biogenic_kg = twin?.biogenic_kg ?? null;
      linkedFera.emission_factor_snapshot = (twin ? factorSnapshot(twin.factor) : null) as any;
      linkedFera.date_of_reporting = emission.date_of_reporting;
      linkedFera.activity_data_unit = emission.activity_data_unit;
      backToReview(null);
      await repo.save(linkedFera);
      return linkedFera;
    }

    // No twin from the engine: keep the twin's numbers, back to review with the reason.
    const why = skipped ?? `no FERA total could be worked out for "${activity_data.emission_category}"`;
    console.warn(`FERA recalculation skipped for emission ${linkedFera.pk_id}: ${why}.`);
    backToReview(`Not recalculated: ${why}. Check and edit this entry.`);
    await repo.save(linkedFera);
    return Object.assign(linkedFera, { recalcSkipped: true });
  } catch (feraError) {
    console.error("Failed to update linked FERA emission:", feraError);
    return null;
  }
}

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

    // Also delete the linked FERA entries: the whole family, whichever row
    // was picked (a Scope 2 row may have a T&D-loss twin too, S3-7)
    const idsToDelete = [emission.pk_id, ...(await feraFamilyIds(repo, emission))];
    // S3-15: the next month's threshold check compares against these rows.
    const priorKeys = await checkKeysFor(AppDataSource.manager, idsToDelete);

    // Delete related documents first (in case DB cascade is not set)
    const files = await documentFilesForEmissions(idsToDelete);
    const docRepo = AppDataSource.getRepository(EmissionDocument);
    await docRepo
      .createQueryBuilder()
      .delete()
      .where("emission_id IN (:...ids)", { ids: idsToDelete })
      .execute();

    await repo.delete(idsToDelete);
    await removeDeletedDocumentFiles(files);
    await pcfDataChanged("emission", idsToDelete);
    await refreshChecksSafely(AppDataSource.manager, [], priorKeys);

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
    const files: Awaited<ReturnType<typeof documentFilesForEmissions>> = [];

    const priorKeys = await checkKeysFor(AppDataSource.manager, idsArray);
    // Delete in chunks within a transaction
    await AppDataSource.transaction(async (manager) => {
      const docRepo = manager.getRepository(EmissionDocument);
      const emRepo = manager.getRepository(Emission);

      for (const batch of chunk(idsArray, CHUNK_SIZE)) {
        // Delete related documents first; their files go once the transaction commits
        files.push(...(await documentFilesForEmissions(batch, manager)));
        await docRepo
          .createQueryBuilder()
          .delete()
          .where("emission_id IN (:...ids)", { ids: batch })
          .execute();

        const result = await emRepo.delete(batch);
        totalDeleted += result.affected || 0;
      }
    });
    await removeDeletedDocumentFiles(files);
    await pcfDataChanged("emission", idsArray);
    await refreshChecksSafely(AppDataSource.manager, [], priorKeys);

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
    if (hasInvalidCategoryIds(req.query as { categoryIds?: unknown; categoryId?: unknown })) {
      return res.status(400).json({ message: CATEGORY_IDS_ERROR });
    }
    const categoryIds = parseCategoryIds(req.query as { categoryIds?: unknown; categoryId?: unknown });
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
      // Where the batch came from: the import plan's channel ('mcp', 'bulk_upload',
      // 'api', IM2); batches made without a plan read as 'bulk_upload', as in
      // GET /imports/batches. P07 shows it as the source chip (MCP-14).
      .addSelect(`COALESCE((SELECT p.channel FROM import_plan p WHERE p.upload_batch_id = e.upload_batch_id LIMIT 1), 'bulk_upload')`, "channel")
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
    if (categoryIds.length) {
      qb.andWhere("e.category_id IN (:...categoryIds)", { categoryIds });
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
    // Rows linking to a picked row, or (S3-7) to the row a picked twin links
    // to: picking one twin also carries its sibling (upstream and T&D twins
    // both link to the parent).
    const linkTargets = [...eligibleIds, ...feraIds];
    const reverseLinked = await repo.find({
      where: { fera_linked_id: In(linkTargets), status: EmissionStatus.PENDING },
      select: ["pk_id"],
    });
    for (const e of reverseLinked) if (!eligibleIds.includes(e.pk_id) && !feraIds.includes(e.pk_id)) feraIds.push(e.pk_id);
    if (feraIds.length > 0) {
      await repo
        .createQueryBuilder()
        .update()
        .set({ status: EmissionStatus.APPROVED, review_comment: comment || null, reviewed_at: new Date() })
        .where("pk_id IN (:...ids) AND status = :status", { ids: feraIds, status: EmissionStatus.PENDING })
        .execute();
      if (userId) await repo.query(`UPDATE emission SET reviewed_by = $1 WHERE pk_id = ANY($2)`, [userId, feraIds]);
    }

    // Include the FERA cascade: approving a FERA row can approve its fuel or energy row.
    await pcfDataChanged("emission", [...eligibleIds, ...feraIds]);

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
        `/my-emissions`,
        { reviewer: mgrName }
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

    // Include the FERA cascade: rejecting a row also rejects its linked FERA rows.
    await pcfDataChanged("emission", [...eligibleIds, ...feraIds]);
    // S3-15: rejected rows leave the month total the next month's threshold check reads.
    await refreshChecksSafely(AppDataSource.manager, [...eligibleIds, ...feraIds]);

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
        `/my-emissions`,
        { reviewer: mgrName, reason: comment || null }
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
    await refreshChecksSafely(AppDataSource.manager, [Number(emissionId)]);

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

    // Get all emission IDs in this batch. S3-15 part 2: someone else's Draft
    // (an imported row its contributor is fixing) isn't the caller's to delete.
    const callerId = Number((req as AuthRequest).user?.userId) || 0;
    const batchEmissions: Array<{ pk_id: number }> = await AppDataSource.query(
      `SELECT pk_id FROM emission WHERE upload_batch_id = $1 AND (status::text <> 'draft' OR created_by = $2)`,
      [batchId, callerId],
    );

    if (batchEmissions.length === 0) {
      return res.status(404).json({ message: "No emissions found for this batch" });
    }

    const idsToDelete = batchEmissions.map((e) => e.pk_id);

    // Delete related documents first (in case DB cascade is not set)
    const docRepo = AppDataSource.getRepository(EmissionDocument);
    const CHUNK_SIZE = 5000;
    const files: Awaited<ReturnType<typeof documentFilesForEmissions>> = [];
    for (let i = 0; i < idsToDelete.length; i += CHUNK_SIZE) {
      const chunk = idsToDelete.slice(i, i + CHUNK_SIZE);
      files.push(...(await documentFilesForEmissions(chunk)));
      await docRepo
        .createQueryBuilder()
        .delete()
        .where("emission_id IN (:...ids)", { ids: chunk })
        .execute();
    }

    const priorKeys = await checkKeysFor(AppDataSource.manager, idsToDelete);
    // The same rows as the SELECT above, by predicate: one parameter per row would break on a batch
    // over Postgres's 65,535-parameter limit (see df1ce16).
    const result = await repo
      .createQueryBuilder()
      .delete()
      .where("upload_batch_id = :batchId AND (status::text <> 'draft' OR created_by = :callerId)", { batchId, callerId })
      .execute();
    await removeDeletedDocumentFiles(files);
    await pcfDataChanged("emission", idsToDelete);
    await refreshChecksSafely(AppDataSource.manager, [], priorKeys);

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
    // The whole family, whichever row was picked: parent, upstream twin and, for Scope 2, the T&D-loss twin (S3-7).
    const feraLinkedIds = await feraFamilyIds(repo, emission);
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

    await pcfDataChanged("emission", [emission.pk_id, ...feraLinkedIds]);

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
        `/my-emissions`,
        { reviewer: mgrName }
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
    // The whole family, whichever row was picked: parent, upstream twin and, for Scope 2, the T&D-loss twin (S3-7).
    const feraLinkedIds = await feraFamilyIds(repo, emission);
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

    await pcfDataChanged("emission", [emission.pk_id, ...feraLinkedIds]);
    await refreshChecksSafely(AppDataSource.manager, [emission.pk_id, ...feraLinkedIds]);

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
        `/my-emissions`,
        { reviewer: mgrName, reason: comment || null }
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
    // only_ready (S3-15): approve only rows whose review checks all pass; the
    // rest are skipped and returned with what holds them.
    const onlyReady = req.body?.only_ready === true;
    const userId = req.user?.userId;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "ids array is required",
      });
    }

    const pending = await repo.find({
      where: { pk_id: In(ids), status: EmissionStatus.PENDING },
      relations: ["created_by", "category", "site"],
    });

    if (pending.length === 0) {
      return res.status(400).json({
        message: "No pending emissions found to approve",
      });
    }

    // Stored checks can be stale (a lowered change limit, a factor added
    // since), so only_ready recomputes them now and decides on the fresh ones.
    // A row of a pending FERA pair carries what holds either row (the pair
    // is approved together below), so a held twin or parent is never approved.
    const fresh = onlyReady ? await refreshChecks(AppDataSource.manager, pending.map((e) => e.pk_id)) : null;
    const checksNow = (e: Emission) => fresh?.get(e.pk_id) ?? e.checks;
    let skipped = onlyReady
      ? pending.filter((e) => checksNow(e)?.ready !== true).map((e) => ({ id: e.pk_id, held: checksNow(e)?.held ?? [] }))
      : [];
    const emissionsToApprove = onlyReady ? pending.filter((e) => checksNow(e)?.ready === true) : pending;
    if (emissionsToApprove.length === 0) {
      return res.status(200).json({ message: "No ready emissions to approve", approved: [], skipped });
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
    // Rows linking to a picked row, or (S3-7) to the row a picked twin links
    // to: picking one twin also carries its sibling (upstream and T&D twins
    // both link to the parent).
    const linkTargets = [...eligibleIds, ...feraIds];
    const reverseLinked = await repo.find({
      where: { fera_linked_id: In(linkTargets), status: EmissionStatus.PENDING },
      select: ["pk_id"],
    });
    for (const e of reverseLinked) if (!eligibleIds.includes(e.pk_id) && !feraIds.includes(e.pk_id)) feraIds.push(e.pk_id);

    if (feraIds.length > 0) {
      await repo
        .createQueryBuilder()
        .update()
        .set({ status: EmissionStatus.APPROVED, review_comment: comment || null, reviewed_at: new Date() })
        .where("pk_id IN (:...ids) AND status = :status", { ids: feraIds, status: EmissionStatus.PENDING })
        .execute();
      if (userId) await repo.query(`UPDATE emission SET reviewed_by = $1 WHERE pk_id = ANY($2)`, [userId, feraIds]);
    }
    // Never report as skipped a row the FERA cascade approved.
    skipped = skipped.filter((s) => !feraIds.includes(s.id));

    // Include the FERA cascade: approving a FERA row can approve its fuel or energy row.
    await pcfDataChanged("emission", [...eligibleIds, ...feraIds]);

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
        `/my-emissions`,
        { reviewer: mgrName }
      );
    }

    log.info("Emission", "Bulk approved", { count: eligibleIds.length, managerId: req.user?.userId });

    return res.status(200).json({
      message: `${eligibleIds.length} emissions approved successfully`,
      approved: eligibleIds,
      ...(onlyReady ? { skipped } : {}),
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
    // Rows linking to a picked row, or (S3-7) to the row a picked twin links
    // to: picking one twin also carries its sibling (upstream and T&D twins
    // both link to the parent).
    const linkTargets = [...eligibleIds, ...feraIds];
    const reverseLinked = await repo.find({
      where: { fera_linked_id: In(linkTargets), status: EmissionStatus.PENDING },
      select: ["pk_id"],
    });
    for (const e of reverseLinked) if (!eligibleIds.includes(e.pk_id) && !feraIds.includes(e.pk_id)) feraIds.push(e.pk_id);

    if (feraIds.length > 0) {
      await repo
        .createQueryBuilder()
        .update()
        .set({ status: EmissionStatus.REJECTED, review_comment: comment, reviewed_at: new Date() })
        .where("pk_id IN (:...ids) AND status = :status", { ids: feraIds, status: EmissionStatus.PENDING })
        .execute();
      if (userId) await repo.query(`UPDATE emission SET reviewed_by = $1 WHERE pk_id = ANY($2)`, [userId, feraIds]);
    }

    // Include the FERA cascade: rejecting a row also rejects its linked FERA rows.
    await pcfDataChanged("emission", [...eligibleIds, ...feraIds]);
    // S3-15: rejected rows leave the month total the next month's threshold check reads.
    await refreshChecksSafely(AppDataSource.manager, [...eligibleIds, ...feraIds]);

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
        `/my-emissions`,
        { reviewer: mgrName, reason: comment || null }
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
      .where("site.site_id = :siteId", { siteId: parseInt(siteId as string) })
      .andWhere(DRAFT_VISIBLE_SQL("emission"), { draftOwner: Number(req.user?.userId) || 0 });

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
    const priorCheckKeys = await checkKeysFor(AppDataSource.manager, [emission.pk_id]);

    // A unit-only change must recalculate too — relabelling tonne.km as kg.km
    // while keeping the old total would leave the row off by the conversion
    // factor. Treat it as an activity_data edit using the stored data.
    const unitChanged = activity_data_unit !== undefined && activity_data_unit !== emission.activity_data_unit;
    if (date_of_reporting !== undefined && isNaN(new Date(date_of_reporting).getTime())) {
      return res.status(400).json({ message: "Invalid date of reporting" });
    }
    // A new reporting date can mean a different factor year, so it recalculates
    // too, but only a row that has a category and unit: otherwise there is no
    // total to recalculate and the date alone changes, as before.
    const storedDate = new Date(emission.date_of_reporting).toISOString().slice(0, 10);
    const dateChanged = date_of_reporting !== undefined && new Date(date_of_reporting).toISOString().slice(0, 10) !== storedDate;
    const canRecalculate = !!emission.activity_data?.emission_category && !!(activity_data_unit ?? emission.activity_data_unit);
    const activity_data = activityDataInput !== undefined
      ? activityDataInput
      : (unitChanged || (dateChanged && canRecalculate) ? { ...emission.activity_data } : undefined);

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

    // An approved row stays approved after a manager edit (P07: "Changes are
    // logged"), so it must keep a category: without one there is no factor
    // and its total would silently drop to 0 (audit F-05/F-07).
    const nextUnit = activity_data_unit !== undefined ? activity_data_unit : emission.activity_data_unit;
    if (emission.status === EmissionStatus.APPROVED && activity_data !== undefined && (!activity_data.emission_category || !nextUnit)) {
      return res.status(400).json({ message: "An approved entry must keep its emission category and unit" });
    }
    // A new date must not move the entry into a period filed the other way
    // (monthly vs yearly): the same checks as a contributor's save.
    if (dateChanged) {
      const newDate = new Date(date_of_reporting);
      const period = emission.reporting_period === "yearly" ? "yearly" : "monthly";
      const periodError = validatePeriodFields({
        category_id: emission.category.category_id,
        reporting_period: period,
        year_type: emission.year_type,
        date_of_reporting: newDate,
      });
      if (periodError) {
        return res.status(400).json({ message: periodError });
      }
      // No moving an entry into a period that hasn't started, as imports refuse;
      // the edit form already stops at this month.
      const notStarted = futurePeriodError(period, emission.year_type, newDate);
      if (notStarted) {
        return res.status(400).json({ message: notStarted });
      }
      const conflict = await findModeLockConflict(repo, {
        site_id: emission.site.site_id,
        category_id: emission.category.category_id,
        reporting_period: period,
        year_type: period === "yearly" ? emission.year_type : null,
        date_of_reporting: newDate,
        exclude_pk_id: emission.pk_id,
      });
      if (conflict) {
        return res.status(409).json({ message: modeLockMessage(conflict, period), mode_lock: true, conflict });
      }
    }
    const oldTotal = emission.total_emission;

    // Apply the new date first: the factor year follows the reporting date.
    if (date_of_reporting !== undefined) emission.date_of_reporting = new Date(date_of_reporting);

    // Apply changes (do NOT change approval status)
    if (activity_data_unit !== undefined) {
      emission.activity_data_unit = activity_data_unit;
    }
    let warnings: EngineIssue[] = [];
    let feraTwin: FeraTwin | null = null;
    let feraSkipped: string | undefined;
    if (activity_data !== undefined) {
      emission.activity_data = activity_data;

      // Same engine as a new entry (S3-4); the new date is already applied,
      // so the factor year follows it.
      const prepared = await recalculateEntry(emission, activity_data, emission.extra_data);
      if (!prepared.ok) {
        // Saving would keep the old total next to the new values.
        return res.status(400).json({ message: prepared.issue.message, code: prepared.issue.code, ...(prepared.issue.field ? { field: prepared.issue.field } : {}), ...(prepared.issue.extra ?? {}) });
      }
      const { entry } = prepared;
      if (entry.computed && !(entry.computed.activityValue > 0)) {
        // New values without an amount above 0 would keep the old total next to them.
        // (A date- or unit-only edit of a stored row keeps its old total.)
        if (activityDataInput !== undefined) {
          return res.status(400).json({ message: "Enter an amount greater than 0. Nothing was changed." });
        }
      } else {
        applyComputed(emission, entry);
      }
      warnings = entry.warnings;
      feraTwin = entry.fera;
      feraSkipped = entry.feraSkipped;
    }

    keepImportProvenance(emission, emission.extra_data, userId);
    await repo.save(emission);
    await pcfDataChanged("emission", [emission.pk_id]);

    // Keep the FERA twin in step (audit F-07). A manager edit does not send
    // the row back to review, so the twin keeps the parent's review state.
    let feraEmission: Emission | null = null;
    let tdLossTwin: Emission | null = null;
    let feraWarning: string | undefined;
    if (activity_data !== undefined) {
      // The same twin recalculateLinkedFera picks: the forward link first.
      const [twinBefore] = emission.fera_linked_id
        ? await repo.query(`SELECT total_emission, status FROM emission WHERE pk_id = $1`, [emission.fera_linked_id])
        : await repo.query(`SELECT total_emission, status FROM emission WHERE fera_linked_id = $1 AND scope3_sub IS DISTINCT FROM '3c_td_losses' LIMIT 1`, [emission.pk_id]);
      feraEmission = await recalculateLinkedFera(emission, activity_data, feraTwin, feraSkipped);
      if (feraEmission && (feraEmission as Emission & { recalcSkipped?: boolean }).recalcSkipped) {
        // The twin couldn't be recalculated and went back to review.
        changedFields.fera_status = { old: twinBefore?.status ?? null, new: EmissionStatus.PENDING };
        feraWarning = feraEmission.review_comment;
      } else if (feraEmission) {
        await repo.query(
          `UPDATE emission t SET status = p.status, reviewed_by = p.reviewed_by, reviewed_at = p.reviewed_at,
             review_comment = p.review_comment
           FROM emission p WHERE t.pk_id = $1 AND p.pk_id = $2`,
          [feraEmission.pk_id, emission.pk_id]
        );
        changedFields.fera_total_emission = { old: twinBefore?.total_emission ?? null, new: feraEmission.total_emission };
        // Return the twin as stored, with the review state just copied over.
        feraEmission = await repo.findOne({ where: { pk_id: feraEmission.pk_id } });
      }
      // The T&D-loss twin (S3-7) follows the parent's new numbers and review state.
      tdLossTwin = await syncTdLossTwin(emission, activity_data);
    }
    if (Number(oldTotal) !== Number(emission.total_emission)) {
      changedFields.total_emission = { old: oldTotal, new: emission.total_emission };
    }
    await refreshChecksSafely(AppDataSource.manager, [emission.pk_id, emission.fera_linked_id, feraEmission?.pk_id, tdLossTwin?.pk_id].filter(Boolean) as number[], priorCheckKeys);

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
      fera_emission: feraEmission || undefined,
      warning: feraWarning,
      warnings,
    });
  } catch (error) {
    console.error("Manager update emission error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// An AxiosError carries the request config, including the X-Service-Key and
// Google API key headers, so log only what helps debugging.
const outboundErrorSummary = (error: any) => ({
  message: error?.message,
  code: error?.code,
  status: error?.response?.status,
  data: error?.response?.data,
});

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
        { headers: aiServiceHeaders(), timeout: routeServiceTimeoutMs() },
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
      timeout: routeServiceTimeoutMs(),
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
    console.error("Calculate distance error:", outboundErrorSummary(error));

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
        timeout: routeServiceTimeoutMs(),
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
    console.error("Geocode location error:", outboundErrorSummary(error));

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
      // S3-15 part 2: nor a Draft, which isn't submitted yet.
      qb.andWhere("emission.status NOT IN (:...notEntered)", {
        notEntered: [EmissionStatus.REJECTED, EmissionStatus.DRAFT],
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