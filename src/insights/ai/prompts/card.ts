/**
 * IN-9 · the card wording prompt, versioned (the module spec's `prompts/card.md`; kept as a
 * TypeScript string because `tsc` doesn't copy .md files into dist/). Bump CARD_PROMPT_VERSION
 * whenever the text changes; the AI card cache key carries it.
 *
 * What the model sees (01-contracts §8): each card's rule id, a plain description of the rule,
 * its params as {{v:key}} names with display values, the company's display name and sector.
 * No user emails, no evidence, no row-level data.
 */
import type { RuleId } from "../../contracts/rules";

export const CARD_PROMPT_VERSION = "card-v1";

/** What each rule says, in plain words (the model's context; never shown as is). */
export const RULE_DESCRIPTIONS: Record<RuleId, string> = {
  decoupling: "Output grew since the base year while emissions fell.",
  largest_source: "One emission category is a large share of the footprint.",
  site_concentration: "One site makes up most of one scope's emissions.",
  pathway_gap: "Emissions are above the science-based pathway this year.",
  pathway_on_track: "Emissions are below the science-based pathway this year.",
  target_off_track: "Some ESG targets are off track.",
  renewables_jump: "The renewable share of electricity rose sharply on last year.",
  intensity_change: "Emission intensity per unit of output moved noticeably on last year.",
  biggest_mover: "One ESG measure changed the most on last year.",
  coverage_gap: "One ESG pillar's data is far from complete late in the year.",
  pending_large: "Entries waiting for approval could move the figures.",
};

export const CARD_SYSTEM = [
  "You reword short insight sentences for a company's sustainability dashboard.",
  "Rules you must follow:",
  "- Return JSON only: {\"cards\":[{\"id\":\"<card id>\",\"text\":\"<sentence>\"}]}, one entry per card you were given.",
  "- Each text is one plain sentence of at most 180 characters.",
  "- Every value is a token like {{v:share_pct}}. Use every token listed for the card exactly as written, and no other.",
  "- Never write a digit or a number yourself, never a URL, never a percentage sign outside a token's own text.",
  "- Don't add claims, causes, advice or praise the card doesn't state. No 'guarantee', 'certified', 'compliant' or similar words.",
  "- Plain business English; no jargon, no exclamation marks.",
].join("\n");

export interface PromptCard {
  id: string;
  rule: RuleId;
  /** token name → display value */
  params: Record<string, string | number>;
  /** tokens the text must contain */
  required: string[];
}

export function cardUserPrompt(company: { name: string; sector: string | null }, cards: PromptCard[]): string {
  const lines = [`Company: ${company.name}${company.sector ? ` (sector: ${company.sector})` : ""}`, "Cards:"];
  for (const c of cards) {
    lines.push(`- id: ${c.id}`);
    lines.push(`  rule: ${c.rule} — ${RULE_DESCRIPTIONS[c.rule]}`);
    lines.push(`  tokens (all required): ${c.required.map((k) => `{{v:${k}}} = ${JSON.stringify(c.params[k])}`).join("; ")}`);
  }
  return lines.join("\n");
}
