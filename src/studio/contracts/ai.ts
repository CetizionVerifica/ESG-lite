/**
 * Design Studio contracts (DS-0) §8: AI actions, suggestions and chat turns
 * (rs-base/01-contracts §8 plus the DS actions). DS-9 implements them; the
 * guard order is unchanged (zod → literal-number guard → binding check →
 * one retry → DS_AI_OUTPUT_INVALID).
 */
import { z } from "zod";
import { FreeformPageSchema, ElementSchema, TextDocSchema } from "./schema";
import { CheckSeveritySchema } from "./enums";
import { GhgMetricSchema, KpiRefSchema, ReportInputKeySchema } from "./sources";

export const RS_AI_ACTIONS = [
  "draft_report",
  "draft_page",
  "headline",
  "body",
  "leadership_draft",
  "about_report",
  "rewrite_shorter",
  "rewrite_longer",
  "rewrite_formal",
  "rewrite_plain",
  "explain_change",
  "add_target_context",
  "chart_title",
  "chart_kind",
  "suggest_layouts",
  "fill_page",
  "alt_text",
  "cover_art",
  "honesty_check",
  "jargon_check",
  "missing_disclosures",
] as const;

export const DS_AI_ACTIONS = [
  "design_from_brief",
  "suggest_style",
  "ghg_exec_summary",
  "ghg_methodology_text",
  "scope3_category_text",
  "exclusion_reason_draft",
  "summarise_for_deck",
  "summarise_for_social",
  "apply_brand_voice",
] as const;

export const AI_ACTIONS = [...RS_AI_ACTIONS, ...DS_AI_ACTIONS] as const;
export const AiActionSchema = z.enum(AI_ACTIONS);
export type AiAction = z.infer<typeof AiActionSchema>;

export const SUGGESTION_KINDS = ["text", "elements", "pages", "findings", "image"] as const;

/**
 * Every value a suggestion's tokens bind to, listed for the reviewer. RS had
 * `{kpi, year}`; bindings now name their source, so each entry does too.
 */
export const SuggestionSourceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("kpi"), kpi: KpiRefSchema, year: z.number().int() }).strict(),
  z.object({ source: z.literal("ghg"), metric: GhgMetricSchema, year: z.number().int(), scope3Category: z.number().int().min(1).max(15).optional() }).strict(),
  z.object({ source: z.literal("input"), key: ReportInputKeySchema }).strict(),
]);

export const SuggestionSchema = z
  .object({
    id: z.string().min(1),
    action: AiActionSchema,
    model: z.string(),
    createdAt: z.string(),
    kind: z.enum(SUGGESTION_KINDS),
    payload: z
      .object({
        text: TextDocSchema.optional(),
        elements: z.array(ElementSchema).optional(),
        pages: z.array(FreeformPageSchema).optional(),
        findings: z
          .array(z.object({ message: z.string(), pageId: z.string().optional(), elementId: z.string().optional(), severity: CheckSeveritySchema }).strict())
          .optional(),
        assetId: z.string().optional(),
      })
      .strict(),
    sources: z.array(SuggestionSourceSchema),
  })
  .strict();
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const ChatTurnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    text: z.string().max(8000),
    suggestions: z.array(SuggestionSchema).optional(),
  })
  .strict();
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

/** D10: models and budgets (RS R7, R8). */
export const AI_MODELS = { drafting: "anthropic/claude-sonnet-5.5", rewrites: "google/gemini-3-flash-preview" } as const;
export const AI_BUDGET = { perDocPerDayUsd: 5, perDocPerDayCalls: 200, perCompanyPerMonthUsd: 50 } as const;
/** D11: an empty brand voice uses this. */
export const DEFAULT_BRAND_VOICE = "plain, factual, third person";
export const MAX_BRAND_VOICE_CHARS = 3000;
