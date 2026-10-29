/**
 * S3-14 · the company's Scope 3 base year and its recalculations.
 *
 *   - freeze:  PUT /scope3/base-year stores the base year, rationale and
 *              policy, and freezes approved base-year Scope 3 rows (same
 *              filters and kg as S3-13 computeScope3: approved rows only, kg
 *              summed then rounded, D5). Changing the year after a freeze
 *              needs a note and writes an approved `methodology` event.
 *   - check:   compares today's rows with the snapshot (detect.ts) and keeps
 *              at most one open proposal per company (nightly job and
 *              GET /scope3/recalculations).
 *   - approve: re-freezes the snapshot as a new version and records the event.
 *              Emission rows are never edited here.
 *   - dismiss: keeps the snapshot; the same changes are not proposed again.
 * Every query filters by the company resolved in boundary/access.ts. Changes
 * write audit_log rows (scope3_base_year, scope3_recalculation).
 */
import { AppDataSource } from "../../config/data-source";
import { getPeriodRange, type YearType } from "../../reporting/ghg-data";
import { emissionColumns, kgSql, type Scope3BaseYearSummary } from "../../reporting/ghg-scope3";
import { Scope3Error } from "../contracts/errors";
import { PostRecalculationBodySchema, PutBaseYearBodySchema, RECALCULATION_STATUSES } from "../contracts/schemas";
import { BoundaryError } from "../boundary/errors";
import { ensureBoundaryRows, isScope3Sql, type Queryable } from "../taxonomy/service";
import {
  type BaseYearSnapshot,
  type Comparison,
  type FrozenState,
  type RecalcReason,
  type RowPrint,
  RECALC_REASONS,
  categoryTotals,
  detectChanges,
  largestCategory,
  retotalled,
} from "./detect";

export const SCOPE = "Scope 3";
export const EVENT_STATUSES = RECALCULATION_STATUSES;
const MAX_TEXT = 4000;

async function audit(q: Queryable, entityType: string, entityId: number, action: string, changed: Record<string, { old: any; new: any }>, userId: number, reason: string | null) {
  await q.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [entityType, entityId, action, JSON.stringify(changed), reason, userId || null],
  );
}

/** First row of an UPDATE … RETURNING (TypeORM's postgres driver returns `[rows, count]` for an UPDATE). */
async function updateReturning(q: Queryable, sql: string, params: unknown[]): Promise<any> {
  const out: any = await q.query(sql, params);
  const rows = Array.isArray(out) && Array.isArray(out[0]) ? out[0] : out;
  return rows?.[0] ?? null;
}

/** Today's approved base-year Scope 3 rows, the company's sites and boundary, in the snapshot's shape. */
export async function currentState(companyId: number, year: number, yearType: YearType, q: Queryable = AppDataSource): Promise<FrozenState> {
  const cols = await emissionColumns(q);
  const range = getPeriodRange(yearType, year, "yearly");
  const rows: any[] = await q.query(
    `SELECT e.pk_id, e.site_id, c.ghg_category AS n, ${kgSql(cols)} AS kg,
            concat_ws('|', ${cols.has("method") ? "COALESCE(e.method, '')" : "''"},
              COALESCE(e.emission_factor_snapshot ->> 'dataset', ''),
              COALESCE(e.emission_factor_snapshot ->> 'dataset_version', ''),
              COALESCE(e.emission_factor_snapshot ->> 'gwp_set', ''),
              COALESCE(e.emission_factor_snapshot ->> 'emission_factor_id', ''),
              COALESCE(e.emission_factor_snapshot ->> 'factor_value', '')) AS fp,
            ${cols.has("dq") ? "(e.dq ->> 'overall')::numeric" : "NULL"} AS dq
       FROM emission e
       JOIN category c ON c.category_id = e.category_id
       JOIN site s ON s.site_id = e.site_id
      WHERE s.company_id = $1
        AND e.status = 'approved'
        AND e.date_of_reporting >= $2 AND e.date_of_reporting <= $3
        AND ${isScope3Sql("c")}`,
    [companyId, range.startDate, range.endDate],
  );
  const sites: any[] = await q.query(`SELECT site_id, lease_role FROM site WHERE company_id = $1`, [companyId]);
  await ensureBoundaryRows(companyId, q);
  const boundary: any[] = await q.query(
    `SELECT ghg_category, status, method_note FROM company_scope3_category WHERE company_id = $1`,
    [companyId],
  );
  const state: FrozenState = { rows: {}, sites: {}, boundary: {} };
  for (const r of rows) {
    state.rows[String(r.pk_id)] = [
      r.n === null ? null : Number(r.n),
      Number(r.kg) || 0,
      String(r.fp ?? ""),
      r.dq === null ? null : Number(r.dq),
      Number(r.site_id),
    ] as RowPrint;
  }
  for (const s of sites) state.sites[String(s.site_id)] = s.lease_role ?? null;
  for (const b of boundary) state.boundary[String(b.ghg_category)] = [b.status, b.method_note ?? null];
  return state;
}

function buildSnapshot(state: FrozenState, year: number, yearType: YearType, version: number): BaseYearSnapshot {
  const totals = categoryTotals(state.rows);
  return { version, frozen_at: new Date().toISOString(), base_year: year, year_type: yearType, ...totals, ...state };
}

/** The snapshot without the per-row fingerprints (API and event bodies); totals from its rows' kg (#209). */
const summary = (snap: BaseYearSnapshot | null) => {
  if (!snap) return null;
  const s = retotalled(snap);
  return {
    version: s.version,
    frozen_at: s.frozen_at,
    base_year: s.base_year,
    year_type: s.year_type,
    total_tco2e: s.total_tco2e,
    categories: s.categories,
    rows: Object.keys(s.rows ?? {}).length,
  };
};

const publicRow = (r: any) =>
  r && {
    id: Number(r.id),
    company_id: Number(r.company_id),
    scope: r.scope,
    base_year: Number(r.base_year),
    year_type: r.year_type,
    significance_pct: Number(r.significance_pct),
    policy_note: r.policy_note ?? null,
    rationale: r.rationale ?? null,
    snapshot: summary(r.snapshot),
    updated_by: r.updated_by === null ? null : Number(r.updated_by),
    updated_at: r.updated_at,
  };

const publicEvent = (e: any) => ({
  id: Number(e.id),
  company_id: Number(e.company_id),
  scope: e.scope,
  reason: e.reason,
  status: e.status,
  affected_years: e.affected_years ?? [],
  delta_tco2e: Number(e.delta_tco2e),
  note: e.note ?? null,
  before: e.before ?? null,
  after: e.after ?? null,
  changes: e.details?.changes ?? [],
  delta_pct: e.details?.delta_pct ?? null,
  threshold_tco2e: e.details?.threshold_tco2e ?? null,
  largest_category: e.details?.largest_category ?? null,
  version: e.details?.version ?? null,
  approved_by: e.approved_by === null || e.approved_by === undefined ? null : Number(e.approved_by),
  approved_by_name: e.approved_by_name ?? null,
  decided_at: e.decided_at ?? null,
  created_at: e.created_at,
  updated_at: e.updated_at,
});

const details = (c: Comparison, version: number) => ({
  changes: c.changes,
  signature: c.signature,
  version,
  delta_pct: c.delta_pct,
  threshold_tco2e: c.threshold_tco2e,
  largest_category: largestCategory(c),
});

async function baseYearRow(companyId: number, q: Queryable, lock = false) {
  const [row]: any[] = await q.query(
    `SELECT * FROM company_base_year WHERE company_id = $1 AND scope = $2${lock ? " FOR UPDATE" : ""}`,
    [companyId, SCOPE],
  );
  return row ?? null;
}

/** The row with the snapshot's totals and rows (no sites or boundary), for the report block. */
async function baseYearTotals(companyId: number, q: Queryable) {
  const [row]: any[] = await q.query(
    `SELECT base_year, year_type, rationale, policy_note, significance_pct, snapshot - 'sites' - 'boundary' AS snapshot
       FROM company_base_year WHERE company_id = $1 AND scope = $2`,
    [companyId, SCOPE],
  );
  return row ?? null;
}

async function openProposal(companyId: number, q: Queryable) {
  const [row]: any[] = await q.query(
    `SELECT * FROM recalculation_event WHERE company_id = $1 AND scope = $2 AND status = 'proposed' ORDER BY id DESC LIMIT 1`,
    [companyId, SCOPE],
  );
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** GET /scope3/base-year: the base year (or null), today's drift against it and the open proposal. */
export async function getBaseYear(companyId: number) {
  const row = await baseYearRow(companyId, AppDataSource);
  if (!row) return { base_year: null, approved_recalculations: [], drift: null, open_proposal: null };
  const state = await currentState(companyId, Number(row.base_year), row.year_type, AppDataSource);
  const cmp = detectChanges(row.snapshot, state, Number(row.significance_pct));
  const open = await openProposal(companyId, AppDataSource);
  const approved = (await baseYearSummary(companyId, AppDataSource))?.events ?? [];
  return {
    base_year: publicRow(row),
    approved_recalculations: approved,
    drift: {
      delta_tco2e: cmp.delta_tco2e,
      delta_pct: cmp.delta_pct,
      threshold_tco2e: cmp.threshold_tco2e,
      significant: cmp.significant,
      reason: cmp.reason,
      largest_category: largestCategory(cmp),
      current: cmp.after,
      changes: cmp.changes,
    },
    open_proposal: open ? publicEvent(open) : null,
  };
}

/**
 * GET /scope3/recalculations?status=. For an Admin or Superadmin (`recheck`) it runs the check first,
 * so the open proposal is current; that can create, update or auto-dismiss the proposal. Other roles
 * only read what the nightly job left.
 */
export async function listRecalculations(companyId: number, status?: unknown, recheck = false) {
  if (status !== undefined && status !== "" && !EVENT_STATUSES.includes(status as any)) {
    throw new BoundaryError("SCOPE3_VALIDATION", { status: `Use one of ${EVENT_STATUSES.join(", ")}.` });
  }
  if (recheck) await checkCompany(companyId);
  const params: any[] = [companyId, SCOPE];
  let filter = "";
  if (status) {
    params.push(status);
    filter = `AND r.status = $3`;
  }
  const rows: any[] = await AppDataSource.query(
    `SELECT r.*, NULLIF(trim(concat_ws(' ', u.name, u.last_name)), '') AS approved_by_name
       FROM recalculation_event r
       LEFT JOIN "user" u ON u.user_id = r.approved_by
      WHERE r.company_id = $1 AND r.scope = $2 ${filter}
      ORDER BY r.created_at DESC, r.id DESC`,
    params,
  );
  return { events: rows.map(publicEvent) };
}

/** The report's base-year block (S3-13 `scope3Blocks`); null when none is set. */
export async function baseYearSummary(companyId: number, q: Queryable = AppDataSource): Promise<Scope3BaseYearSummary | null> {
  const row = await baseYearTotals(companyId, q);
  if (!row?.snapshot) return null;
  const events: any[] = await q.query(
    `SELECT reason, delta_tco2e, note, COALESCE(decided_at, created_at) AS at
       FROM recalculation_event WHERE company_id = $1 AND scope = $2 AND status = 'approved'
      ORDER BY COALESCE(decided_at, created_at) DESC, id DESC`,
    [companyId, SCOPE],
  );
  const s = retotalled(row.snapshot as BaseYearSnapshot); // #209: category totals from the rows' kg, at 3 dp
  return {
    base_year: Number(row.base_year),
    year_type: row.year_type === "FY" ? "FY" : "CY",
    rationale: row.rationale ?? null,
    policy_note: row.policy_note ?? null,
    significance_pct: Number(row.significance_pct),
    frozen_at: s.frozen_at ?? null,
    version: s.version ?? 1,
    categories: s.categories ?? [],
    events: events.map((e) => ({
      reason: e.reason,
      delta_tco2e: Number(e.delta_tco2e),
      note: e.note ?? null,
      created_at: new Date(e.at).toISOString(),
    })),
  };
}

/** A base year must have ended: CY up to last year, an FY once its last month is over. */
function isCompletedYear(yearType: YearType, year: number, now = new Date()) {
  return getPeriodRange(yearType, year, "yearly").endDate.getTime() < now.getTime();
}

/** GET /scope3/base-year/preview?base_year=&year_type=: what PUT would freeze, without saving. */
export async function previewBaseYear(companyId: number, query: any) {
  const year = Number(query?.base_year);
  const yearType: YearType = query?.year_type === "FY" ? "FY" : "CY";
  if (!Number.isInteger(year) || year < 1990 || !isCompletedYear(yearType, year)) {
    throw new BoundaryError("SCOPE3_VALIDATION", [{ path: "base_year", message: "Give a completed year from 1990 on." }]);
  }
  const state = await currentState(companyId, year, yearType, AppDataSource);
  if (!Object.keys(state.rows).length) throw new Scope3Error("BASE_YEAR_NO_DATA", { base_year: year, year_type: yearType });
  const totals = categoryTotals(state.rows);
  return { base_year: year, year_type: yearType, total_tco2e: totals.total_tco2e, categories: totals.categories, rows: Object.keys(state.rows).length };
}

// ---------------------------------------------------------------------------
// Freeze
// ---------------------------------------------------------------------------

const cleanText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_TEXT) : null);

/** PUT /scope3/base-year (Admin, Superadmin). */
export async function putBaseYear(companyId: number, body: any, userId: number) {
  const parsed = PutBaseYearBodySchema.safeParse({
    scope: SCOPE,
    year_type: "CY",
    ...body,
    company_id: undefined,
    snapshot: undefined,
  });
  if (!parsed.success) {
    throw new BoundaryError("SCOPE3_VALIDATION", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const input = parsed.data;
  if (input.scope !== SCOPE) throw new BoundaryError("SCOPE3_VALIDATION", [{ path: "scope", message: "Only a Scope 3 base year can be set here." }]);
  const yearType: YearType = input.year_type === "FY" ? "FY" : "CY";
  if (!isCompletedYear(yearType, input.base_year)) {
    throw new BoundaryError("SCOPE3_VALIDATION", [{ path: "base_year", message: "The base year must be a completed year." }]);
  }
  const policy = {
    significance_pct: input.significance_pct ?? 5,
    policy_note: cleanText(input.policy_note),
    rationale: cleanText(input.rationale),
  };

  return AppDataSource.transaction(async (m) => {
    const existing = await baseYearRow(companyId, m, true);
    const sameYear = existing && Number(existing.base_year) === input.base_year && existing.year_type === yearType;

    if (existing && sameYear) {
      // Same year: policy fields only. Re-freezing here would hide changes from the recalculation check.
      const changed: Record<string, { old: any; new: any }> = {};
      for (const k of ["significance_pct", "policy_note", "rationale"] as const) {
        const old = k === "significance_pct" ? Number(existing[k]) : existing[k] ?? null;
        if (old !== policy[k]) changed[k] = { old, new: policy[k] };
      }
      if (!Object.keys(changed).length) return publicRow(existing);
      const row = await updateReturning(
        m,
        `UPDATE company_base_year SET significance_pct = $2, policy_note = $3, rationale = $4, updated_by = $5, updated_at = now() WHERE id = $1 RETURNING *`,
        [existing.id, policy.significance_pct, policy.policy_note, policy.rationale, userId || null],
      );
      await audit(m, "scope3_base_year", Number(row.id), "update", changed, userId, null);
      return publicRow(row);
    }

    const note = cleanText(body?.note ?? body?.reason_note);
    if (existing && !note) throw new Scope3Error("RECALCULATION_REASON_REQUIRED");

    const state = await currentState(companyId, input.base_year, yearType, m);
    if (!Object.keys(state.rows).length) throw new Scope3Error("BASE_YEAR_NO_DATA", { base_year: input.base_year, year_type: yearType });
    const prev: BaseYearSnapshot | null = existing?.snapshot ? retotalled(existing.snapshot) : null;
    const snapshot = buildSnapshot(state, input.base_year, yearType, (prev?.version ?? 0) + 1);

    const [row]: any[] = await m.query(
      `INSERT INTO company_base_year (company_id, scope, base_year, year_type, significance_pct, policy_note, rationale, snapshot, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (company_id, scope) DO UPDATE SET base_year = EXCLUDED.base_year, year_type = EXCLUDED.year_type,
         significance_pct = EXCLUDED.significance_pct, policy_note = EXCLUDED.policy_note, rationale = EXCLUDED.rationale,
         snapshot = EXCLUDED.snapshot, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      [companyId, SCOPE, input.base_year, yearType, policy.significance_pct, policy.policy_note, policy.rationale, JSON.stringify(snapshot), userId || null],
    );

    if (existing) {
      // A new base year is a methodology change (§9.3): close any open proposal and record it.
      await m.query(
        `UPDATE recalculation_event SET status = 'dismissed', note = COALESCE(note, 'Base year changed.'), decided_at = now(), updated_at = now()
          WHERE company_id = $1 AND scope = $2 AND status = 'proposed'`,
        [companyId, SCOPE],
      );
      const [event]: any[] = await m.query(
        `INSERT INTO recalculation_event (company_id, scope, reason, status, affected_years, delta_tco2e, note, before, after, details, approved_by, decided_at)
         VALUES ($1, $2, 'methodology', 'approved', $3, $4, $5, $6, $7, $8, $9, now()) RETURNING id`,
        [
          companyId,
          SCOPE,
          JSON.stringify([...new Set([Number(existing.base_year), input.base_year])]),
          Math.round((snapshot.total_tco2e - (prev?.total_tco2e ?? 0)) * 10000) / 10000,
          note,
          JSON.stringify(summary(prev)),
          JSON.stringify(summary(snapshot)),
          JSON.stringify({ changes: [], version: snapshot.version, kind: "base_year_changed" }),
          userId || null,
        ],
      );
      await audit(m, "scope3_recalculation", Number(event.id), "approve", { status: { old: null, new: "approved" }, reason: { old: null, new: "methodology" } }, userId, note);
    }
    await audit(
      m,
      "scope3_base_year",
      Number(row.id),
      existing ? "refreeze" : "freeze",
      {
        base_year: { old: existing ? Number(existing.base_year) : null, new: input.base_year },
        year_type: { old: existing?.year_type ?? null, new: yearType },
        version: { old: prev?.version ?? null, new: snapshot.version },
        total_tco2e: { old: prev?.total_tco2e ?? null, new: snapshot.total_tco2e },
      },
      userId,
      note,
    );
    return publicRow(row);
  });
}

// ---------------------------------------------------------------------------
// Check (nightly job and GET /scope3/recalculations)
// ---------------------------------------------------------------------------

export type CheckOutcome = "none" | "no_base_year" | "proposed" | "updated" | "unchanged" | "dismissed_again" | "auto_dismissed";

/** Compares today's rows with the snapshot and keeps at most one open proposal. */
export async function checkCompany(companyId: number): Promise<CheckOutcome> {
  return AppDataSource.transaction(async (m) => {
    // The row lock serialises concurrent checks, so there is never a second open proposal.
    const row = await baseYearRow(companyId, m, true);
    if (!row?.snapshot) return "no_base_year";
    const snapshot = row.snapshot as BaseYearSnapshot;
    const state = await currentState(companyId, Number(row.base_year), row.year_type, m);
    const cmp = detectChanges(snapshot, state, Number(row.significance_pct));
    const open = await openProposal(companyId, m);

    if (!cmp.significant) {
      if (!open) return "none";
      // Marked so it never counts as an Admin's dismissal: the same changes can be proposed again.
      const note = "Changes are no longer above the threshold.";
      await m.query(
        `UPDATE recalculation_event SET status = 'dismissed', note = $2, details = COALESCE(details, '{}'::jsonb) || '{"auto_dismissed": true}'::jsonb,
                decided_at = now(), updated_at = now() WHERE id = $1`,
        [open.id, note],
      );
      await audit(m, "scope3_recalculation", Number(open.id), "dismiss", { status: { old: "proposed", new: "dismissed" }, auto_dismissed: { old: null, new: true } }, 0, note);
      return "auto_dismissed";
    }
    if (open?.details?.signature === cmp.signature) return "unchanged";
    if (!open) {
      const [dismissed]: any[] = await m.query(
        `SELECT details ->> 'signature' AS signature FROM recalculation_event
          WHERE company_id = $1 AND scope = $2 AND status = 'dismissed' AND (details ->> 'version')::int = $3
            AND COALESCE((details ->> 'auto_dismissed')::boolean, false) = false
          ORDER BY id DESC LIMIT 1`,
        [companyId, SCOPE, snapshot.version],
      );
      // A proposal dismissed before #209 holds the signature of 2-dp deltas.
      if (dismissed && (dismissed.signature === cmp.signature || dismissed.signature === cmp.legacy_signature)) return "dismissed_again";
    }
    const values = [
      cmp.reason ?? "error",
      JSON.stringify([Number(row.base_year)]),
      cmp.delta_tco2e,
      JSON.stringify(cmp.before),
      JSON.stringify(cmp.after),
      JSON.stringify(details(cmp, snapshot.version)),
    ];
    if (open) {
      await m.query(
        `UPDATE recalculation_event SET reason = $2, affected_years = $3, delta_tco2e = $4, before = $5, after = $6, details = $7, updated_at = now() WHERE id = $1`,
        [open.id, ...values],
      );
      return "updated";
    }
    await m.query(
      `INSERT INTO recalculation_event (company_id, scope, reason, status, affected_years, delta_tco2e, before, after, details)
       VALUES ($1, $2, $3, 'proposed', $4, $5, $6, $7, $8)`,
      [companyId, SCOPE, ...values],
    );
    return "proposed";
  });
}

/** Every company with a base year, in batches (the nightly job). Logs counts only. */
export async function checkAllCompanies(): Promise<Record<CheckOutcome | "failed", number>> {
  const counts: Record<string, number> = {};
  let lastId = 0;
  for (;;) {
    const rows: { id: number; company_id: number }[] = await AppDataSource.query(
      `SELECT id, company_id FROM company_base_year WHERE scope = $1 AND id > $2 ORDER BY id LIMIT 1000`,
      [SCOPE, lastId],
    );
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;
    for (const r of rows) {
      let outcome: string;
      try {
        outcome = await checkCompany(Number(r.company_id));
      } catch (err) {
        console.error(`[scope3] base-year check failed for company ${r.company_id}:`, (err as any)?.code ?? (err as Error)?.message);
        outcome = "failed";
      }
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    }
  }
  return counts as Record<CheckOutcome | "failed", number>;
}

// ---------------------------------------------------------------------------
// Approve and dismiss
// ---------------------------------------------------------------------------

/** POST /scope3/recalculations `{reason, note?}` (Admin, Superadmin): approve and re-freeze. */
export async function approveRecalculation(companyId: number, body: any, userId: number) {
  const reason = body?.reason as RecalcReason;
  if (!RECALC_REASONS.includes(reason)) throw new Scope3Error("RECALCULATION_REASON_REQUIRED");
  // affected_years defaults to the base year (filled in below), so only a sent list is checked here.
  const parsed = PostRecalculationBodySchema.safeParse({
    reason,
    affected_years: body?.affected_years ?? [new Date().getFullYear() - 1],
    note: body?.note ?? null,
  });
  if (!parsed.success) {
    throw new BoundaryError("SCOPE3_VALIDATION", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const note = cleanText(parsed.data.note);

  return AppDataSource.transaction(async (m) => {
    const row = await baseYearRow(companyId, m, true);
    if (!row?.snapshot) throw new BoundaryError("SCOPE3_NOT_FOUND");
    const prev = retotalled(row.snapshot as BaseYearSnapshot);
    const state = await currentState(companyId, Number(row.base_year), row.year_type, m);
    const cmp = detectChanges(prev, state, Number(row.significance_pct));
    const open = await openProposal(companyId, m);
    // Below the threshold an Admin may still recalculate (several small changes can add up, §9.3),
    // but only when something changed.
    if (!open && !cmp.changes.length) {
      throw new BoundaryError("SCOPE3_VALIDATION", [{ path: "reason", message: "Nothing changed since the base year was frozen." }]);
    }

    const next = buildSnapshot(state, Number(row.base_year), row.year_type, (prev.version ?? 1) + 1);
    await m.query(`UPDATE company_base_year SET snapshot = $2, updated_by = $3, updated_at = now() WHERE id = $1`, [
      row.id,
      JSON.stringify(next),
      userId || null,
    ]);
    const affected = Array.isArray(body?.affected_years) ? parsed.data.affected_years : [Number(row.base_year)];
    const values = [reason, JSON.stringify(affected), cmp.delta_tco2e, note, JSON.stringify(cmp.before), JSON.stringify(cmp.after), JSON.stringify(details(cmp, prev.version ?? 1)), userId || null];
    let event: any;
    if (open) {
      event = await updateReturning(
        m,
        `UPDATE recalculation_event SET status = 'approved', reason = $2, affected_years = $3, delta_tco2e = $4, note = $5, before = $6, after = $7, details = $8,
                approved_by = $9, decided_at = now(), updated_at = now()
          WHERE id = $1 RETURNING *`,
        [open.id, ...values],
      );
    } else {
      [event] = await m.query(
        `INSERT INTO recalculation_event (company_id, scope, reason, affected_years, delta_tco2e, note, before, after, details, approved_by, status, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'approved', now()) RETURNING *`,
        [companyId, SCOPE, ...values],
      );
    }
    await audit(m, "scope3_recalculation", Number(event.id), "approve", {
      status: { old: open ? "proposed" : null, new: "approved" },
      reason: { old: open?.reason ?? null, new: reason },
      delta_tco2e: { old: null, new: cmp.delta_tco2e },
    }, userId, note);
    await audit(m, "scope3_base_year", Number(row.id), "refreeze", {
      version: { old: prev.version ?? 1, new: next.version },
      total_tco2e: { old: prev.total_tco2e, new: next.total_tco2e },
    }, userId, note);
    return { event: publicEvent(event), base_year: publicRow({ ...row, snapshot: next }) };
  });
}

/** POST /scope3/recalculations/:id/dismiss `{note?}` (Admin, Superadmin): keeps the snapshot. */
export async function dismissRecalculation(companyId: number, id: number, body: any, userId: number) {
  if (!Number.isInteger(id) || id <= 0) throw new BoundaryError("SCOPE3_NOT_FOUND");
  const note = cleanText(body?.note);
  return AppDataSource.transaction(async (m) => {
    const event = await updateReturning(
      m,
      `UPDATE recalculation_event SET status = 'dismissed', note = $3, approved_by = $4, decided_at = now(), updated_at = now()
        WHERE id = $1 AND company_id = $2 AND scope = $5 AND status = 'proposed' RETURNING *`,
      [id, companyId, note, userId || null, SCOPE],
    );
    if (!event) throw new BoundaryError("SCOPE3_NOT_FOUND");
    await audit(m, "scope3_recalculation", Number(event.id), "dismiss", { status: { old: "proposed", new: "dismissed" } }, userId, note);
    return { event: publicEvent(event) };
  });
}
