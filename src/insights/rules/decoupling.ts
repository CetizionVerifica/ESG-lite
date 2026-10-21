/** decoupling (good): output index above 100 and emissions index below 100 at the last year (vs the base year). */
import { card, type Rule } from "./card";
import { displayPct } from "./thresholds";

export const decoupling: Rule = (f) => {
  const d = f.decoupling;
  if (!d || !d.decoupled) return null;
  const out = d.headline.output_change_pct;
  const em = d.headline.emissions_change_pct;
  if (!(out > 0 && em < 0)) return null;
  return card("decoupling", "good", { output_pct: displayPct(out), emissions_pct: displayPct(Math.abs(em)), base_year: d.base_year }, "/production", "decoupling");
};
