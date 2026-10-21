/** biggest_mover (good / attention by the KPI's direction): /kpi/esg's top mover (KPI tracking on). */
import { card, type Rule } from "./card";
import { BIGGEST_MOVER_MIN_PCT, displayPct } from "./thresholds";

export const biggest_mover: Rule = (f) => {
  const m = f.esg?.movers.find((x) => x.change_pct !== null);
  if (!m || Math.abs(m.change_pct as number) < BIGGEST_MOVER_MIN_PCT) return null;
  return card("biggest_mover", m.good ? "good" : "attention", { name: m.name, change_pct: displayPct(m.change_pct as number) }, `/kpi/esg?year=${f.year}`, "esg_ring");
};
