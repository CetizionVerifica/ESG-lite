/** pathway_on_track (good): the SBTi pathway status is on_track; margin = how far below the pathway. */
import { card, type Rule } from "./card";
import { displayPct } from "./thresholds";

export const pathway_on_track: Rule = (f) => {
  const p = f.summary?.pathway;
  if (!p || p.status !== "on_track" || p.gap_pct === null) return null;
  return card("pathway_on_track", "good", { margin_pct: displayPct(Math.abs(Math.min(0, p.gap_pct))) }, "/targets", "pathway");
};
