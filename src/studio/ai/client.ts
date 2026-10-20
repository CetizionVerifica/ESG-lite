/**
 * DS-9 · the studio's model client (RS-8 `client.ts`): one completion through
 * src/lib/openrouter.ts in JSON mode, a 45 s limit, token usage and cost.
 *
 *   complete({group, system, user, maxTokens})  → {text, model, tokensIn, tokensOut, costUsd}
 *                                                 throws DS_AI_UNAVAILABLE (no key, provider down,
 *                                                 time limit, empty answer)
 *
 * Models per action group (D10, RS R7), overridable by env:
 *   drafting  STUDIO_AI_MODEL_DRAFTING  (anthropic/claude-sonnet-5.5)
 *   rewrites  STUDIO_AI_MODEL_REWRITES  (google/gemini-3-flash-preview)
 *   router    STUDIO_AI_MODEL_ROUTER    (the rewrites model: cheap)
 * Key and endpoint: STUDIO_AI_API_KEY, else OPENROUTER_API_KEY; STUDIO_AI_BASE_URL
 * (tests point it at a recorded stub; never a real model in CI).
 */
import { openRouterChat, openRouterKey } from "../../lib/openrouter";
import { AI_MODELS, DsError } from "../contracts";
import { costUsd } from "./prices";

export type ModelGroup = "drafting" | "rewrites" | "router";

export const modelFor = (group: ModelGroup): string => {
  if (group === "drafting") return process.env.STUDIO_AI_MODEL_DRAFTING || AI_MODELS.drafting;
  if (group === "rewrites") return process.env.STUDIO_AI_MODEL_REWRITES || AI_MODELS.rewrites;
  return process.env.STUDIO_AI_MODEL_ROUTER || process.env.STUDIO_AI_MODEL_REWRITES || AI_MODELS.rewrites;
};

export const aiKey = (): string | undefined => process.env.STUDIO_AI_API_KEY || openRouterKey();
export const aiConfigured = (): boolean => !!aiKey();

export interface CompleteInput {
  group: ModelGroup;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}
export interface Completion {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/** Why a call failed, for the log (`report_ai_call.error_code`). */
export class AiCallError extends DsError {
  readonly model: string;
  constructor(model: string, reason: string) {
    super("DS_AI_UNAVAILABLE", { reason });
    this.model = model;
  }
}

export async function complete(input: CompleteInput): Promise<Completion> {
  const model = modelFor(input.group);
  const apiKey = aiKey();
  if (!apiKey) throw new AiCallError(model, "not_configured");
  const r = await openRouterChat(
    {
      model,
      max_tokens: input.maxTokens,
      temperature: input.temperature ?? 0.4,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      response_format: { type: "json_object" },
    },
    { apiKey, title: "ESG-Lite Design Studio", baseUrl: process.env.STUDIO_AI_BASE_URL || undefined, timeoutMs: Number(process.env.STUDIO_AI_TIMEOUT_MS) || 45_000 },
  );
  if (!r.ok) throw new AiCallError(model, r.reason);
  return { text: r.text, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd ?? costUsd(r.model, r.tokensIn, r.tokensOut) };
}

/** The JSON object in a model answer (JSON mode may still wrap it in a fence). */
export function parseJsonObject(text: string): unknown {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("The answer has no JSON object");
  return JSON.parse(cleaned.slice(a, b + 1));
}
