/**
 * S3-15 part 2 HTTP handlers (docs/scope3/01-contracts.md §5):
 *
 *   GET  /periods/lock?year&month[&site_id][&company_id]   periodStatus
 *   POST /periods/lock    {site_id|null, year, month[, company_id]}
 *   POST /periods/unlock  {site_id|null, year, month, reason[, company_id]}
 *   POST /user/emissions/submit   {ids}
 *   POST /user/emissions/check    {ids}             dry run, saves nothing
 *   GET  /user/emissions/:id/history?months=6
 *   POST/DELETE /user/my-month/nothing  {site_id, category_id, month}
 *
 * Errors: `{code, message, details?}`; §7 codes from contracts/errors.ts,
 * access and validation as SCOPE3_* (lock.ts AccessError).
 */
import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware";
import { AppDataSource } from "../../config/data-source";
import { Scope3Error } from "../contracts/errors";
import {
  CheckEmissionsBodySchema,
  EmissionHistoryQuerySchema,
  LockPeriodBodySchema,
  NothingThisMonthBodySchema,
  PeriodLockQuerySchema,
  SubmitEmissionsBodySchema,
  UNLOCK_REASON_MIN,
} from "../contracts/schemas";
import { AccessError, lockPeriod, periodStatus, resolveLockScope, unlockPeriod, type Caller } from "./lock";
import { dryRunChecks, rowHistory, setNothingThisMonth, submitDrafts } from "./workflow";
import { UserRole } from "../../types/type";

type Handler = (req: AuthRequest, res: Response) => Promise<unknown>;

const handle = (name: string, fn: Handler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof Scope3Error || err instanceof AccessError) return res.status(err.status).json(err.toBody());
    console.error(`[scope3] ${name} failed (user ${req.user?.userId}):`, (err as Error)?.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const caller = (req: AuthRequest): Caller => ({ userId: Number(req.user?.userId) || 0, role: String(req.user?.role ?? "") });

const invalid = (issues: unknown) => new AccessError(400, "The request is not valid.", "SCOPE3_VALIDATION", issues);

const parse = <T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: unknown } } }, value: unknown): T => {
  const r = schema.safeParse(value);
  if (!r.success) throw invalid((r as { error: { issues: unknown } }).error.issues);
  return (r as { data: T }).data;
};

/** GET /periods/lock: what is left before the month can be closed, per site. */
export const getPeriodLock = handle("period status", async (req, res) => {
  const q = parse(PeriodLockQuerySchema, req.query);
  const scope = await resolveLockScope(caller(req), { site_id: q.site_id ?? null, company_id: q.company_id }, false);
  res.json(await periodStatus(AppDataSource.manager, scope, q.year, q.month));
});

/** POST /periods/lock: 422 PERIOD_INCOMPLETE while anything is left; 403 REVIEW_WORKFLOW_OFF with the switch off. */
export const postPeriodLock = handle("lock period", async (req, res) => {
  const body = parse(LockPeriodBodySchema, req.body ?? {});
  const scope = await resolveLockScope(caller(req), { site_id: body.site_id ?? null, company_id: body.company_id }, true);
  res.json(await lockPeriod(caller(req), scope, body.year, body.month));
});

/** POST /periods/unlock: a reason of at least UNLOCK_REASON_MIN characters (400 UNLOCK_REASON_REQUIRED). */
export const postPeriodUnlock = handle("unlock period", async (req, res) => {
  const raw = (req.body ?? {}) as Record<string, unknown>;
  const body = parse(LockPeriodBodySchema, raw);
  const scope = await resolveLockScope(caller(req), { site_id: body.site_id ?? null, company_id: body.company_id }, true);
  if (typeof raw.reason !== "string" || raw.reason.trim().length < UNLOCK_REASON_MIN || raw.reason.length > 2000) {
    throw new Scope3Error("UNLOCK_REASON_REQUIRED", { min_length: UNLOCK_REASON_MIN });
  }
  const companyWide = !body.site_id && (req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.SUPERADMIN);
  res.json(await unlockPeriod(caller(req), scope, body.year, body.month, raw.reason, companyWide));
});

/** POST /user/emissions/submit: `{submitted: ids, refused: [{id, code}]}`. */
export const postSubmit = handle("submit drafts", async (req, res) => {
  const body = parse(SubmitEmissionsBodySchema, req.body ?? {});
  res.json(await submitDrafts(caller(req), body.ids));
});

/** POST /user/emissions/check: `{results: [{id, status, checks: {ready, held}}]}`. */
export const postCheck = handle("dry-run checks", async (req, res) => {
  const body = parse(CheckEmissionsBodySchema, req.body ?? {});
  res.json(await dryRunChecks(caller(req), body.ids));
});

/** GET /user/emissions/:id/history?months=6. */
export const getHistory = handle("row history", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw invalid([{ path: ["id"], message: "Expected a positive integer" }]);
  const q = parse(EmissionHistoryQuerySchema, req.query);
  res.json(await rowHistory(caller(req), id, q.months));
});

const nothingBody = (req: AuthRequest) => {
  // DELETE may carry its fields in the query instead of a body.
  const src = req.body && Object.keys(req.body).length ? req.body : req.query;
  const raw = src as Record<string, unknown>;
  return parse(NothingThisMonthBodySchema, {
    site_id: raw.site_id === undefined ? undefined : Number(raw.site_id),
    category_id: raw.category_id === undefined ? undefined : Number(raw.category_id),
    month: raw.month,
  });
};

/** POST /user/my-month/nothing: `{site_id, category_id, month: "YYYY-MM-01", nothing: true}`. */
export const postNothing = handle("set nothing this month", async (req, res) => {
  res.json(await setNothingThisMonth(caller(req), nothingBody(req), true));
});

/** DELETE /user/my-month/nothing: `{…, nothing: false}`. */
export const deleteNothing = handle("clear nothing this month", async (req, res) => {
  res.json(await setNothingThisMonth(caller(req), nothingBody(req), false));
});
