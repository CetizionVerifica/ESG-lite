/**
 * S3-3 · What a caller may say about how a row was calculated and how good its
 * data is, on every channel: typed entries, bulk upload, smart import and MCP.
 *
 * One shape for all of them, so a row means the same thing wherever it comes
 * from. The pieces come from the S3-0 contracts; nothing here restates the
 * method list or the 1-3 scale.
 *
 * A caller never sends `overall` or `source`: the overall score is derived
 * (`overallOf`) and the source is `manual` by definition of having been sent.
 */
import { z } from "zod";
import { DqScoreSchema, overallOf, type Dq } from "../contracts/dq";
import { MethodSchema, type Method } from "../contracts/ghgCategory";

/** The five indicators, as a caller gives them. */
export const ManualDqSchema = z
  .object({
    technology: DqScoreSchema,
    geography: DqScoreSchema,
    time: DqScoreSchema,
    completeness: DqScoreSchema,
    reliability: DqScoreSchema,
  })
  .strip();
export type ManualDqInput = z.infer<typeof ManualDqSchema>;

/** The S3-3 fields on a row, all optional. */
export const RowQualitySchema = z
  .object({
    method: MethodSchema.optional(),
    is_estimate: z.boolean().optional(),
    dq: ManualDqSchema.optional(),
  })
  .strip();
export type RowQualityInput = z.infer<typeof RowQualitySchema>;

/** A sent data quality as the engine stores it: overall derived, source manual. */
export const manualDqFrom = (input: ManualDqInput): Dq => ({ ...input, overall: overallOf(input), source: "manual" });

/**
 * Whether a form allows this method. A form that offers none allows any — the
 * category's own method list is the only limit, and S3-1 owns that check.
 * Called by the engine, so every channel refuses the same methods.
 */
export const methodAllowedForForm = (method: Method | null | undefined, offered?: readonly Method[] | null): boolean =>
  !method || !offered || offered.length === 0 || offered.includes(method);

export type RowQualityParse = { ok: true; value: RowQualityInput } | { ok: false; field: string; message: string };

/**
 * Reads the S3-3 fields off a request body, ignoring anything else on it.
 * A method or a score that is not valid is refused and named, never dropped:
 * silently ignoring a method the caller meant would store the row as something
 * else entirely.
 */
export const parseRowQuality = (body: unknown): RowQualityParse => {
  const parsed = RowQualitySchema.safeParse(body ?? {});
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".") || "method";
  return {
    ok: false,
    field,
    message:
      field === "method"
        ? "This calculation method isn't one ESGLite knows."
        : `Data quality ${field.replace("dq.", "")} must be 1, 2 or 3.`,
  };
};
