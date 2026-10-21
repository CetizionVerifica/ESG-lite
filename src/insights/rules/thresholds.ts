/**
 * IN-3 · every number the insight rules use (01-contracts §6, I12). Fixed for
 * every client; per-client thresholds are out of scope (I15).
 */
import type { RuleId } from "../contracts/rules";


/** largest_source: the top category's share of gross tCO₂e, %. */
export const LARGEST_SOURCE_SHARE_PCT = 40;
/** site_concentration: one site's share of a scope, % (only with two or more sites). */
export const SITE_CONCENTRATION_SHARE_PCT = 50;
/** target_off_track: KPI targets off track (I6) that make the card. */
export const TARGET_OFF_TRACK_MIN = 1;
/** renewables_jump: renewable share of electricity up on last year, percentage points. */
export const RENEWABLES_JUMP_PP = 10;
/** intensity_change: intensity change on last year, % either way. */
export const INTENSITY_CHANGE_PCT = 5;
/** biggest_mover: the /kpi/esg top mover's change must be at least this, % either way. */
export const BIGGEST_MOVER_MIN_PCT = 0.05;
/** coverage_gap: a pillar below this coverage, % … */
export const COVERAGE_GAP_PCT = 60;
/** … once this many months of the period have passed (or it has ended). */
export const COVERAGE_GAP_AFTER_MONTH = 9;
/** pending_large: pending tCO₂e would move net by at least this, %. */
export const PENDING_LARGE_PCT = 5;
/** At most this many cards (MAX_CARDS in the contracts) — kept here for the engine. */
export { MAX_CARDS } from "../contracts/enums";

/**
 * Rule weight inside one severity (higher first). The pathway and targets lead;
 * descriptive facts (largest source, concentration) trail.
 */
export const RULE_WEIGHT: Record<RuleId, number> = {
  pathway_gap: 100,
  pending_large: 90,
  target_off_track: 80,
  coverage_gap: 70,
  intensity_change: 60,
  biggest_mover: 50,
  pathway_on_track: 45,
  decoupling: 40,
  renewables_jump: 35,
  largest_source: 20,
  site_concentration: 10,
};

/** Display rounding for params: 0 dp, 1 dp when the magnitude is under 10. */
export const displayPct = (n: number): number => {
  const r = Math.abs(n) < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return r === 0 ? 0 : r; // never -0
};
