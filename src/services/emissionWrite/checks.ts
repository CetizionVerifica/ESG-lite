/**
 * Mode lock and duplicate checks (IM1), batch-friendly: the database is
 * asked once per distinct key and the answer is reused for every row of a
 * plan that shares it.
 */
import type { EntityManager } from "typeorm";
import { Emission } from "../../entities/Emission";
import { findModeLockConflict, type ModeLockConflict, periodWindow, type YearType } from "../reportingPeriod";
import { specIdentityMatches } from "../calculationSpec";
import type { CalculationSpec } from "../../entities/ColumnConfig";
import type { StoredPeriod } from "./period";
import { IMPORT_LIMITS } from "../../imports/limits";

export class CheckCache {
  private readonly modeLocks = new Map<string, Promise<ModeLockConflict | null>>();
  private readonly existing = new Map<string, Promise<Emission[]>>();

  constructor(readonly manager: EntityManager) {}

  /** The typed-entry mode lock, one query per site × category × period window. */
  modeLock(site_id: number, category_id: number, p: StoredPeriod): Promise<ModeLockConflict | null> {
    const window = p.reporting_period === "yearly" ? `${p.year_type}:${p.date_of_reporting.slice(0, 4)}` : p.date_of_reporting.slice(0, 7);
    const key = `${site_id}:${category_id}:${p.reporting_period}:${window}`;
    let q = this.modeLocks.get(key);
    if (!q) {
      q = findModeLockConflict(this.manager.getRepository(Emission), {
        site_id,
        category_id,
        reporting_period: p.reporting_period,
        year_type: p.year_type,
        date_of_reporting: p.date_of_reporting.length === 10 ? new Date(`${p.date_of_reporting}T00:00:00Z`) : new Date(p.date_of_reporting),
      });
      this.modeLocks.set(key, q);
    }
    return q;
  }

  /**
   * Existing monthly rows of a site × category in one month (imports dedupe
   * by month) or on one exact date (typed entries, as before).
   */
  existingRows(site_id: number, category_id: number, date: string, scope: "month" | "date"): Promise<Emission[]> {
    const key = `${site_id}:${category_id}:${scope}:${scope === "month" ? date.slice(0, 7) : date}`;
    let q = this.existing.get(key);
    if (!q) {
      const qb = this.manager
        .getRepository(Emission)
        .createQueryBuilder("e")
        .leftJoinAndSelect("e.site", "site")
        .leftJoinAndSelect("e.category", "category")
        .leftJoinAndSelect("e.created_by", "created_by")
        .where("e.site_id = :site_id", { site_id })
        .andWhere("e.category_id = :category_id", { category_id });
      if (scope === "month") {
        const [y, m] = date.slice(0, 7).split("-").map(Number);
        const start = `${date.slice(0, 7)}-01`;
        const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
        qb.andWhere("e.reporting_period = 'monthly'").andWhere("e.date_of_reporting BETWEEN :start AND :end", { start, end });
      } else {
        qb.andWhere("e.date_of_reporting = :date", { date });
      }
      q = qb.orderBy("e.pk_id", "ASC").getMany();
      this.existing.set(key, q);
    }
    return q;
  }
}

/**
 * The existing row this entry duplicates, if any: same emission category and,
 * for spec categories, the same identity columns. Without an emission
 * category any existing row on the date counts (typed-entry behaviour).
 */
export const findDuplicate = (existing: Emission[], activity_data: Record<string, any>, spec: CalculationSpec | null): Emission | null => {
  if (activity_data.emission_category) {
    return (
      existing.find(
        (e) => e.activity_data?.emission_category === activity_data.emission_category && (!spec || specIdentityMatches(spec, activity_data, e.activity_data)),
      ) ?? null
    );
  }
  return existing.length > 0 ? existing[0] : null;
};

/** Identity of a row within a plan, for DUPLICATE_IN_PLAN. */
export const planIdentity = (site_id: number, category_id: number, p: StoredPeriod, emissionCategory: string, activity_data: Record<string, any>, spec: CalculationSpec | null): string => {
  const period = p.reporting_period === "yearly" ? `${p.year_type}:${p.date_of_reporting.slice(0, 4)}` : p.date_of_reporting.slice(0, 7);
  const identity = (spec?.identity_columns ?? []).map((c) => String(activity_data[c] ?? "").trim().toLowerCase()).join("|");
  return `${site_id}:${category_id}:${period}:${emissionCategory.trim().toLowerCase()}:${identity}`;
};

/**
 * Mode conflicts between rows of the same plan: a monthly row inside a
 * planned yearly window, or yearly rows of both calendars overlapping.
 * Returns a message per conflicting row position, or nothing.
 */
export const planModeConflicts = (rows: Array<{ site_id: number; category_id: number; period: StoredPeriod } | null>): Map<number, string> => {
  const out = new Map<number, string>();
  const yearly = new Map<string, Array<{ i: number; start: string; end: string; year_type: YearType }>>();
  rows.forEach((r, i) => {
    if (!r || r.period.reporting_period !== "yearly") return;
    const key = `${r.site_id}:${r.category_id}`;
    const w = periodWindow(r.period.year_type as YearType, new Date(`${r.period.date_of_reporting}T00:00:00Z`));
    const list = yearly.get(key) ?? [];
    for (const other of list) {
      if (other.year_type !== r.period.year_type && other.start <= w.end && other.end >= w.start) {
        out.set(i, `This plan also files ${other.year_type} yearly data for the same category and an overlapping period; a category uses CY or FY for a period, not both.`);
      }
    }
    list.push({ i, ...w, year_type: r.period.year_type as YearType });
    yearly.set(key, list);
  });
  rows.forEach((r, i) => {
    if (!r || r.period.reporting_period !== "monthly") return;
    const list = yearly.get(`${r.site_id}:${r.category_id}`);
    if (!list) return;
    const d = r.period.date_of_reporting;
    const hit = list.find((w) => d >= w.start && d <= w.end);
    if (hit) out.set(i, `This plan also files a ${hit.year_type} yearly batch covering ${hit.start} – ${hit.end} for the same category; a year is either all monthly or all yearly.`);
  });
  return out;
};

/** "CY 2025" or "FY 2025-26" for a calendar or financial year window, else "start – end". */
export const yearWindowLabel = (w: { start: string; end: string }): string => {
  const startYear = Number(w.start.slice(0, 4));
  const endYear = Number(w.end.slice(0, 4));
  if (w.start.endsWith("-01-01") && w.end.endsWith("-12-31") && startYear === endYear) return `CY ${endYear}`;
  if (w.start.endsWith("-04-01") && w.end.endsWith("-03-31") && endYear === startYear + 1) return `FY ${startYear}-${String(endYear).slice(2)}`;
  return `${w.start} – ${w.end}`;
};

export const modeLockMessage = (c: ModeLockConflict, period: "monthly" | "yearly"): string => {
  if (period === "yearly" && c.conflicting_period === "monthly") {
    const n = c.conflicting_rows;
    return `This category is already filed monthly for ${yearWindowLabel(c.window)} (${n} monthly entr${n === 1 ? "y" : "ies"}). Keep entering it monthly, or delete those entries first to file the year as one entry.`;
  }
  if (period === "yearly") {
    return `This year overlaps an existing ${c.conflicting_year_type} yearly batch on this category. A category uses CY or FY for a given period, not both — delete the ${c.conflicting_year_type} batch first, or file this data under ${c.conflicting_year_type} too.`;
  }
  return `This category already has a yearly batch for ${yearWindowLabel(c.window)}. Delete the yearly data first, or file this entry under a different period.`;
};

/**
 * A row the AI matched below the confirmation threshold keeps a
 * LOW_CONFIDENCE_MATCH warning after the uploader confirms it, so the
 * approver still sees it in "Needs attention" (Shyam, 2026-10-14). Only the
 * model's own matches count: profile and rules matches are not flagged, and
 * rows without meta (Claude, API, plain bulk upload) never are. A warning
 * only: the row still commits.
 */
export const isLowConfidenceAiMatch = (meta: { source?: string; confidence?: number } | null | undefined): boolean =>
  !!meta && meta.source === "llm" && typeof meta.confidence === "number" && meta.confidence < IMPORT_LIMITS.MAPPING_CONFIRM_BELOW;
