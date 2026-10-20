/**
 * DS-9 · model prices for the budget (D10): USD per million tokens, input and
 * output, as listed by OpenRouter when this was written. OpenRouter's own
 * `usage.cost`, when it comes back, wins over this table. An unknown model is
 * priced as the drafting model (the dearest), so the budget errs on the safe side.
 */
export const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  "anthropic/claude-sonnet-5.5": { in: 3, out: 15 },
  "google/gemini-3-flash-preview": { in: 0.5, out: 3 },
};
const FALLBACK = { in: 3, out: 15 };

export function costUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = MODEL_PRICES[model] ?? FALLBACK;
  return Math.round(((tokensIn * p.in + tokensOut * p.out) / 1_000_000) * 100_000) / 100_000;
}
