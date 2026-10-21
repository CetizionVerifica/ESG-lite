/**
 * coverage_gap (attention): once 9 months of the period have passed (or it has ended), the pillar
 * with the lowest coverage, if below 60 %. Coverage = approved ÷ (approved + pending + missing), as
 * /kpi/esg; missing = values not filed. KPI tracking on only.
 */
import { share } from "../derive";
import { card, type Rule } from "./card";
import { COVERAGE_GAP_AFTER_MONTH, COVERAGE_GAP_PCT, displayPct } from "./thresholds";

/** Months of the period that have ended by `today` (0–12). */
export const monthsPassed = (period: { start: string; end: string }, today: string): number => {
  if (today > period.end) return 12;
  const s = Number(period.start.slice(0, 4)) * 12 + Number(period.start.slice(5, 7)) - 1;
  const t = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
  return Math.max(0, Math.min(12, t - s));
};

export const coverage_gap: Rule = (f) => {
  if (!f.esg || monthsPassed(f.period, f.today) < COVERAGE_GAP_AFTER_MONTH) return null;
  let worst: { label: string; pct: number; missing: number } | null = null;
  for (const p of f.esg.pillars) {
    const pct = share(p.approved, p.approved + p.pending + p.missing);
    if (pct === null || pct >= COVERAGE_GAP_PCT) continue;
    if (!worst || pct < worst.pct) worst = { label: p.label, pct, missing: p.missing };
  }
  if (!worst) return null;
  return card("coverage_gap", "attention", { pillar: worst.label, pct: displayPct(worst.pct), missing: worst.missing }, `/kpi/dashboard?year=${f.year}`, "esg_ring");
};
