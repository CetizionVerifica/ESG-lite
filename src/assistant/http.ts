/**
 * AS-1 · error codes and route plumbing for the help assistant, in the
 * src/insights/http.ts shape: API errors are `{code, message, details?}` with
 * the status below; anything else is a 500 with ids only in the log.
 */
import type { Response } from "express";
import type { ZodType } from "zod";
import type { AuthRequest } from "../middlewares/auth.middleware";

export const AS_ERRORS = {
  AS_OFF: { status: 403, message: "The help assistant isn't turned on for your company." },
  AS_VALIDATION: { status: 400, message: "The request isn't valid." },
  AS_BUDGET: { status: 429, message: "The help assistant has answered as many questions as it can for now. Try again later." },
  AS_AI_UNAVAILABLE: { status: 503, message: "The help assistant can't answer right now. Try again in a moment." },
} as const;

export type AsErrorCode = keyof typeof AS_ERRORS;

export class AsError extends Error {
  constructor(
    readonly code: AsErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(AS_ERRORS[code].message);
  }
  get status(): number {
    return AS_ERRORS[this.code].status;
  }
  toBody() {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export type AsHandler = (req: AuthRequest, res: Response) => Promise<unknown>;

export const handle = (name: string, fn: AsHandler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof AsError) return res.status(err.status).json(err.toBody());
    console.error(`[assistant] ${name} failed (user ${req.user?.userId}):`, (err as Error)?.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Parses `input`; on failure throws AS_VALIDATION with the zod issues. */
export const parse = <T>(schema: ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AsError("AS_VALIDATION", { issues: result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });
  }
  return result.data;
};
