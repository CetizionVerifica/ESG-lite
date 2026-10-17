/**
 * S3-15 part 2 · drafts and submit (docs/scope3/review/CLAUDE.md items 5–6
 * and the S3-0 follow-ups), behind `company.review_workflow_v2` (D9).
 *
 *   reviewWorkflowOn     the switch for a site's company
 *   statusForTypedEntry  draft for a User's typed entry with the switch on
 *   submitDrafts         POST /user/emissions/submit: own drafts → pending
 *   setNothingThisMonth  POST/DELETE /user/my-month/nothing
 *   dryRunChecks         POST /user/emissions/check (saves nothing)
 *   rowHistory           GET /user/emissions/:id/history?months=6
 *
 * A FERA twin always has its parent's status: a draft parent's twins are
 * drafts, and submitting either moves the whole family.
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { EmissionStatus } from "../../entities/Emission";
import { UserRole } from "../../types/type";
import { accessibleSiteIds } from "../../utils/companyScope";
import { createNotification } from "../../services/notificationService";
import { log } from "../../utils/logger";
import { DRAFT_SUBMITTED_NOTIFICATION, type SubmitEmissionsResult } from "../contracts/schemas";
import { Scope3Error } from "../contracts/errors";
import type { RowChecks } from "../contracts/checks";
import { lockedRowIds, lockedSiteMonths, siteMonthOf } from "./periodLock";
import { computeChecksFor, refreshChecksSafely } from "./service";
import { AccessError, type Caller } from "./lock";
import { withPeriodWriteLease } from "./periodLease";

const ints = (list: unknown[]): number[] => [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

/** Whether the review workflow v2 switch is on for the company of `siteId`. */
export const reviewWorkflowOn = async (manager: EntityManager, siteId: number): Promise<boolean> => {
  const [row]: Array<{ on: boolean }> = await manager.query(
    `SELECT c.review_workflow_v2 AS on FROM site s JOIN company c ON c.company_id = s.company_id WHERE s.site_id = $1`,
    [siteId],
  );
  return row?.on === true;
};

/**
 * The status a User's typed entry is saved with: Draft when the switch is on
 * (they submit the month in one go), Pending otherwise. Managers, imports,
 * bulk upload and Claude always save Pending.
 */
export const statusForTypedEntry = async (manager: EntityManager, role: string | undefined, siteId: number): Promise<EmissionStatus> =>
  role === UserRole.USER && (await reviewWorkflowOn(manager, siteId)) ? EmissionStatus.DRAFT : EmissionStatus.PENDING;

/**
 * The status a contributor's edit leaves a row in: with the switch on, a
 * User's edit of a Sent back row makes it a Draft again, and a Draft stays a
 * Draft; anything else goes back to Pending, as today.
 */
export const statusAfterUserEdit = async (manager: EntityManager, role: string | undefined, siteId: number, before: string): Promise<EmissionStatus> => {
  if (role === UserRole.USER && (before === EmissionStatus.REJECTED || before === EmissionStatus.DRAFT) && (await reviewWorkflowOn(manager, siteId))) {
    return EmissionStatus.DRAFT;
  }
  return EmissionStatus.PENDING;
};

/**
 * Gives every member of a row's FERA family the row's draft status (a twin
 * shares its parent's status). Only moves pending or rejected twins; used
 * after an edit left the parent a Draft.
 */
export const draftTwinsOf = async (manager: EntityManager, parentId: number): Promise<void> => {
  await manager.query(
    `UPDATE emission t SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL, review_comment = NULL
      WHERE t.status IN ('pending', 'rejected')
        AND (t.fera_linked_id = $1 OR t.pk_id = (SELECT p.fera_linked_id FROM emission p WHERE p.pk_id = $1))
        AND t.pk_id <> $1`,
    [parentId],
  );
};

/** Rows on the caller's sites among `ids`, or AccessError 404 when any isn't (another company's ids look missing). */
const visibleRows = async <T extends { pk_id: number; site_id: number; status?: string; created_by?: number | null }>(caller: Caller, rows: T[], wanted: number[]): Promise<T[]> => {
  const allowed = await accessibleSiteIds(caller.userId, caller.role);
  // Someone else's Draft doesn't exist for the caller, whatever their role.
  const visible = rows.filter(
    (r) => (!allowed || allowed.has(Number(r.site_id))) && !(r.status === EmissionStatus.DRAFT && r.created_by !== undefined && Number(r.created_by) !== Number(caller.userId)),
  );
  if (visible.length < wanted.length) throw new AccessError(404, "Not found.");
  return visible;
};

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

interface DraftRow {
  pk_id: number;
  site_id: number;
  status: string;
  created_by: number | null;
  date: string;
  total_emission: string;
}

/**
 * POST /user/emissions/submit: the caller's own drafts become Pending with
 * their FERA twins, their checks are recomputed, and each manager of the
 * rows' sites gets one `draft_submitted` notification. Per id: submitted, or
 * refused with NOT_DRAFT (not a draft, or not the caller's) or PERIOD_LOCKED.
 */
export async function submitDrafts(caller: Caller, ids: number[]): Promise<SubmitEmissionsResult> {
  const wanted = ints(ids);
  const rows: DraftRow[] = await AppDataSource.query(
    `SELECT pk_id, site_id, status::text AS status, created_by, to_char(date_of_reporting, 'YYYY-MM-DD') AS date, total_emission
       FROM emission WHERE pk_id = ANY($1::int[])`,
    [wanted],
  );
  const visible = await visibleRows(caller, rows, wanted);
  const byId = new Map(visible.map((r) => [Number(r.pk_id), r]));

  const refused: SubmitEmissionsResult["refused"] = [];
  const candidates: DraftRow[] = [];
  for (const id of wanted) {
    const r = byId.get(id)!;
    if (r.status !== EmissionStatus.DRAFT || Number(r.created_by) !== Number(caller.userId)) refused.push({ id, code: "NOT_DRAFT" });
    else candidates.push(r);
  }
  const locked = await lockedRowIds(AppDataSource.manager, candidates.map((r) => r.pk_id));
  for (const r of candidates) if (locked.has(Number(r.pk_id))) refused.push({ id: Number(r.pk_id), code: "PERIOD_LOCKED" });
  const accepted = candidates.filter((r) => !locked.has(Number(r.pk_id)));
  if (!accepted.length) return { submitted: [], refused: refused.sort((a, b) => a.id - b.id) };

  const acceptedIds = accepted.map((r) => Number(r.pk_id));
  const moved: number[] = await AppDataSource.transaction(async (tx) => {
    // The rows and their twins (either direction of the FERA link), drafts only.
    // TypeORM answers an UPDATE … RETURNING with [rows, count].
    const result: unknown = await tx.query(
      `UPDATE emission SET status = 'pending', updated_at = now()
        WHERE status = 'draft'
          AND (pk_id = ANY($1::int[]) OR fera_linked_id = ANY($1::int[])
               OR pk_id IN (SELECT fera_linked_id FROM emission WHERE pk_id = ANY($1::int[]) AND fera_linked_id IS NOT NULL))
        RETURNING pk_id`,
      [acceptedIds],
    );
    const updated = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as Array<{ pk_id: number }>;
    const movedIds = updated.map((u) => Number(u.pk_id));
    await tx.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by)
       SELECT 'emission', id, 'submit', $2::jsonb, NULL, $3 FROM unnest($1::int[]) AS id`,
      [movedIds, JSON.stringify({ status: { old: "draft", new: "pending" } }), caller.userId],
    );
    await refreshChecksSafely(tx, movedIds);
    return movedIds;
  });

  await notifyManagers(caller, accepted).catch((error) =>
    log.error("Scope3Review", "Submit notification failed", { userId: caller.userId, ids: acceptedIds.slice(0, 50), error: (error as Error).message }),
  );
  log.info("Scope3Review", "Drafts submitted", { userId: caller.userId, count: acceptedIds.length, moved: moved.length });
  return { submitted: acceptedIds.sort((a, b) => a - b), refused: refused.sort((a, b) => a.id - b.id) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One `draft_submitted` notification per manager of the submitted rows' sites (never the submitter). */
async function notifyManagers(caller: Caller, rows: DraftRow[]): Promise<void> {
  const siteIds = ints(rows.map((r) => r.site_id));
  const managers: Array<{ user_id: number }> = await AppDataSource.query(
    `SELECT DISTINCT u.user_id
       FROM "user" u
       LEFT JOIN user_sites us ON us.user_id = u.user_id
      WHERE u.role = 'Manager' AND u.user_id <> $2
        AND (us.site_id = ANY($1::int[]) OR u.site_id = ANY($1::int[]))
      ORDER BY u.user_id`,
    [siteIds, caller.userId],
  );
  if (!managers.length) return;
  const [who]: Array<{ name: string | null; last_name: string | null }> = await AppDataSource.query(`SELECT name, last_name FROM "user" WHERE user_id = $1`, [caller.userId]);
  const sites: Array<{ name: string }> = await AppDataSource.query(`SELECT name FROM site WHERE site_id = ANY($1::int[]) ORDER BY site_id`, [siteIds]);
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort();
  const name = `${who?.name ?? ""} ${who?.last_name ?? ""}`.trim() || "A contributor";
  const label = months.map((m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`).join(", ");
  const tco2e = Math.round(rows.reduce((sum, r) => sum + (Number(r.total_emission) || 0), 0) * 100) / 100;
  const message = `${name} submitted ${rows.length} ${rows.length === 1 ? "entry" : "entries"} for ${sites.map((s) => s.name).join(", ")}${label ? ` (${label})` : ""}. They are waiting for your review.`;
  for (const m of managers) {
    await createNotification(m.user_id, DRAFT_SUBMITTED_NOTIFICATION, "Entries submitted for review", message, "/data/approvals", {
      rows: rows.length,
      tco2e,
      site_ids: siteIds,
      months,
    });
  }
}

// ---------------------------------------------------------------------------
// Nothing this month
// ---------------------------------------------------------------------------

export interface NothingResult {
  site_id: number;
  category_id: number;
  /** First day of the month, YYYY-MM-01. */
  month: string;
  nothing: boolean;
}

/**
 * Marks (or clears) "Nothing this month" for a site, category and month.
 * Any role with the site may do it, a User only for categories granted to
 * them; the category must be one the site reports. Needs the switch on
 * (REVIEW_WORKFLOW_OFF) and an open month (PERIOD_LOCKED).
 */
export async function setNothingThisMonth(caller: Caller, body: { site_id: number; category_id: number; month: string }, nothing: boolean): Promise<NothingResult> {
  const period = `${body.month.slice(0, 7)}-01`;
  const allowed = await accessibleSiteIds(caller.userId, caller.role);
  const [site]: Array<{ site_id: number }> = await AppDataSource.query(`SELECT site_id FROM site WHERE site_id = $1`, [body.site_id]);
  if (!site || (allowed && !allowed.has(body.site_id))) throw new AccessError(404, "Not found.");
  const [assigned]: Array<{ ok: number }> = await AppDataSource.query(
    `SELECT 1 AS ok FROM site_categories WHERE site_id = $1 AND category_id = $2`,
    [body.site_id, body.category_id],
  );
  if (!assigned) throw new AccessError(404, "Not found.");
  if (caller.role === UserRole.USER) {
    const grants: Array<{ category_id: number }> = await AppDataSource.query(`SELECT category_id FROM user_categories WHERE user_id = $1`, [caller.userId]);
    if (grants.length && !grants.some((g) => Number(g.category_id) === body.category_id)) throw new AccessError(403, "This category isn't yours to report.");
  }
  if (!(await reviewWorkflowOn(AppDataSource.manager, body.site_id))) throw new Scope3Error("REVIEW_WORKFLOW_OFF");
  // Under a write lease (periodLease.ts): clearing a mark while the month is being locked would leave it incomplete.
  const siteMonth = siteMonthOf(body.site_id, period);
  await withPeriodWriteLease([siteMonth], async () => {
    const locked = await lockedSiteMonths(AppDataSource.manager, [siteMonth]);
    if (locked.length) throw new Scope3Error("PERIOD_LOCKED", { periods: locked });

    if (nothing) {
      await AppDataSource.query(
        `INSERT INTO nothing_this_month (site_id, category_id, period, user_id) VALUES ($1, $2, $3::date, $4)
         ON CONFLICT (site_id, category_id, period) DO NOTHING`,
        [body.site_id, body.category_id, period, caller.userId],
      );
    } else {
      await AppDataSource.query(`DELETE FROM nothing_this_month WHERE site_id = $1 AND category_id = $2 AND period = $3::date`, [body.site_id, body.category_id, period]);
    }
  });
  log.info("Scope3Review", nothing ? "Nothing this month set" : "Nothing this month cleared", { userId: caller.userId, siteId: body.site_id, categoryId: body.category_id, period });
  return { site_id: body.site_id, category_id: body.category_id, month: period, nothing };
}

// ---------------------------------------------------------------------------
// Dry-run checks and history (reads)
// ---------------------------------------------------------------------------

/** Every status: a draft or a Sent back row is checked as if it were submitted now. */
const ANY_STATUS = [EmissionStatus.DRAFT, EmissionStatus.PENDING, EmissionStatus.APPROVED, EmissionStatus.REJECTED] as const;

/**
 * POST /user/emissions/check: the checks each row would get if it were
 * submitted now (its FERA twins' held checks included, as approval treats a
 * family as one decision). Nothing is stored.
 */
export async function dryRunChecks(caller: Caller, ids: number[]): Promise<{ results: Array<{ id: number; status: string; checks: RowChecks }> }> {
  const wanted = ints(ids);
  const rows: Array<{ pk_id: number; site_id: number; status: string; created_by: number | null }> = await AppDataSource.query(
    `SELECT pk_id, site_id, status::text AS status, created_by FROM emission WHERE pk_id = ANY($1::int[])`,
    [wanted],
  );
  const visible = await visibleRows(caller, rows, wanted);
  const computed = await computeChecksFor(AppDataSource.manager, wanted, { statuses: ANY_STATUS });
  const byId = new Map(visible.map((r) => [Number(r.pk_id), r]));
  return {
    results: wanted.map((id) => ({ id, status: byId.get(id)!.status, checks: computed.get(id) ?? { ready: false, held: [] } })),
  };
}

export interface HistoryResult {
  id: number;
  site_id: number;
  category_id: number;
  emission_category: string | null;
  unit: "tCO2e";
  /** Oldest first, ending with the row's own month. Pending and approved rows only (as the threshold check reads). */
  months: Array<{ month: string; total_tco2e: number; rows: number }>;
}

/**
 * GET /user/emissions/:id/history?months=6: the row's activity (same site,
 * category and emission_category) over the `months` months ending with the
 * row's month, summed from pending and approved rows.
 */
export async function rowHistory(caller: Caller, id: number, months: number): Promise<HistoryResult> {
  const [row]: Array<{ pk_id: number; site_id: number; category_id: number; ec: string | null; month: string }> = await AppDataSource.query(
    `SELECT pk_id, site_id, category_id, activity_data ->> 'emission_category' AS ec, to_char(date_trunc('month', date_of_reporting), 'YYYY-MM-DD') AS month
       FROM emission WHERE pk_id = $1`,
    [id],
  );
  if (!row) throw new AccessError(404, "Not found.");
  await visibleRows(caller, [row], [id]);
  const series: Array<{ m: string; total: string | null; n: number }> = await AppDataSource.query(
    `SELECT to_char(m, 'YYYY-MM') AS m,
            (SELECT SUM(e.total_emission) FROM emission e
              WHERE e.site_id = $1 AND e.category_id = $2 AND e.activity_data ->> 'emission_category' IS NOT DISTINCT FROM $3
                AND e.status::text IN ('pending', 'approved')
                AND e.date_of_reporting >= m AND e.date_of_reporting < m + interval '1 month') AS total,
            (SELECT COUNT(*)::int FROM emission e
              WHERE e.site_id = $1 AND e.category_id = $2 AND e.activity_data ->> 'emission_category' IS NOT DISTINCT FROM $3
                AND e.status::text IN ('pending', 'approved')
                AND e.date_of_reporting >= m AND e.date_of_reporting < m + interval '1 month') AS n
       FROM generate_series($4::date - make_interval(months => $5 - 1), $4::date, interval '1 month') AS m
      ORDER BY m`,
    [row.site_id, row.category_id, row.ec, row.month, months],
  );
  return {
    id,
    site_id: Number(row.site_id),
    category_id: Number(row.category_id),
    emission_category: row.ec,
    unit: "tCO2e",
    months: series.map((s) => ({ month: s.m, total_tco2e: Math.round((Number(s.total) || 0) * 100) / 100, rows: Number(s.n) })),
  };
}
