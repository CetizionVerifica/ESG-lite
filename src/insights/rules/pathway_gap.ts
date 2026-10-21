/** pathway_gap (critical): the SBTi pathway status is off_track (I6: more than 5 % above). */
import { card, type Rule } from "./card";
import { displayPct } from "./thresholds";

export const pathway_gap: Rule = (f) => {
  const p = f.summary?.pathway;
  if (!p || p.status !== "off_track" || p.gap_pct === null || p.target_year === null) return null;
  return card("pathway_gap", "critical", { gap_pct: displayPct(p.gap_pct), target_year: p.target_year }, "/targets", "pathway");
};
