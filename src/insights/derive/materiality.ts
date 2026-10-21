/**
 * IN-7 · materiality × performance figures (pure; layer rule 4).
 *
 *   worstStatus(statuses)     the worst target status: off_track > at_risk > on_track > reached >
 *                             no_data (no_data only when nothing else is known; none → no_data)
 *   topicShares(counts, e1)   each topic's raw share in %: E1 (climate) = 100 when the company has
 *                             approved tCO₂e in the period (every tonne is a climate tonne), else its
 *                             KPI share like the others; other topics = its KPIs ÷ Σ KPIs of all
 *                             material topics × 100 (a KPI mapped to two topics counts in both)
 *   weightOf(share)           1 + 9 × share ÷ 100: 1–10 for bubble size (0 % → 1, 100 % → 10)
 *   kpiStatuses(targets)      KPI id → the worst status of its targets
 */
import type { TargetStatus } from "../contracts/enums";

export const STATUS_SEVERITY: readonly TargetStatus[] = ["off_track", "at_risk", "on_track", "reached", "no_data"];

export function worstStatus(statuses: TargetStatus[]): TargetStatus {
  let best: TargetStatus = "no_data";
  for (const s of statuses) if (STATUS_SEVERITY.indexOf(s) < STATUS_SEVERITY.indexOf(best)) best = s;
  return best;
}

export function topicShares(kpiCounts: Record<string, number>, e1HasEmissions: boolean): Record<string, number> {
  const total = Object.values(kpiCounts).reduce((a, n) => a + n, 0);
  const out: Record<string, number> = {};
  for (const [topic, n] of Object.entries(kpiCounts)) out[topic] = topic === "E1" && e1HasEmissions ? 100 : total ? (n / total) * 100 : 0;
  return out;
}

export const weightOf = (sharePct: number): number => 1 + (9 * Math.min(100, Math.max(0, sharePct))) / 100;

export function kpiStatuses(targets: Array<{ kpi_definition_id: number; status: TargetStatus }>): Map<number, TargetStatus> {
  const by = new Map<number, TargetStatus[]>();
  for (const t of targets) by.set(t.kpi_definition_id, [...(by.get(t.kpi_definition_id) ?? []), t.status]);
  return new Map([...by].map(([id, s]) => [id, worstStatus(s)]));
}
