/** IN-3 · the shape every rule returns (01-contracts §3 InsightCard), source 'rule'. */
import type { CardSeverity, PanelId } from "../contracts/enums";
import type { InsightCard } from "../contracts/panels";
import type { RuleId } from "../contracts/rules";
import type { Facts } from "./facts";

export type Rule = (facts: Facts) => InsightCard | null;

export const card = (rule: RuleId, severity: CardSeverity, params: Record<string, number | string>, link: string | null, panel?: PanelId): InsightCard => ({
  id: rule,
  rule,
  severity,
  source: "rule",
  params,
  link,
  ...(panel ? { panel } : {}),
});
