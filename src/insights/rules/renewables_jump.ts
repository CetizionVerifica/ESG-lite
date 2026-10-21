/** renewables_jump (good): the renewable share of electricity rose by at least 10 percentage points on last year. */
import { card, type Rule } from "./card";
import { displayPct, RENEWABLES_JUMP_PP } from "./thresholds";

export const renewables_jump: Rule = (f) => {
  const { from_pct, to_pct } = f.renewables;
  if (from_pct === null || to_pct === null || to_pct - from_pct < RENEWABLES_JUMP_PP) return null;
  return card("renewables_jump", "good", { from_pct: displayPct(from_pct), to_pct: displayPct(to_pct) }, "/data/entries?scope=2", "pathway");
};
