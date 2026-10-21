/**
 * IN-9 · the AI output guard (01-contracts §8). The model answers
 * `{cards:[{id, text}]}`; a card's text is kept only when:
 *   - it is a plain string of at most AI_TEXT_MAX (180) characters, one line;
 *   - it contains every required {{v:key}} token of its rule and no token that isn't a param;
 *   - with the tokens taken out, it has no digit, no URL, no markup, no "{{" left over;
 *   - it has none of the blocklisted words (claims the rule never makes).
 * Anything else keeps the rule's own text (the card stays `source: 'rule'`).
 *
 *   parseAiAnswer(text)            the zod-checked {cards} or null
 *   checkCardText(text, required, allowed)  null when fine, else the reason (for tests and logs)
 *   requiredTokens(rule)           RULES[rule].params without `link` (a route, never prose)
 *   fillTokens(text, params)       the sentence with values in (tests; the FE substitutes)
 */
import { z } from "zod";
import { AI_TEXT_MAX, RULES, VALUE_TOKEN, type RuleId } from "../contracts/rules";

export const AiAnswerSchema = z.object({
  cards: z.array(z.object({ id: z.string().min(1).max(60), text: z.string() })).max(20),
});
export type AiAnswer = z.infer<typeof AiAnswerSchema>;

/** Words that claim more than a rule does. Lower case, matched as whole words. */
export const BLOCKLIST = ["guarantee", "guaranteed", "guarantees", "certified", "certification", "compliant", "compliance", "verified", "audited", "assured", "best", "world-class", "promise"];

const URL_RE = /(https?:\/\/|www\.|\.(com|org|net|io)\b)/i;
const MARKUP_RE = /[<>]|\{\{|\}\}/;

export const requiredTokens = (rule: RuleId): string[] => RULES[rule].params.filter((k) => k !== "link");

export function checkCardText(text: unknown, required: string[], allowed: string[]): string | null {
  if (typeof text !== "string") return "not_text";
  const t = text.trim();
  if (!t) return "empty";
  if (t.length > AI_TEXT_MAX) return "too_long";
  if (/[\r\n]/.test(t)) return "multi_line";
  const used = [...t.matchAll(new RegExp(VALUE_TOKEN.source, "g"))].map((m) => m[1]);
  for (const k of required) if (!used.includes(k)) return `missing_token:${k}`;
  for (const k of used) if (!allowed.includes(k)) return `unknown_token:${k}`;
  const bare = t.replace(new RegExp(VALUE_TOKEN.source, "g"), " ");
  if (/\d/.test(bare)) return "digit_outside_token";
  if (URL_RE.test(bare)) return "url";
  if (MARKUP_RE.test(bare)) return "markup";
  const words = bare.toLowerCase().split(/[^a-z-]+/);
  for (const w of BLOCKLIST) if (words.includes(w)) return `blocked_word:${w}`;
  return null;
}

/** The answer's JSON object, zod-checked; null when it isn't one. */
export function parseAiAnswer(text: string): AiAnswer | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  if (a < 0 || b < a) return null;
  try {
    const r = AiAnswerSchema.safeParse(JSON.parse(cleaned.slice(a, b + 1)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export const fillTokens = (text: string, params: Record<string, string | number>): string =>
  text.replace(new RegExp(VALUE_TOKEN.source, "g"), (all, k: string) => (k in params ? String(params[k]) : all));
