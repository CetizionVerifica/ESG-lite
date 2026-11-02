/**
 * AS-1 Â· the help assistant's model call: one completion through
 * src/lib/openrouter.ts in JSON mode, as the studio's client.ts does.
 *
 *   complete({system, user, maxTokens})  â†’ {text, model, tokensIn, tokensOut, costUsd}
 *                                          throws AsError AS_AI_UNAVAILABLE {reason}
 *
 * Model ASSISTANT_AI_MODEL (default ASSISTANT_DEFAULT_MODEL). Key
 * ASSISTANT_AI_API_KEY, else STUDIO_AI_API_KEY, else OPENROUTER_API_KEY. Endpoint
 * ASSISTANT_AI_BASE_URL, else STUDIO_AI_BASE_URL (tests point it at a recorded
 * stub; never a real model in CI). Cost: OpenRouter's usage.cost, else the
 * studio price table (src/studio/ai/prices.ts, read only, as Insights does).
 */
import { openRouterChat, openRouterKey } from "../lib/openrouter";
import { costUsd } from "../studio/ai/prices";
import { AsError } from "./http";

/** Light and fast for how-to answers. Check any change of model against real answers first. */
export const ASSISTANT_DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";

export const assistantModel = (): string => process.env.ASSISTANT_AI_MODEL || ASSISTANT_DEFAULT_MODEL;
export const assistantKey = (): string | undefined => process.env.ASSISTANT_AI_API_KEY || process.env.STUDIO_AI_API_KEY || openRouterKey();
export const assistantConfigured = (): boolean => !!assistantKey();

export interface Completion {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/** A failed call, with the model for the log (`assistant_call.model`). */
export class AssistantCallError extends AsError {
  constructor(
    readonly model: string,
    readonly reason: string,
  ) {
    super("AS_AI_UNAVAILABLE", { reason });
  }
}

export async function complete(input: { system: string; user: string; maxTokens: number }): Promise<Completion> {
  const model = assistantModel();
  const apiKey = assistantKey();
  if (!apiKey) throw new AssistantCallError(model, "not_configured");
  const r = await openRouterChat(
    {
      model,
      max_tokens: input.maxTokens,
      temperature: 0,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      response_format: { type: "json_object" },
      // The answer is in the articles offered, so no thinking step: quicker, and it can't use up max_tokens.
      reasoning: { enabled: false },
      // People's words go only to hosts that don't keep or train on them; the fastest of those.
      provider: { data_collection: "deny", sort: "latency" },
    },
    {
      apiKey,
      title: "ESGLite Help Assistant",
      baseUrl: process.env.ASSISTANT_AI_BASE_URL || process.env.STUDIO_AI_BASE_URL || undefined,
      timeoutMs: Number(process.env.ASSISTANT_AI_TIMEOUT_MS || process.env.STUDIO_AI_TIMEOUT_MS) || 30_000,
    },
  );
  if (!r.ok) throw new AssistantCallError(model, r.reason);
  return { text: r.text, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd ?? costUsd(r.model, r.tokensIn, r.tokensOut) };
}
