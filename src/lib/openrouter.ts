/**
 * The one OpenRouter client (DS-9 moved it out of src/reporting/ai-narrative.ts,
 * same request and behaviour). Every caller that talks to a model through
 * OpenRouter goes through here:
 *
 *   openRouterFetch(body, opts)   POST /chat/completions; returns the raw fetch Response
 *                                 (ai-narrative.ts reads it exactly as before)
 *   openRouterChat(body, opts)    the same call with a time limit, parsed: text, model,
 *                                 token usage; never throws (ok: false with a reason)
 *
 * The request is byte-for-byte what ai-narrative.ts sent: the body is
 * JSON.stringify(body) in the caller's key order, and the headers are
 * authorization, content-type, HTTP-Referer and X-Title, in that order.
 * `baseUrl` lets the studio point at a recorded stub in tests
 * (STUDIO_AI_BASE_URL); it defaults to the public API.
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_REFERER = "https://esg-lite.local";

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The chat/completions body. Key order is kept as given (it is the bytes sent). */
export interface OpenRouterBody {
  model: string;
  max_tokens?: number;
  temperature?: number;
  messages: OpenRouterMessage[];
  response_format?: { type: "json_object" };
}

export interface OpenRouterOptions {
  apiKey: string;
  /** X-Title header (shown in the OpenRouter dashboard). */
  title: string;
  /** Default https://openrouter.ai/api/v1. */
  baseUrl?: string;
  signal?: AbortSignal;
}

export const openRouterKey = (): string | undefined => process.env.OPENROUTER_API_KEY || undefined;

export function openRouterFetch(body: OpenRouterBody, opts: OpenRouterOptions): Promise<Response> {
  const base = (opts.baseUrl || OPENROUTER_BASE_URL).replace(/\/+$/, "");
  return fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json", "HTTP-Referer": OPENROUTER_REFERER, "X-Title": opts.title },
    body: JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
}

export type OpenRouterResult =
  | { ok: true; text: string; model: string; tokensIn: number; tokensOut: number; costUsd: number | null }
  | { ok: false; reason: "timeout" | "http" | "network" | "empty"; status?: number };

/** One completion with a time limit (default 45 s). Never throws. */
export async function openRouterChat(body: OpenRouterBody, opts: OpenRouterOptions & { timeoutMs?: number }): Promise<OpenRouterResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
  try {
    const res = await openRouterFetch(body, { ...opts, signal: ctrl.signal });
    if (!res.ok) return { ok: false, reason: "http", status: res.status };
    const j: any = await res.json().catch(() => null);
    const text = j?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "empty" };
    const usage = j?.usage ?? {};
    return {
      ok: true,
      text,
      model: typeof j?.model === "string" && j.model ? j.model : body.model,
      tokensIn: Number(usage.prompt_tokens) || 0,
      tokensOut: Number(usage.completion_tokens) || 0,
      costUsd: typeof usage.cost === "number" && Number.isFinite(usage.cost) ? usage.cost : null,
    };
  } catch (err) {
    return { ok: false, reason: ctrl.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
