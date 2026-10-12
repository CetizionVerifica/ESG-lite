import { randomUUID } from "crypto";
import { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { ImportPlan, ImportPlanMatch, ImportPlanRow } from "../../entities/ImportPlan";
import { EmissionCategoryMapping } from "../../entities/EmissionCategoryMapping";
import { AuditLog } from "../../entities/AuditLog";
import { UserRole } from "../../types/type";
import { resolveUserCompanyId } from "../../utils/companyScope";
import { ActivityMatch, GetPlanQuerySchema, ImportChannel, ImportPlan as ImportPlanView, ImportPlanWithRows, ImportRow, ImportRowSchema, ListBatchesQuerySchema, PlannedRow, RowIssue, TOTAL_LIKE_KEYS, UploadBatchSummary } from "../contracts";
import { ImportError } from "../errors";
import { IMPORT_LIMITS, PLAN_EXPIRY_MS } from "../limits";
import { emitBatchCommitted, WriterContext } from "../writer";
import { buildWriterContext, isMcpEnabled, TokenUser } from "./scope";
import { getEmissionWriter } from "./writerRegistry";

/**
 * Import plans (docs/mcp-import/backend/IM2-import-plans-api/CLAUDE.md).
 *
 * A plan is the stored result of EmissionWriter.planRows over the rows a
 * channel sent. Every change (append, patch) re-plans the whole plan and bumps
 * `version`; append, patch and commit must quote the current version. Commit
 * writes one pending upload batch in one transaction and emits
 * onBatchCommitted afterwards. Nothing here computes a total: the writer does.
 */

const TTL_MS = PLAN_EXPIRY_MS;
const FIRST_PAGE = IMPORT_LIMITS.PLAN_PREVIEW_ROWS;
const BATCH_PAGE = IMPORT_LIMITS.DEFAULT_PAGE_SIZE;

type Query = Record<string, unknown>;

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * row_refs of raw rows that carried a total-like key (contracts §1). The zod
 * schema strips those keys; the rows get a CLIENT_TOTAL_IGNORED warning.
 */
export const findTotalLikeRows = (rawRows: unknown): Set<string> => {
  const refs = new Set<string>();
  if (!Array.isArray(rawRows)) return refs;
  for (const r of rawRows) {
    if (r && typeof r === "object" && (TOTAL_LIKE_KEYS as readonly string[]).some((k) => k in (r as object)) && typeof (r as any).row_ref === "string") {
      refs.add((r as any).row_ref);
    }
  }
  return refs;
};

// ---------- loading and visibility ----------

const planRepo = () => AppDataSource.getRepository(ImportPlan);
const rowRepo = () => AppDataSource.getRepository(ImportPlanRow);
const matchRepo = () => AppDataSource.getRepository(ImportPlanMatch);

const isExpiredDraft = (plan: ImportPlan) => plan.status === "draft" && plan.expires_at.getTime() <= Date.now();

/**
 * A plan is visible to its creator and to any Superadmin; everyone else gets
 * 404, including people of another client, so plan ids can't be probed. A
 * draft that outlived its 24 h reads as expired (written back lazily).
 */
export const loadVisiblePlan = async (user: TokenUser, planId: string, m: EntityManager = AppDataSource.manager, lock = false): Promise<ImportPlan> => {
  if (!/^[0-9a-f-]{36}$/i.test(planId)) throw new ImportError("IMPORT_PLAN_NOT_FOUND");
  const qb = m.getRepository(ImportPlan).createQueryBuilder("p").where("p.plan_id = :id", { id: planId });
  // Inside a transaction the row is read under FOR UPDATE, so a second writer
  // waits here and then sees the first one's result (status, version).
  if (lock) qb.setLock("pessimistic_write");
  const plan = await qb.getOne();
  if (!plan) throw new ImportError("IMPORT_PLAN_NOT_FOUND");
  if (user.role !== UserRole.SUPERADMIN) {
    const own = await resolveUserCompanyId(Number(user.userId));
    if (own !== plan.company_id || plan.created_by !== Number(user.userId)) throw new ImportError("IMPORT_PLAN_NOT_FOUND");
  }
  if (isExpiredDraft(plan)) {
    plan.status = "expired";
    await m.getRepository(ImportPlan).update({ plan_id: plan.plan_id }, { status: "expired" });
  }
  return plan;
};

const assertDraft = (plan: ImportPlan, version: number) => {
  if (plan.status === "expired") throw new ImportError("IMPORT_PLAN_EXPIRED");
  if (plan.status !== "draft") throw new ImportError("IMPORT_PLAN_NOT_DRAFT", { status: plan.status });
  if (plan.version !== version) throw new ImportError("IMPORT_PLAN_VERSION_CONFLICT", { current_version: plan.version });
};

const contextForPlan = (user: TokenUser, plan: ImportPlan) => buildWriterContext(user, plan.company_id);

// ---------- planning ----------

const toPlanned = (r: ImportPlanRow): PlannedRow => ({
  row_ref: r.row_ref,
  state: r.state,
  issues: r.issues as RowIssue[],
  input: r.input as ImportRow,
  ...(r.result ? { result: r.result as PlannedRow["result"] } : {}),
});

const loadRows = (m: EntityManager, planId: string) =>
  m.getRepository(ImportPlanRow).find({ where: { plan_id: planId }, order: { position: "ASC" } });

const loadMatches = async (m: EntityManager, planId: string): Promise<ActivityMatch[]> =>
  (await m.getRepository(ImportPlanMatch).find({ where: { plan_id: planId } })).map((x) => ({
    site_id: x.site_id,
    category_id: x.category_id,
    sheet_name: x.sheet_name,
    factor_name: x.factor_name,
  }));

/**
 * Re-plan every non-skipped row, write the results back and refresh the
 * plan's counts, totals and issues summary. Bumps the version.
 */
const replan = async (m: EntityManager, ctx: WriterContext, plan: ImportPlan, rows: ImportPlanRow[], totalLike: Set<string> = new Set()) => {
  const writer = getEmissionWriter();
  const matches = await loadMatches(m, plan.plan_id);
  const active = rows.filter((r) => r.state !== "skipped");
  const planned = await writer.planRows(ctx, active.map((r) => r.input as ImportRow), { planMatches: matches });
  const byRef = new Map(planned.map((p) => [p.row_ref, p]));
  for (const r of active) {
    const p = byRef.get(r.row_ref);
    if (!p) continue;
    const issues = [...p.issues];
    if (totalLike.has(r.row_ref) && !issues.some((i) => i.code === "CLIENT_TOTAL_IGNORED")) {
      issues.push({ code: "CLIENT_TOTAL_IGNORED", severity: "warning", message: "The row carried a total or factor; it was ignored" });
    }
    r.state = p.state;
    r.issues = issues;
    r.result = (p.result as Record<string, unknown>) ?? null;
    r.input = p.input as Record<string, unknown>;
    await m.getRepository(ImportPlanRow).update({ id: r.id }, { state: r.state, issues: r.issues, result: r.result, input: r.input });
  }
  await refreshSummary(m, plan, rows);
};

const refreshSummary = async (m: EntityManager, plan: ImportPlan, rows: ImportPlanRow[]) => {
  const counts = { rows: rows.length, ready: 0, issue: 0, skipped: 0, warnings: 0 };
  const issueMap = new Map<string, { count: number; example_row_refs: string[] }>();
  const byCat = new Map<number, { tco2e: number; rows: number }>();
  const byMonth = new Map<string, number>();
  let tco2e = 0;
  for (const r of rows) {
    counts[r.state] += 1;
    const issues = r.issues as RowIssue[];
    if (issues.some((i) => i.severity === "warning")) counts.warnings += 1;
    for (const i of issues) {
      const e = issueMap.get(i.code) || { count: 0, example_row_refs: [] };
      e.count += 1;
      if (e.example_row_refs.length < 3) e.example_row_refs.push(r.row_ref);
      issueMap.set(i.code, e);
    }
    const res = r.result as PlannedRow["result"] | null;
    if (r.state === "ready" && res) {
      const total = Number(res.total_tco2e) + Number(res.fera?.total_tco2e ?? 0);
      tco2e += total;
      const cat = byCat.get(Number((r.input as ImportRow).category_id)) || { tco2e: 0, rows: 0 };
      cat.tco2e += Number(res.total_tco2e);
      cat.rows += 1;
      byCat.set(Number((r.input as ImportRow).category_id), cat);
      if (res.fera) {
        const f = byCat.get(res.fera.category_id) || { tco2e: 0, rows: 0 };
        f.tco2e += Number(res.fera.total_tco2e);
        byCat.set(res.fera.category_id, f);
      }
      const month = String(res.reporting_date).slice(0, 7);
      byMonth.set(month, (byMonth.get(month) || 0) + total);
    }
  }
  const catIds = [...byCat.keys()];
  const names: { category_id: number; category_name: string; scope: string | null }[] = catIds.length
    ? await m.query(`SELECT category_id, category_name, scope FROM category WHERE category_id = ANY($1::int[])`, [catIds])
    : [];
  const nameOf = new Map(names.map((c) => [Number(c.category_id), c]));
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  plan.counts = counts;
  plan.totals = {
    tco2e: round(tco2e),
    by_category: catIds
      .map((id) => ({ category_id: id, name: nameOf.get(id)?.category_name ?? "", scope: nameOf.get(id)?.scope ?? null, tco2e: round(byCat.get(id)!.tco2e), rows: byCat.get(id)!.rows }))
      .sort((a, b) => b.tco2e - a.tco2e),
    by_month: [...byMonth.entries()].sort().map(([month, t]) => ({ month, tco2e: round(t) })),
  };
  plan.issues_summary = [...issueMap.entries()].map(([code, e]) => ({ code, ...e })).sort((a, b) => b.count - a.count);
  plan.version += 1;
  plan.expires_at = new Date(Date.now() + TTL_MS);
  await m.getRepository(ImportPlan).update(
    { plan_id: plan.plan_id },
    { counts: plan.counts, totals: plan.totals, issues_summary: plan.issues_summary, version: plan.version, expires_at: plan.expires_at },
  );
};

// ---------- views ----------

export const planView = (plan: ImportPlan): ImportPlanView => ({
  plan_id: plan.plan_id,
  version: plan.version,
  status: plan.status,
  company_id: plan.company_id,
  created_by: plan.created_by,
  channel: plan.channel,
  source_name: plan.source_name,
  created_at: plan.created_at.toISOString(),
  updated_at: plan.updated_at.toISOString(),
  expires_at: plan.expires_at.toISOString(),
  counts: plan.counts as ImportPlanView["counts"],
  totals: plan.totals as ImportPlanView["totals"],
  issues_summary: plan.issues_summary as ImportPlanView["issues_summary"],
  ...(plan.committed ? { committed: plan.committed } : {}),
});

type PlanWithRows = ImportPlanWithRows;

const issuesFirst = (rows: ImportPlanRow[]) =>
  [...rows].sort((a, b) => (a.state === "issue" ? 0 : 1) - (b.state === "issue" ? 0 : 1) || a.position - b.position);

const withFirstRows = async (plan: ImportPlan): Promise<PlanWithRows> => {
  const fresh = (await planRepo().findOne({ where: { plan_id: plan.plan_id } })) || plan;
  const rows = await loadRows(AppDataSource.manager, plan.plan_id);
  return { ...planView(fresh), rows: issuesFirst(rows).slice(0, FIRST_PAGE).map(toPlanned), total_rows: rows.length };
};

// ---------- validation shared by create and append ----------

const assertRowRefsUnique = (incoming: ImportRow[], existing: Set<string>) => {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const r of incoming) {
    if (seen.has(r.row_ref) || existing.has(r.row_ref)) dupes.push(r.row_ref);
    seen.add(r.row_ref);
  }
  if (dupes.length) throw new ImportError("IMPORT_DUPLICATE_ROW_REF", { row_refs: [...new Set(dupes)].slice(0, 20) });
};

const assertRowLimits = (incoming: number, existing: number) => {
  if (incoming > IMPORT_LIMITS.ROWS_PER_REQUEST) throw new ImportError("IMPORT_TOO_MANY_ROWS", { max_per_request: IMPORT_LIMITS.ROWS_PER_REQUEST, sent: incoming });
  if (existing + incoming > IMPORT_LIMITS.ROWS_PER_PLAN) throw new ImportError("IMPORT_TOO_MANY_ROWS", { max_per_plan: IMPORT_LIMITS.ROWS_PER_PLAN, have: existing, sent: incoming });
};

const assertChannelAllowed = async (ctx: WriterContext, channel: ImportChannel) => {
  if (channel !== "mcp") return;
  if (ctx.role !== UserRole.SUPERADMIN) throw new ImportError("MCP_SUPERADMIN_ONLY");
  if (!(await isMcpEnabled(ctx.company_id))) throw new ImportError("MCP_DISABLED_FOR_CLIENT");
};

// ---------- operations ----------

export const createPlan = async (
  user: TokenUser,
  body: { source_name: string; channel: ImportChannel; company_id?: number; rows: ImportRow[] },
  totalLike: Set<string>,
) => {
  const ctx = await buildWriterContext(user, body.company_id);
  await assertChannelAllowed(ctx, body.channel);
  assertRowLimits(body.rows.length, 0);
  assertRowRefsUnique(body.rows, new Set());
  const drafts = await planRepo()
    .createQueryBuilder("p")
    .where("p.created_by = :uid AND p.status = 'draft' AND p.expires_at > now()", { uid: ctx.user_id })
    .getCount();
  if (drafts >= IMPORT_LIMITS.DRAFT_PLANS_PER_USER) throw new ImportError("IMPORT_TOO_MANY_PLANS", { max: IMPORT_LIMITS.DRAFT_PLANS_PER_USER });

  const plan = await AppDataSource.transaction(async (m) => {
    const plan = await m.getRepository(ImportPlan).save(
      m.getRepository(ImportPlan).create({
        company_id: ctx.company_id,
        created_by: ctx.user_id,
        channel: body.channel,
        source_name: body.source_name,
        status: "draft",
        version: 0,
        expires_at: new Date(Date.now() + TTL_MS),
      }),
    );
    const rows = await insertPlanRows(m, plan.plan_id, body.rows, 0);
    await replan(m, ctx, plan, rows, totalLike);
    return plan;
  });
  return withFirstRows(plan);
};

const insertPlanRows = async (m: EntityManager, planId: string, rows: ImportRow[], from: number) => {
  const repo = m.getRepository(ImportPlanRow);
  const entities = rows.map((r, i) => repo.create({ plan_id: planId, row_ref: r.row_ref, position: from + i, input: r, state: "issue", issues: [], result: null }));
  // chunked so a 2,000-row request stays one statement batch, not 2,000 round trips
  const saved: ImportPlanRow[] = [];
  for (let i = 0; i < entities.length; i += 500) saved.push(...(await repo.save(entities.slice(i, i + 500))));
  return saved.sort((a, b) => a.position - b.position);
};

export const appendRows = async (user: TokenUser, planId: string, body: { version: number; rows: ImportRow[] }, totalLike: Set<string>) => {
  const plan = await AppDataSource.transaction(async (m) => {
    const plan = await lockPlan(m, user, planId);
    assertDraft(plan, body.version);
    const ctx = await contextForPlan(user, plan);
    const existing = await loadRows(m, plan.plan_id);
    assertRowLimits(body.rows.length, existing.length);
    assertRowRefsUnique(body.rows, new Set(existing.map((r) => r.row_ref)));
    const added = await insertPlanRows(m, plan.plan_id, body.rows, existing.length ? existing[existing.length - 1].position + 1 : 0);
    const previousTotalLike = new Set(existing.filter((r) => (r.issues as RowIssue[]).some((i) => i.code === "CLIENT_TOTAL_IGNORED")).map((r) => r.row_ref));
    await replan(m, ctx, plan, [...existing, ...added], new Set([...previousTotalLike, ...totalLike]));
    return plan;
  });
  return withFirstRows(plan);
};

const lockPlan = (m: EntityManager, user: TokenUser, planId: string) => loadVisiblePlan(user, planId, m, true);

export const getPlan = async (user: TokenUser, planId: string, rawQuery: Query): Promise<PlanWithRows> => {
  const parsed = GetPlanQuerySchema.safeParse(rawQuery);
  if (!parsed.success) throw new ImportError("IMPORT_VALIDATION", parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })));
  const query = parsed.data;
  const plan = await loadVisiblePlan(user, planId);
  const page = query.page ?? 1;
  const pageSize = query.page_size ?? IMPORT_LIMITS.DEFAULT_PAGE_SIZE;
  const qb = rowRepo().createQueryBuilder("r").where("r.plan_id = :id", { id: plan.plan_id });
  if (query.state) qb.andWhere("r.state = :state", { state: query.state });
  if (query.code) qb.andWhere(`r.issues @> :code::jsonb`, { code: JSON.stringify([{ code: query.code }]) });
  const total = await qb.getCount();
  const rows = await qb
    .orderBy("CASE WHEN r.state = 'issue' THEN 0 ELSE 1 END", "ASC")
    .addOrderBy("r.position", "ASC")
    .skip((page - 1) * pageSize)
    .take(pageSize)
    .getMany();
  return { ...planView(plan), rows: rows.map(toPlanned), page, page_size: pageSize, total_rows: total };
};

/** row_refs of raw patch changes whose `set` carried a total-like key. */
export const findTotalLikeChanges = (rawChanges: unknown): Set<string> => {
  const refs = new Set<string>();
  if (!Array.isArray(rawChanges)) return refs;
  for (const c of rawChanges) {
    const set = c && typeof c === "object" ? (c as any).set : undefined;
    if (set && typeof set === "object" && (TOTAL_LIKE_KEYS as readonly string[]).some((k) => k in set) && typeof (c as any).row_ref === "string") {
      refs.add((c as any).row_ref);
    }
  }
  return refs;
};

export const patchPlan = async (
  user: TokenUser,
  planId: string,
  body: { version: number; changes?: { row_ref: string; set?: Partial<ImportRow>; skip?: boolean }[]; activity_matches?: ActivityMatch[] },
  totalLikeChanges: Set<string> = new Set(),
) => {
  const plan = await AppDataSource.transaction(async (m) => {
    const plan = await lockPlan(m, user, planId);
    assertDraft(plan, body.version);
    const ctx = await contextForPlan(user, plan);
    const rows = await loadRows(m, plan.plan_id);
    const byRef = new Map(rows.map((r) => [r.row_ref, r]));
    const unknown = (body.changes || []).filter((c) => !byRef.has(c.row_ref)).map((c) => c.row_ref);
    if (unknown.length) throw new ImportError("IMPORT_PLAN_NOT_FOUND", { row_refs: unknown.slice(0, 20) });
    for (const c of body.changes || []) {
      const r = byRef.get(c.row_ref)!;
      if (c.set) {
        // The merged row must still be a valid ImportRow (the value-or-fields rule included).
        const merged = ImportRowSchema.safeParse({ ...(r.input as ImportRow), ...c.set, row_ref: r.row_ref });
        if (!merged.success) {
          throw new ImportError("IMPORT_VALIDATION", merged.error.issues.slice(0, 20).map((i) => ({ path: [c.row_ref, ...i.path].join("."), message: i.message })));
        }
        r.input = merged.data;
      }
      if (c.skip === true) r.state = "skipped";
      if (c.skip === false && r.state === "skipped") r.state = "issue";
      if (r.state === "skipped") {
        r.issues = [];
        r.result = null;
      }
      await m.getRepository(ImportPlanRow).update({ id: r.id }, { input: r.input, state: r.state, issues: r.issues, result: r.result });
    }
    for (const match of body.activity_matches || []) {
      await m
        .createQueryBuilder()
        .insert()
        .into(ImportPlanMatch)
        .values({ plan_id: plan.plan_id, site_id: match.site_id, category_id: match.category_id, sheet_name: match.sheet_name, factor_name: match.factor_name })
        .orUpdate(["factor_name"], ["plan_id", "site_id", "category_id", "sheet_name"])
        .execute();
      if (match.save_mapping) await saveMapping(m, ctx, plan, match);
    }
    const totalLike = new Set([
      ...rows.filter((r) => (r.issues as RowIssue[]).some((i) => i.code === "CLIENT_TOTAL_IGNORED")).map((r) => r.row_ref),
      ...totalLikeChanges,
    ]);
    await replan(m, ctx, plan, rows, totalLike);
    return plan;
  });
  return withFirstRows(plan);
};

/**
 * `save_mapping` (decision D5): a Superadmin or the client's Admin may turn a
 * plan match into a P23 category mapping, so the sheet wording resolves on
 * every later import of that site × category. Other roles keep the match on
 * the plan only. The mapping is by name (no pinned factor id), so the year
 * fallback of the engine still applies. The site and category must be in the
 * caller's scope.
 *
 * Only new mappings are written: where the company already has a mapping for
 * that site, category and sheet wording (made here or in the app, pinned or
 * not), the request is refused with IMPORT_VALIDATION / MAPPING_EXISTS and
 * nothing changes, as the app's mapping endpoint refuses a duplicate. The
 * plan match itself still applies to this plan. Changing an existing mapping
 * is the Category mappings page's job. Every mapping written here gets an
 * audit_log row (entity_type "category_mapping").
 */
const saveMapping = async (m: EntityManager, ctx: WriterContext, plan: ImportPlan, match: ActivityMatch) => {
  if (ctx.role !== UserRole.SUPERADMIN && ctx.role !== UserRole.ADMIN) return;
  if (!ctx.allowed_site_ids.includes(match.site_id) || !(ctx.allowed_category_ids_by_site[match.site_id] ?? []).includes(match.category_id)) {
    throw new ImportError("IMPORT_FORBIDDEN", { site_id: match.site_id, category_id: match.category_id });
  }
  const repo = m.getRepository(EmissionCategoryMapping);
  const existing = await repo.findOne({ where: { company_id: ctx.company_id, site_id: match.site_id, category_id: match.category_id, company_category_name: match.sheet_name } });
  if (existing) {
    throw new ImportError(
      "IMPORT_VALIDATION",
      { reason: "MAPPING_EXISTS", site_id: match.site_id, category_id: match.category_id, sheet_name: match.sheet_name, maps_to: existing.global_category_name },
      "A category mapping for this sheet wording already exists for that site and category. Change it on the Category mappings page, or send the match without save_mapping.",
    );
  }
  const company: { name: string }[] = await m.query(`SELECT name FROM company WHERE company_id = $1`, [ctx.company_id]);
  const saved = await repo.save(
    repo.create({
      company_id: ctx.company_id,
      company_name: company[0]?.name ?? "",
      site_id: match.site_id,
      category_id: match.category_id,
      company_category_name: match.sheet_name,
      global_category_name: match.factor_name,
      emission_factor_id: null,
      created_by: ctx.user_id,
    }),
  );
  const auditRepo = m.getRepository(AuditLog);
  await auditRepo.save(
    auditRepo.create({
      entity_type: "category_mapping",
      entity_id: saved.id,
      action: "create",
      changed_fields: { global_category_name: { old: null, new: match.factor_name }, site_id: { old: null, new: match.site_id }, category_id: { old: null, new: match.category_id } },
      reason: `Saved from import plan ${plan.plan_id} (${plan.channel})`,
      changed_by: { user_id: ctx.user_id } as any,
    }),
  );
};

export const cancelPlan = async (user: TokenUser, planId: string) => {
  const plan = await AppDataSource.transaction(async (m) => {
    const plan = await lockPlan(m, user, planId);
    if (plan.status === "expired") throw new ImportError("IMPORT_PLAN_EXPIRED");
    if (plan.status !== "draft") throw new ImportError("IMPORT_PLAN_NOT_DRAFT", { status: plan.status });
    plan.status = "cancelled";
    plan.version += 1;
    await m.getRepository(ImportPlan).update({ plan_id: plan.plan_id }, { status: "cancelled", version: plan.version });
    return plan;
  });
  return planView((await planRepo().findOne({ where: { plan_id: plan.plan_id } })) || plan);
};

/**
 * Commit: one transaction that locks the plan, re-checks every ready row
 * against today's data, serialises with other imports for the same site and
 * category, inserts the rows through the writer and marks the plan committed.
 * A repeat with the same idempotency key returns the stored result and adds
 * nothing. The onBatchCommitted event fires only after the commit succeeded.
 */
export const commitPlan = async (user: TokenUser, planId: string, body: { version: number; skip_rows_with_issues: boolean; idempotency_key: string }) => {
  const writer = getEmissionWriter();
  let event: Parameters<typeof emitBatchCommitted>[0] | null = null;
  // Set when the re-check finds new issues: the row updates must be kept, so
  // the transaction commits and the 409 is thrown afterwards.
  let recheckFailure: ImportError | null = null;
  const plan = await AppDataSource.transaction(async (m) => {
    const plan = await lockPlan(m, user, planId);
    if (plan.status === "committed" && plan.idempotency_key === body.idempotency_key) return plan;
    const other = await m.getRepository(ImportPlan).findOne({ where: { idempotency_key: body.idempotency_key } });
    if (other && other.plan_id !== plan.plan_id) throw new ImportError("IMPORT_PLAN_VERSION_CONFLICT", { idempotency_key: "already used by another plan" });
    assertDraft(plan, body.version);
    const ctx = await contextForPlan(user, plan);
    const rows = await loadRows(m, plan.plan_id);
    const issueRows = rows.filter((r) => r.state === "issue");
    if (issueRows.length && !body.skip_rows_with_issues) {
      throw new ImportError("IMPORT_PLAN_HAS_ISSUES", { issue_rows: issueRows.length, row_refs: issueRows.slice(0, 20).map((r) => r.row_ref) });
    }
    const ready = rows.filter((r) => r.state === "ready");
    if (!ready.length) {
      throw new ImportError("IMPORT_VALIDATION", { ready: 0, skipped: rows.filter((r) => r.state === "skipped").length }, "The plan has no ready rows to commit.");
    }
    const matches = await loadMatches(m, plan.plan_id);

    // Serialise with every other import for the same site and category (same
    // lock pair as the AI importer), in a fixed order so two commits can't deadlock.
    const pairs = [...new Set(ready.map((r) => `${(r.input as ImportRow).site_id}:${(r.input as ImportRow).category_id}`))].sort();
    for (const pair of pairs) {
      const [site, cat] = pair.split(":").map(Number);
      await m.query(`SELECT pg_advisory_xact_lock($1, $2)`, [site, cat]);
    }

    // Re-check: data may have changed since planning (a duplicate typed meanwhile).
    const rechecked = await writer.planRows(ctx, ready.map((r) => r.input as ImportRow), { planMatches: matches });
    const newIssues = rechecked.filter((p) => p.state !== "ready");
    if (newIssues.length) {
      const byRef = new Map(rechecked.map((p) => [p.row_ref, p]));
      for (const r of ready) {
        const p = byRef.get(r.row_ref);
        if (!p) continue;
        r.state = p.state;
        r.issues = p.issues;
        r.result = (p.result as Record<string, unknown>) ?? null;
        await m.getRepository(ImportPlanRow).update({ id: r.id }, { state: r.state, issues: r.issues, result: r.result });
      }
      await refreshSummary(m, plan, rows);
      recheckFailure = new ImportError("IMPORT_PLAN_VERSION_CONFLICT", {
        current_version: plan.version,
        reason: "rows changed on re-check",
        rows: newIssues.map((p) => ({ row_ref: p.row_ref, issues: p.issues })),
      });
      return plan;
    }

    const upload_batch_id = randomUUID();
    const inserted = await writer.insertRows(m, ctx, rechecked, { upload_batch_id, channel: plan.channel, source_name: plan.source_name });
    const committed_at = new Date().toISOString();
    plan.status = "committed";
    plan.upload_batch_id = upload_batch_id;
    plan.idempotency_key = body.idempotency_key;
    plan.committed = { upload_batch_id, inserted: inserted.inserted, fera_inserted: inserted.fera_inserted, committed_at };
    plan.version += 1;
    await m.getRepository(ImportPlan).update(
      { plan_id: plan.plan_id },
      { status: "committed", upload_batch_id, idempotency_key: body.idempotency_key, committed: plan.committed, version: plan.version },
    );
    const tco2e = rechecked.reduce((s, p) => s + Number(p.result?.total_tco2e ?? 0) + Number(p.result?.fera?.total_tco2e ?? 0), 0);
    event = {
      upload_batch_id,
      company_id: plan.company_id,
      created_by: plan.created_by ?? ctx.user_id, // creator deleted: the committing Superadmin
      channel: plan.channel,
      source_name: plan.source_name,
      site_ids: [...new Set(rechecked.map((p) => p.input.site_id))],
      rows: inserted.inserted,
      tco2e: Math.round(tco2e * 1e6) / 1e6,
      months: [...new Set(rechecked.map((p) => String(p.result?.reporting_date ?? "").slice(0, 7)))].sort(),
    };
    return plan;
  });
  if (recheckFailure) throw recheckFailure;
  if (event) await emitBatchCommitted(event);
  return planView((await planRepo().findOne({ where: { plan_id: plan.plan_id } })) || plan);
};

// ---------- batches ----------

/**
 * Upload batches the caller may see: for a Superadmin the named client's,
 * for everyone else those on their sites. Batches made by a plan carry its
 * channel and source; older batches (AI importer, historical import) show as
 * `bulk_upload`.
 */
export const listBatches = async (user: TokenUser, rawQuery: Query): Promise<UploadBatchSummary[]> => {
  const parsed = ListBatchesQuerySchema.safeParse(rawQuery);
  if (!parsed.success) throw new ImportError("IMPORT_VALIDATION", parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })));
  const query = parsed.data;
  const ctx = await buildWriterContext(user, query.company_id);
  if (!ctx.allowed_site_ids.length) return [];
  const page = query.page ?? 1;
  const params: unknown[] = [ctx.allowed_site_ids];
  const where: string[] = [];
  if (query.channel) {
    params.push(query.channel);
    where.push(`COALESCE(p.channel, 'bulk_upload') = $${params.length}`);
  }
  // pending: any row still pending; approved / rejected: every row is; mixed: anything else.
  const pending = "SUM(CASE WHEN e.status = 'pending' THEN 1 ELSE 0 END)";
  const approved = "SUM(CASE WHEN e.status = 'approved' THEN 1 ELSE 0 END)";
  const rejected = "SUM(CASE WHEN e.status = 'rejected' THEN 1 ELSE 0 END)";
  const having: string[] = [];
  if (query.status === "pending") having.push(`${pending} > 0`);
  if (query.status === "approved") having.push(`${approved} = COUNT(*)`);
  if (query.status === "rejected") having.push(`${rejected} = COUNT(*)`);
  if (query.status === "mixed") having.push(`${pending} = 0 AND ${approved} < COUNT(*) AND ${rejected} < COUNT(*)`);
  params.push(BATCH_PAGE, (page - 1) * BATCH_PAGE);
  const rows: any[] = await AppDataSource.query(
    `SELECT b.*, p.channel AS plan_channel, p.source_name, p.plan_id, u.name AS created_by_name
       FROM (
         SELECT e.upload_batch_id, COUNT(*)::int AS rows, MIN(e.created_at) AS created_at, MIN(e.created_by) AS created_by,
                SUM(CASE WHEN e.status = 'pending' THEN 1 ELSE 0 END)::int AS pending,
                SUM(CASE WHEN e.status = 'approved' THEN 1 ELSE 0 END)::int AS approved,
                SUM(CASE WHEN e.status = 'rejected' THEN 1 ELSE 0 END)::int AS rejected,
                COALESCE(SUM(e.total_emission), 0)::float AS tco2e,
                ARRAY_AGG(DISTINCT e.site_id) AS site_ids
           FROM emission e
          WHERE e.upload_batch_id IS NOT NULL AND e.site_id = ANY($1::int[])
          GROUP BY e.upload_batch_id
          ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
       ) b
       LEFT JOIN import_plan p ON p.upload_batch_id = b.upload_batch_id
       LEFT JOIN "user" u ON u.user_id = b.created_by
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY b.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    upload_batch_id: r.upload_batch_id,
    channel: (r.plan_channel || "bulk_upload") as ImportChannel,
    source_name: r.source_name || null,
    plan_id: r.plan_id || null,
    created_by: { user_id: r.created_by === null ? null : Number(r.created_by), name: r.created_by_name || null },
    created_at: new Date(r.created_at).toISOString(),
    site_ids: (r.site_ids || []).map(Number),
    rows: Number(r.rows),
    pending: Number(r.pending),
    approved: Number(r.approved),
    rejected: Number(r.rejected),
    tco2e: Math.round(Number(r.tco2e) * 1e6) / 1e6,
  }));
};
