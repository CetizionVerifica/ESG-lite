/**
 * S3-15 part 2 · live checks for unsaved rows (`POST /user/emissions/check
 * {rows}`), for the add-data and "Fix" panels. Each row goes through the same
 * engine path as a save (`prepareEntry`: factor, unit, method, spend, twins)
 * and then the §8 review checks with the same context a saved row gets:
 * duplicates and month totals from pending and approved rows, the company's
 * change limit, evidence from `has_evidence`. IMPORT_MATCH_SURE doesn't apply
 * to a typed row. Nothing is written.
 *
 * With `id` the row is an edit of that saved row: the row (and its FERA
 * family) is left out of its own duplicate and month-total comparison, and
 * its saved evidence counts when `has_evidence` is left out.
 *
 * Access is POST /user/emissions's: the caller's sites (another company's
 * site, or someone else's Draft as `id`, reads as not found; a site of the
 * caller's company that isn't theirs is 403), and a User's own categories.
 */
import type { EntityManager } from "typeorm";
import { UserRole } from "../../types/type";
import { accessibleSiteIds, resolveUserCompanyId } from "../../utils/companyScope";
import { CheckCache, ContextCache, findDuplicate, prepareEntry, type PreparedEntry } from "../../services/emissionWrite";
import { factorSnapshot } from "../../services/emissionWrite/compute";
import { validatePeriodFields } from "../../services/reportingPeriod";
import { parseRowQuality } from "../dq/input";
import { Emission } from "../../entities/Emission";
import type { LiveCheckResult, LiveCheckRow } from "../contracts/schemas";
import { computeChecks, DEFAULT_THRESHOLD_PCT } from "./checks";
import { AccessError, type Caller } from "./lock";

/** Rows that count towards duplicates and month totals, as for saved rows (service.ts). */
const COUNTED = ["pending", "approved"];

const previousMonthOf = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
};

interface SavedRow {
  pk_id: number;
  site_id: number;
  status: string;
  created_by: number | null;
  fera_linked_id: number | null;
  family: number[];
  has_evidence: boolean;
}

/** Access for the whole request first: any refusal is the request's, as on POST /user/emissions. */
async function checkAccess(manager: EntityManager, caller: Caller, rows: LiveCheckRow[]): Promise<Map<number, SavedRow>> {
  const allowed = await accessibleSiteIds(caller.userId, caller.role);
  const siteIds = [...new Set(rows.map((r) => r.site_id))];
  const sites: Array<{ site_id: number; company_id: number | null }> = await manager.query(`SELECT site_id, company_id FROM site WHERE site_id = ANY($1::int[])`, [siteIds]);
  const own = caller.role === UserRole.SUPERADMIN ? null : await resolveUserCompanyId(caller.userId);
  for (const id of siteIds) {
    const site = sites.find((s) => Number(s.site_id) === id);
    if (!site || (own !== null && Number(site.company_id) !== own)) throw new AccessError(404, "Not found.");
    if (allowed && !allowed.has(id)) throw new AccessError(403, "You do not have access to one or more of these sites.");
  }
  if (caller.role === UserRole.USER) {
    const grants: Array<{ category_id: number }> = await manager.query(`SELECT category_id FROM user_categories WHERE user_id = $1`, [caller.userId]);
    const granted = new Set(grants.map((g) => Number(g.category_id)));
    if (granted.size && rows.some((r) => !granted.has(r.category_id))) throw new AccessError(403, "This category isn't yours to report.");
  }

  const ids = [...new Set(rows.map((r) => r.id).filter((x): x is number => !!x))];
  const saved = new Map<number, SavedRow>();
  if (!ids.length) return saved;
  const found: Array<Omit<SavedRow, "family">> = await manager.query(
    `SELECT e.pk_id, e.site_id, e.status::text AS status, e.created_by, e.fera_linked_id,
            EXISTS (SELECT 1 FROM emission_document d WHERE d.emission_id = e.pk_id OR d.emission_id = e.fera_linked_id
                       OR d.emission_id IN (SELECT p.pk_id FROM emission p WHERE p.fera_linked_id = e.pk_id)) AS has_evidence
       FROM emission e WHERE e.pk_id = ANY($1::bigint[])`,
    [ids],
  );
  for (const id of ids) {
    const r = found.find((f) => Number(f.pk_id) === id);
    const othersDraft = r && r.status === "draft" && Number(r.created_by) !== Number(caller.userId);
    if (!r || othersDraft || (allowed && !allowed.has(Number(r.site_id)))) throw new AccessError(404, "Not found.");
    const family: Array<{ pk_id: number }> = await manager.query(
      `SELECT pk_id FROM emission WHERE pk_id = $1::bigint OR fera_linked_id = $1::bigint OR pk_id = $2::bigint OR fera_linked_id = $2::bigint`,
      [id, r.fera_linked_id],
    );
    saved.set(id, { ...r, pk_id: id, site_id: Number(r.site_id), family: family.map((f) => Number(f.pk_id)), has_evidence: Boolean(r.has_evidence) });
  }
  return saved;
}

/** Sum of counted rows of one activity in one month, leaving `exclude` out. */
const monthTotal = async (manager: EntityManager, siteId: number, categoryId: number, ec: string, month: string, exclude: number[]): Promise<number | null> => {
  const [r]: Array<{ total: string | null }> = await manager.query(
    `SELECT SUM(total_emission) AS total FROM emission
      WHERE site_id = $1 AND category_id = $2 AND activity_data ->> 'emission_category' = $3
        AND status::text = ANY($4) AND reporting_period = 'monthly'
        AND date_of_reporting >= $5::date AND date_of_reporting < ($5::date + interval '1 month')
        AND pk_id <> ALL($6::bigint[])`,
    [siteId, categoryId, ec, COUNTED, month, exclude],
  );
  return r?.total === null || r?.total === undefined ? null : Number(r.total);
};

const issueOf = (code: string, message: string, field?: string): NonNullable<LiveCheckResult["issue"]> => (field ? { code, message, field } : { code, message });

/** The checks each unsaved row would get if it were saved and submitted now. */
export async function liveChecks(manager: EntityManager, caller: Caller, rows: LiveCheckRow[]): Promise<{ results: LiveCheckResult[] }> {
  const saved = await checkAccess(manager, caller, rows);
  const contexts = new ContextCache(manager);
  const cache = new CheckCache(manager);
  const thresholdOf = new Map<number, number>();
  const results: LiveCheckResult[] = [];

  for (const row of rows) {
    const edit = row.id ? saved.get(row.id) : undefined;
    const exclude = edit?.family ?? [0];
    const reporting_period = row.reporting_period ?? "monthly";
    const year_type = reporting_period === "yearly" ? row.year_type ?? null : null;
    const activity_data = { ...(row.activity_data as Record<string, any>) };
    let issue: LiveCheckResult["issue"];
    let entry: PreparedEntry | null = null;

    const ctx = await contexts.context(row.site_id, row.category_id);
    const periodError = validatePeriodFields({ category_id: row.category_id, reporting_period, year_type, date_of_reporting: new Date(row.date_of_reporting) });
    const quality = parseRowQuality(row.method ? { method: row.method } : {});
    if (!ctx.assigned) issue = issueOf("CATEGORY_NOT_ASSIGNED", "This category isn't set up for this site.", "category_id");
    else if (periodError) issue = issueOf("PERIOD_INVALID", periodError, "date_of_reporting");
    else if (!quality.ok) issue = issueOf("METHOD_NOT_ALLOWED", quality.message, quality.field);
    else {
      const prepared = await prepareEntry(ctx, cache, {
        site_id: row.site_id,
        category_id: row.category_id,
        activity_data,
        activity_data_unit: row.activity_data_unit ?? null,
        period: { date_of_reporting: row.date_of_reporting, reporting_period, year_type },
        extra_data: {},
        ...quality.value,
        // SE-2: as the save would (a User's row takes the method the form decides).
        method_source: caller.role === UserRole.USER ? "contributor" : "caller",
        // D6a: as the edit would (a row saved with a FERA twin keeps its WTT there).
        keep_fera_twin: !!edit?.fera_linked_id,
      });
      if (prepared.ok) entry = prepared.entry;
      else issue = issueOf(prepared.issue.code, prepared.issue.message, prepared.issue.field);
    }

    // Duplicates: another counted row on the same date with the same activity identity (not the row itself).
    const others: Array<{ pk_id: number; activity_data: any }> = await manager.query(
      `SELECT pk_id, activity_data FROM emission
        WHERE site_id = $1 AND category_id = $2 AND date_of_reporting = $3::date AND reporting_period = $4
          AND status::text = ANY($5) AND pk_id <> ALL($6::bigint[])
        ORDER BY pk_id`,
      [row.site_id, row.category_id, row.date_of_reporting, reporting_period, COUNTED, exclude],
    );
    const dup = findDuplicate(others as Emission[], activity_data, ctx.spec ?? null);

    // Month totals for WITHIN_THRESHOLD: the month with this row's total in place of its saved one.
    const ec = typeof activity_data.emission_category === "string" ? activity_data.emission_category : null;
    let total: number | null = null;
    let previous: number | null = null;
    if (reporting_period === "monthly" && ec) {
      const month = `${row.date_of_reporting.slice(0, 7)}-01`;
      const rest = await monthTotal(manager, row.site_id, row.category_id, ec, month, exclude);
      total = (rest ?? 0) + (entry?.computed?.total ?? 0);
      previous = await monthTotal(manager, row.site_id, row.category_id, ec, previousMonthOf(month), exclude);
    }
    if (ctx.company_id && !thresholdOf.has(ctx.company_id)) {
      const [t]: Array<{ threshold_percentage: string }> = await manager.query(`SELECT threshold_percentage FROM emission_threshold WHERE company_id = $1`, [ctx.company_id]);
      thresholdOf.set(ctx.company_id, t ? Number(t.threshold_percentage) : DEFAULT_THRESHOLD_PCT);
    }

    const checks = computeChecks(
      {
        date_of_reporting: row.date_of_reporting,
        reporting_period,
        activity_data_unit: (entry?.input.activity_data_unit ?? row.activity_data_unit ?? null) as string | null,
        emission_factor_snapshot: entry?.factor ? (factorSnapshot(entry.factor, entry.computed?.deflator) as any) : null,
      },
      {
        hasEvidence: row.has_evidence ?? edit?.has_evidence ?? false,
        duplicateOf: dup ? Number(dup.pk_id) : null,
        thresholdPct: (ctx.company_id ? thresholdOf.get(ctx.company_id) : undefined) ?? DEFAULT_THRESHOLD_PCT,
        monthTotal: total,
        previousMonthTotal: previous,
        importNeedsAttention: false,
      },
    );
    results.push(issue ? { ref: row.ref, checks, issue } : { ref: row.ref, checks });
  }
  return { results };
}
