/**
 * Shared route plumbing for src/studio (DS-0), in the src/kpi/http.ts shape:
 * a handler wrapper that maps DsError to `{code, message, details?}` (anything
 * else → 500 with ids only in the log), zod parsing that throws DS_VALIDATION,
 * and route ids that answer 404 when they can't exist.
 */
import type { Response } from "express";
import type { ZodType } from "zod";
import type { AuthRequest } from "../middlewares/auth.middleware";
import { DsError, dsValidationError } from "./contracts/errors";

export type DsHandler = (req: AuthRequest, res: Response) => Promise<unknown>;

export const handle = (name: string, fn: DsHandler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof DsError) return res.status(err.status).json(err.toBody());
    console.error(`[studio] ${name} failed (user ${req.user?.userId}):`, (err as Error)?.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const parse = <T>(schema: ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) throw dsValidationError(result.error.issues);
  return result.data;
};

/** A positive integer route parameter, else 404 (an id that can't exist). */
export const routeId = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new DsError("DS_DOC_NOT_FOUND");
  return n;
};
