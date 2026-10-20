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

// ---------------------------------------------------------------------------
// DS-9: request and response shapes of the AI endpoints (01-contracts §4).
// ---------------------------------------------------------------------------

/** What an action is about: a page, or one element on it. */
export const AiTargetSchema = z.object({ pageId: z.string().min(1).max(120), elementId: z.string().min(1).max(120).optional() }).strict();
export type AiTarget = z.infer<typeof AiTargetSchema>;

export const AiParamsSchema = z
  .object({
    /** scope3_category_text: the category (1–15). */
    category: z.number().int().min(1).max(15).optional(),
    /** Try again: the earlier suggestion's text, so the next one differs. */
    differentFrom: z.string().max(8000).optional(),
    /** A short instruction typed in the chat ("mention the new boiler"). Untrusted. */
    note: z.string().max(1000).optional(),
  })
  .strict();
export type AiParams = z.infer<typeof AiParamsSchema>;

/** POST /docs/:id/ai */
export const AiRequestSchema = z.object({ action: AiActionSchema, target: AiTargetSchema.optional(), params: AiParamsSchema.optional() }).strict();
export type AiRequest = z.infer<typeof AiRequestSchema>;

/** The chat sends at most this many turns; the router reads the last 12. */
export const CHAT_MAX_TURNS = 40;
export const CHAT_ROUTER_TURNS = 12;
export const CHAT_MAX_ACTIONS = 3;

/** POST /docs/:id/ai/chat */
export const ChatRequestSchema = z
  .object({
    messages: z.array(ChatTurnSchema).min(1).max(CHAT_MAX_TURNS),
    selection: z.object({ pageId: z.string().min(1).max(120), elementIds: z.array(z.string().min(1).max(120)).max(50) }).strict().optional(),
  })
  .strict();
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export interface ChatReply {
  reply: string;
  suggestions: Suggestion[];
}

/** GET /docs/:id/ai/usage: the budget meter (D10). */
export interface AiUsage {
  todayUsd: number;
  budgetUsd: number;
  calls: number;
  callBudget: number;
  monthUsd: number;
  monthBudgetUsd: number;
}

/** POST /ai/brief (design from a brief, from the studio home or the AI panel). */
export const BriefRequestSchema = z.object({ kind: z.enum(["ghg", "sustainability"]), brief: z.string().trim().min(3).max(1000) }).strict();
export type BriefRequest = z.infer<typeof BriefRequestSchema>;

export interface BriefProposal {
  templateId: number;
  /** The template's look (Classic, Light, Night) or null for a company template. */
  look: string | null;
  templateName: string;
  format: string;
  purpose: string;
  chapters: string[];
  styleId: string | null;
  title: string;
  reason: string;
}
export interface BriefReply {
  proposals: BriefProposal[];
  model: string;
}
