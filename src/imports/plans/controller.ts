import { Response } from "express";
import { ZodSchema } from "zod";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { AppendRowsBodySchema, CommitPlanBodySchema, CreatePlanBodySchema, PatchPlanBodySchema } from "../contracts";
import { importError, isImportError } from "../errors";
import { IMPORT_LIMITS } from "../limits";
import * as plans from "./service";

/**
 * HTTP layer of the plans API: parse with the IM0 zod schemas, call the
 * service, map ImportError to the contract's error body. Nothing else:
 * no stack, SQL or other client's names ever reach a response (plan §7.6).
 */

const fail = (res: Response, err: unknown) => {
  if (isImportError(err)) return res.status(err.status).json(err.toBody());
  console.error("Import plans error:", err);
  return res.status(500).json({ code: "INTERNAL", message: "Internal server error" });
};

const parse = <T>(schema: ZodSchema<T>, body: unknown, res: Response): T | null => {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  importError(res, "IMPORT_VALIDATION", r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })));
  return null;
};

const user = (req: AuthRequest) => ({ userId: Number(req.user?.userId), role: String(req.user?.role) });

export const createPlan = async (req: AuthRequest, res: Response) => {
  // Rows beyond the per-request limit are refused before validation so the
  // reply is the documented 413, not a 400 from the array's max().
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length > IMPORT_LIMITS.ROWS_PER_REQUEST) return importError(res, "IMPORT_TOO_MANY_ROWS", { max_per_request: IMPORT_LIMITS.ROWS_PER_REQUEST, sent: rows.length });
  const body = parse(CreatePlanBodySchema, req.body, res);
  if (!body) return;
  try {
    return res.status(201).json(await plans.createPlan(user(req), body, plans.findTotalLikeRows(rows)));
  } catch (err) {
    return fail(res, err);
  }
};

export const appendRows = async (req: AuthRequest, res: Response) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length > IMPORT_LIMITS.ROWS_PER_REQUEST) return importError(res, "IMPORT_TOO_MANY_ROWS", { max_per_request: IMPORT_LIMITS.ROWS_PER_REQUEST, sent: rows.length });
  const body = parse(AppendRowsBodySchema, req.body, res);
  if (!body) return;
  try {
    return res.json(await plans.appendRows(user(req), String(req.params.id), body, plans.findTotalLikeRows(rows)));
  } catch (err) {
    return fail(res, err);
  }
};

export const getPlan = async (req: AuthRequest, res: Response) => {
  try {
    return res.json(await plans.getPlan(user(req), String(req.params.id), req.query as Record<string, unknown>));
  } catch (err) {
    return fail(res, err);
  }
};

export const patchPlan = async (req: AuthRequest, res: Response) => {
  const body = parse(PatchPlanBodySchema, req.body, res);
  if (!body) return;
  try {
    return res.json(await plans.patchPlan(user(req), String(req.params.id), body, plans.findTotalLikeChanges(req.body?.changes)));
  } catch (err) {
    return fail(res, err);
  }
};

export const commitPlan = async (req: AuthRequest, res: Response) => {
  const body = parse(CommitPlanBodySchema, req.body, res);
  if (!body) return;
  try {
    return res.json(await plans.commitPlan(user(req), String(req.params.id), body));
  } catch (err) {
    return fail(res, err);
  }
};

export const cancelPlan = async (req: AuthRequest, res: Response) => {
  try {
    return res.json(await plans.cancelPlan(user(req), String(req.params.id)));
  } catch (err) {
    return fail(res, err);
  }
};

export const listBatches = async (req: AuthRequest, res: Response) => {
  try {
    return res.json(await plans.listBatches(user(req), req.query as Record<string, unknown>));
  } catch (err) {
    return fail(res, err);
  }
};
