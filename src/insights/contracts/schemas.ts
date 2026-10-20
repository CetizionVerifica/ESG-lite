/**
 * Insights contracts (IN-0) §2 and §4: zod schemas for queries and bodies,
 * docs/insights/01-contracts.md.
 *
 *   InsightsQuerySchema   every panel: ?year=&yearType=&sites=all|1,2&pillar=&compare=prior|base
 *                         (+ company_id, required for a Superadmin and ignored for others;
 *                         the guard reads it). `sites` parses to 'all' or a sorted, de-duplicated
 *                         id list; whether those ids are the caller's is IN-1's scope.ts
 *                         (404 IN_SITE_NOT_FOUND), not the schema's.
 *   Decoupling/Cards/Events/Stripes queries add their own extras.
 *   EventCreate/EventPatch bodies (IN-4) and MaterialityScoresBody (IN-7, shared with RS-2/DS-2).
 */
import { z } from "zod";
import { CompareSchema, DECOUPLING_YEARS_DEFAULT, DECOUPLING_YEARS_MAX, EVENT_LABEL_MAX, EventKindSchema, PillarSchema, YearTypeSchema } from "./enums";
import type { SiteFilter } from "./enums";

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);

export const IdSchema = z.coerce.number().int().positive();
export const YearSchema = z.coerce.number().int().min(1990).max(2100);

/** `sites`: absent, '' or 'all' → 'all'; '1,2' → [1, 2] (sorted, unique). Anything else is invalid. */
export const SitesParamSchema = z.preprocess(
  blank,
  z
    .union([z.literal("all"), z.string().regex(/^\d+(,\d+)*$/, "sites must be 'all' or a comma-separated list of site ids")])
    .optional()
    .transform((v): SiteFilter => {
      if (v === undefined || v === "all") return "all";
      const ids = [...new Set(v.split(",").map(Number))].sort((a, b) => a - b);
      return ids;
    })
    .refine((v) => v === "all" || v.every((n) => Number.isInteger(n) && n > 0), "site ids must be positive"),
);

/** The common panel query. `year` defaults to the current calendar year, `yearType` to CY. */
export const InsightsQuerySchema = z.object({
  year: z.preprocess(blank, YearSchema.optional()).transform((y) => y ?? new Date().getUTCFullYear()),
  yearType: z.preprocess(blank, YearTypeSchema.optional()).transform((t) => t ?? "CY"),
  sites: SitesParamSchema,
  pillar: z.preprocess(blank, PillarSchema.optional()),
  compare: z.preprocess(blank, CompareSchema.optional()).transform((c) => c ?? "prior"),
  company_id: z.preprocess(blank, IdSchema.optional()),
});
export type InsightsQuery = z.infer<typeof InsightsQuerySchema>;

/** GET /insights/decoupling: `?years=5` (default 5, max 10). */
export const DecouplingQuerySchema = InsightsQuerySchema.extend({
  years: z.preprocess(blank, z.coerce.number().int().min(2).max(DECOUPLING_YEARS_MAX).optional()).transform((n) => n ?? DECOUPLING_YEARS_DEFAULT),
});
export type DecouplingQuery = z.infer<typeof DecouplingQuerySchema>;

/** GET /insights/cards: `?ai=1` asks for IN-9 wording. */
export const CardsQuerySchema = InsightsQuerySchema.extend({
  ai: z.preprocess(blank, z.enum(["0", "1"]).optional()).transform((v) => v === "1"),
});
export type CardsQuery = z.infer<typeof CardsQuerySchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dates are YYYY-MM-DD").refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "not a real date");

/** GET /insights/events: `?from=&to=` (inclusive dates). */
export const EventsQuerySchema = InsightsQuerySchema.extend({
  from: z.preprocess(blank, isoDate.optional()),
  to: z.preprocess(blank, isoDate.optional()),
}).refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be on or before to", path: ["from"] });

/** POST /insights/events (IN-4). Errors → 400 IN_EVENT_INVALID. */
export const EventCreateSchema = z.object({
  date: isoDate,
  label: z.string().trim().min(1, "label is required").max(EVENT_LABEL_MAX, `label is at most ${EVENT_LABEL_MAX} characters`),
  kind: EventKindSchema,
  site_id: IdSchema.nullable().optional(),
  company_id: IdSchema.optional(),
});
export type EventCreate = z.infer<typeof EventCreateSchema>;

/** PATCH /insights/events/:id (IN-4): any of the create fields, at least one. */
export const EventPatchSchema = EventCreateSchema.omit({ company_id: true })
  .partial()
  .extend({ company_id: IdSchema.optional() })
  .refine((b) => b.date !== undefined || b.label !== undefined || b.kind !== undefined || b.site_id !== undefined, { message: "nothing to change" });
export type EventPatch = z.infer<typeof EventPatchSchema>;

const score = z.number().min(0).max(10).refine((n) => Math.round(n * 10) === n * 10, "scores have one decimal place").nullable();

/**
 * PUT materiality scores (IN-7, shared with RS-2/DS-2 by I10):
 * `{topics:[{esrs_topic, impact_score, financial_score}]}`, scores 0–10 or null.
 * Errors → 400 IN_SCORES_INVALID. DS-2 already ships the columns
 * (migrate:ds-2-materiality-scores) and PUT /studio/materiality; IN-7 reuses them.
 */
export const MaterialityScoresBodySchema = z.object({
  topics: z
    .array(z.object({ esrs_topic: z.string().trim().min(1).max(40), impact_score: score, financial_score: score }))
    .min(1)
    .max(50),
  company_id: IdSchema.optional(),
});
export type MaterialityScoresBody = z.infer<typeof MaterialityScoresBodySchema>;
