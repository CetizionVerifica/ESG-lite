/**
 * Insights contracts (IN-0) §6: insight rule ids and the params each rule's
 * card carries, docs/insights/01-contracts.md. The rules themselves are
 * IN-3's (src/insights/rules/<id>.ts); thresholds live in rules/thresholds.ts.
 * The FE copy templates (src/lib/insights/cardCopy.ts) use exactly these keys,
 * and IN-9's AI wording must contain a {{v:key}} token for each one.
 */
import type { CardSeverity } from "./enums";

export const RULE_IDS = [
  "decoupling",
  "largest_source",
  "site_concentration",
  "pathway_gap",
  "pathway_on_track",
  "target_off_track",
  "renewables_jump",
  "intensity_change",
  "biggest_mover",
  "coverage_gap",
  "pending_large",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export interface RuleSpec {
  /** The severities this rule's card can take (one, or the good / attention pair). */
  severities: readonly CardSeverity[];
  /** Keys of `InsightCard.params`. */
  params: readonly string[];
}

export const RULES: Record<RuleId, RuleSpec> = {
  decoupling: { severities: ["good"], params: ["output_pct", "emissions_pct", "base_year"] },
  largest_source: { severities: ["info"], params: ["category", "share_pct"] },
  site_concentration: { severities: ["info"], params: ["site", "scope", "share_pct"] },
  pathway_gap: { severities: ["critical"], params: ["gap_pct", "target_year"] },
  pathway_on_track: { severities: ["good"], params: ["margin_pct"] },
  target_off_track: { severities: ["attention"], params: ["count", "first_name"] },
  renewables_jump: { severities: ["good"], params: ["from_pct", "to_pct"] },
  intensity_change: { severities: ["good", "attention"], params: ["change_pct", "unit"] },
  biggest_mover: { severities: ["good", "attention"], params: ["name", "change_pct"] },
  coverage_gap: { severities: ["attention"], params: ["pillar", "pct", "missing"] },
  pending_large: { severities: ["attention"], params: ["count", "link"] },
};

/** §8 AI wording limits (IN-9). */
export const AI_TEXT_MAX = 180;
/** A value token in AI text: {{v:key}}. */
export const VALUE_TOKEN = /\{\{v:([a-z_]+)\}\}/g;
