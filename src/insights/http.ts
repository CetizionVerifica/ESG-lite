/**
 * Shared route plumbing for src/insights (IN-0), in the src/kpi/http.ts and
 * src/studio/http.ts shape: a handler wrapper that maps InError to
 * `{code, message, details?}` (anything else → 500 with ids only in the log),
 * zod parsing that throws IN_VALIDATION (or the code a route names), and route
 * ids that answer 404 when they can't exist.
 */
import type { Response } from "express";
import type { ZodType } from "zod";
import type { AuthRequest } from "../middlewares/auth.middleware";
import { InError, issueList, type InErrorCode } from "./contracts/errors";

export type InHandler = (req: AuthRequest, res: Response) => Promise<unknown>;

export const handle = (name: string, fn: InHandler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof InError) return res.status(err.status).json(err.toBody());
    console.error(`[insights] ${name} failed (user ${req.user?.userId}):`, (err as Error)?.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Parses `input`; on failure throws `code` (default IN_VALIDATION) with the zod issues. */
export const parse = <T>(schema: ZodType<T>, input: unknown, code: InErrorCode = "IN_VALIDATION"): T => {
  const result = schema.safeParse(input);
  if (!result.success) throw new InError(code, { issues: issueList(result.error.issues) });
  return result.data;
};

/** A positive integer route parameter, else `code` (an id that can't exist). */
export const routeId = (value: unknown, code: InErrorCode = "IN_EVENT_NOT_FOUND"): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new InError(code);
  return n;
};
