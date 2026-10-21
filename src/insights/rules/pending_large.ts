/** pending_large (attention): pending entries' tCO₂e would move the approved net by at least 5 %. */
import { card, type Rule } from "./card";
import { PENDING_LARGE_PCT } from "./thresholds";

export const APPROVALS = "/data/approvals";

export const pending_large: Rule = (f) => {
  const { count, tco2e, net } = f.pending;
  if (count < 1 || tco2e <= 0) return null;
  const moves = net === 0 ? Infinity : (tco2e / Math.abs(net)) * 100;
  if (moves < PENDING_LARGE_PCT) return null;
  return card("pending_large", "attention", { count, link: APPROVALS }, APPROVALS, "summary");
};
