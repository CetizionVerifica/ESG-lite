/**
 * intensity_change (good when it fell, attention when it rose): emission intensity moved at least
 * 5 % on last year. change_pct is the size of the move; the severity says which way. Not for a
 * combined index over mixed production units (no single unit to name).
 */
import { card, type Rule } from "./card";
import { displayPct, INTENSITY_CHANGE_PCT } from "./thresholds";

export const intensity_change: Rule = (f) => {
  const i = f.summary?.intensity;
  if (!i || i.combined || i.change_pct === null || Math.abs(i.change_pct) < INTENSITY_CHANGE_PCT) return null;
  return card("intensity_change", i.change_pct < 0 ? "good" : "attention", { change_pct: displayPct(Math.abs(i.change_pct)), unit: i.unit }, "/production", "decoupling");
};
