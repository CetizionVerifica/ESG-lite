/**
 * Shared route plumbing for src/kpi: a handler wrapper that maps KpiError to
 * `{code, message, details?}` (anything else → 500 with ids only in the log),
 * and zod parsing that throws KPI_VALIDATION.
 */
import type { Response } from "express";
import type { ZodType } from "zod";
import type { AuthRequest } from "../middlewares/auth.middleware";
import { KpiError, kpiValidationError } from "./contracts/errors";

export type KpiHandler = (req: AuthRequest, res: Response) => Promise<unknown>;

export const handle = (name: string, fn: KpiHandler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof KpiError) return res.status(err.status).json(err.toBody());
    console.error(`[kpi] ${name} failed (user ${req.user?.userId}):`, (err as Error)?.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const parse = <T>(schema: ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) throw kpiValidationError(result.error.issues);
  return result.data;
};

/** A positive integer route parameter, else 404 (an id that can't exist). */
export const routeId = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new KpiError("KPI_NOT_FOUND");
  return n;
};
