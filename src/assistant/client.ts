/**
 * AS-1 · the help assistant's model call: one completion through
 * src/lib/openrouter.ts in JSON mode, as the studio's client.ts does.
 *
 *   complete({system, user, images?, maxTokens})
 *                     → {text, model, tokensIn, tokensOut, costUsd}
 *                       throws AsError AS_AI_UNAVAILABLE {reason}
 *
 * Model ASSISTANT_AI_MODEL (default ASSISTANT_DEFAULT_MODEL), key
 * ASSISTANT_AI_API_KEY, endpoint ASSISTANT_AI_BASE_URL (tests point it at a
 * recorded stub; never a real model in CI), time limit ASSISTANT_AI_TIMEOUT_MS.
 * These are the assistant's own: it never borrows OPENROUTER_* or STUDIO_AI_*,
 * which carry the reports' and the studio's key and Gemini models, so a change or
 * a bill on one never touches the other. Without its key it stays hidden.
 * Cost: OpenRouter's usage.cost, else the studio price table
 * (src/studio/ai/prices.ts, read only, as Insights does).
 */
import { openRouterChat } from "../lib/openrouter";
import { costUsd } from "../studio/ai/prices";
import { AsError } from "./http";

/**
 * Light and fast, and it reads files faithfully: 34 of 34 test readings. The
 * newer -1017 snapshot was quicker but made up a whole CSV, so check any change
 * of model against real files first.
 */
export const ASSISTANT_DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";

export const assistantModel = (): string => process.env.ASSISTANT_AI_MODEL || ASSISTANT_DEFAULT_MODEL;
export const assistantKey = (): string | undefined => process.env.ASSISTANT_AI_API_KEY || undefined;
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

/** Pictures take longer to read than text. */
const FILE_TIMEOUT_MS = 45_000;

export async function complete(input: { system: string; user: string; images?: string[]; maxTokens: number }): Promise<Completion> {
  const model = assistantModel();
  const apiKey = assistantKey();
  if (!apiKey) throw new AssistantCallError(model, "not_configured");
  const pictures = input.images ?? [];
  const r = await openRouterChat(
    {
      model,
      max_tokens: input.maxTokens,
      // No improvising: at 0.2 it sometimes made up details a bill didn't show.
      temperature: 0,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: pictures.length ? [{ type: "text", text: input.user }, ...pictures.map((url) => ({ type: "image_url" as const, image_url: { url } }))] : input.user },
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
      baseUrl: process.env.ASSISTANT_AI_BASE_URL || undefined,
      timeoutMs: Number(process.env.ASSISTANT_AI_TIMEOUT_MS) || (pictures.length ? FILE_TIMEOUT_MS : 30_000),
    },
  );
  if (!r.ok) throw new AssistantCallError(model, r.reason);
  return { text: r.text, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd ?? costUsd(r.model, r.tokensIn, r.tokensOut) };
}
