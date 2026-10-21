/**
 * IN-9 · AI wording for insight cards (I13, I14, 01-contracts §8). The only way
 * Insights talks to a model.
 *
 *   rewordCards(scope, cards, stamp)  the cards, with `source: 'ai'` and `text` on those whose
 *                                     wording passed the guard; every other card unchanged.
 *                                     Never throws for a model problem: no key, over budget,
 *                                     provider down, a bad answer → the rule text.
 *
 * One batched call for every card not already cached. The prompt carries each card's rule id,
 * a plain description, its params as {{v:key}} names with display values, and the company's
 * name and sector — nothing else. Every call writes one insight_ai_call row (ids, the rules,
 * model, tokens, cost, ok; never any text). A card's wording is cached per (rule, params,
 * stamp, prompt version) — a rejected wording too, so a bad answer isn't paid for twice.
 * Model and endpoint: INSIGHTS_AI_MODEL (default google/gemini-3-flash-preview, I13); key
 * INSIGHTS_AI_API_KEY, else the studio's STUDIO_AI_API_KEY, else OPENROUTER_API_KEY; base URL
 * INSIGHTS_AI_BASE_URL, else STUDIO_AI_BASE_URL (tests point both at a recorded stub).
 */
import { createHash } from "crypto";
import { AppDataSource } from "../../config/data-source";
import { openRouterChat, openRouterKey } from "../../lib/openrouter";
import { costUsd } from "../../studio/ai/prices";
import type { InsightCard } from "../contracts/panels";
import { RULES } from "../contracts/rules";
import type { InsightsScope } from "../scope";
import { checkCardText, parseAiAnswer, requiredTokens } from "./guard";
import { monthUsage, overBudget } from "./budget";
import { CARD_PROMPT_VERSION, CARD_SYSTEM, cardUserPrompt, type PromptCard } from "./prompts/card";

export const AI_MODEL_DEFAULT = "google/gemini-3-flash-preview";
const TTL_MS = 10 * 60 * 1000;

const aiModel = () => process.env.INSIGHTS_AI_MODEL || AI_MODEL_DEFAULT;
const aiKey = () => process.env.INSIGHTS_AI_API_KEY || process.env.STUDIO_AI_API_KEY || openRouterKey();
const aiBase = () => process.env.INSIGHTS_AI_BASE_URL || process.env.STUDIO_AI_BASE_URL || undefined;
const aiTimeout = () => Number(process.env.INSIGHTS_AI_TIMEOUT_MS || process.env.STUDIO_AI_TIMEOUT_MS) || 20_000;

/** text = accepted wording; null = the guard rejected it (keep the rule text). */
const wording = new Map<string, { at: number; text: string | null }>();

export const wordingKey = (card: Pick<InsightCard, "rule" | "params">, stamp: string): string =>
  createHash("sha1").update(JSON.stringify([CARD_PROMPT_VERSION, card.rule, card.params, stamp])).digest("hex");

/** Drops every cached wording (tests). */
export const emptyWordingCache = () => {
  for (const k of [...wording.keys()]) wording.delete(k);
};

const apply = (cards: InsightCard[], stamp: string): InsightCard[] =>
  cards.map((c) => {
    const hit = wording.get(wordingKey(c, stamp));
    return hit?.text ? { ...c, source: "ai" as const, text: hit.text } : c;
  });

async function logCall(scope: InsightsScope, rules: string[], row: { model: string; tokens_in: number; tokens_out: number; cost_usd: number; ok: boolean }) {
  await AppDataSource.query(
    `INSERT INTO insight_ai_call (company_id, user_id, card_rule, model, tokens_in, tokens_out, cost_usd, ok) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [scope.companyId, scope.caller.userId || null, rules.join(",").slice(0, 40), row.model.slice(0, 80), row.tokens_in, row.tokens_out, row.cost_usd, row.ok],
  );
}

export async function rewordCards(scope: InsightsScope, cards: InsightCard[], stamp: string, now = Date.now()): Promise<InsightCard[]> {
  if (!cards.length) return cards;
  for (const [k, e] of wording) if (now - e.at >= TTL_MS) wording.delete(k);
  const misses = cards.filter((c) => !wording.has(wordingKey(c, stamp)));
  if (!misses.length) return apply(cards, stamp);

  const apiKey = aiKey();
  if (!apiKey) return apply(cards, stamp);
  if (overBudget(await monthUsage(scope.companyId))) {
    console.warn(`[insights] IN_AI_BUDGET company ${scope.companyId}: cards keep their rule text`);
    return apply(cards, stamp);
  }

  const [company]: Array<{ name: string; industry: string | null }> = await AppDataSource.query(`SELECT name, industry FROM company WHERE company_id = $1`, [scope.companyId]);
  const prompt: PromptCard[] = misses.map((c) => ({ id: c.id, rule: c.rule, params: c.params, required: requiredTokens(c.rule) }));
  const model = aiModel();
  const r = await openRouterChat(
    {
      model,
      max_tokens: 200 + 120 * misses.length,
      temperature: 0.3,
      messages: [
        { role: "system", content: CARD_SYSTEM },
        { role: "user", content: cardUserPrompt({ name: String(company?.name ?? ""), sector: company?.industry ? String(company.industry) : null }, prompt) },
      ],
      response_format: { type: "json_object" },
    },
    { apiKey, title: "ESG-Lite Insights", baseUrl: aiBase(), timeoutMs: aiTimeout() },
  );
  const rules = misses.map((c) => c.rule);
  if (!r.ok) {
    await logCall(scope, rules, { model, tokens_in: 0, tokens_out: 0, cost_usd: 0, ok: false });
    console.warn(`[insights] AI wording failed for company ${scope.companyId}: ${r.reason}`);
    return apply(cards, stamp);
  }
  const answer = parseAiAnswer(r.text);
  await logCall(scope, rules, { model: r.model, tokens_in: r.tokensIn, tokens_out: r.tokensOut, cost_usd: r.costUsd ?? costUsd(r.model, r.tokensIn, r.tokensOut), ok: !!answer });
  for (const c of misses) {
    const got = answer?.cards.find((a) => a.id === c.id);
    const text = got && checkCardText(got.text, requiredTokens(c.rule), [...RULES[c.rule].params]) === null ? got.text.trim() : null;
    wording.set(wordingKey(c, stamp), { at: now, text });
  }
  return apply(cards, stamp);
}
