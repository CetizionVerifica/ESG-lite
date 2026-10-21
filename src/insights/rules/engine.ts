/**
 * IN-3 · the rule engine (I12).
 *
 *   collectFacts(scope, today?)  the facts every rule reads, from panels already computed for the
 *                                same scope (summary, decoupling, target wall through panelResponse,
 *                                so they share the panel cache) and the sources (Overview categories,
 *                                per-site scopes, electricity, /kpi/esg). A panel that isn't `ok`
 *                                gives null, so its rules don't fire.
 *   runRules(facts)              every rule, nulls dropped, ranked critical → attention → good →
 *                                info, then RULE_WEIGHT, at most MAX_CARDS. Pure.
 *   ruleCards(scope, today?)     collectFacts + runRules: the rule cards for a scope. IN-9 wraps this
 *                                (rewording only; numbers and links stay the rule's).
 */
import { CARD_SEVERITY_RANK, DECOUPLING_YEARS_DEFAULT, MAX_CARDS } from "../contracts/enums";
import type { Decoupling, InsightCard, Summary, TargetWall } from "../contracts/panels";
import { RULE_IDS, type RuleId } from "../contracts/rules";
import type { DecouplingQuery } from "../contracts/schemas";
import { share } from "../derive";
import { panelResponse } from "../panel";
import { buildDecoupling } from "../panels/decoupling";
import { buildSummary } from "../panels/summary";
import { buildTargetWall } from "../panels/targetWall";
import type { InsightsScope } from "../scope";
import { overview } from "../sources/emissions";
import { electricityByYear } from "../sources/energy";
import { scopesBySite } from "../sources/flow";
import { esg } from "../sources/kpi";
import { biggest_mover } from "./biggest_mover";
import type { Rule } from "./card";
import { coverage_gap } from "./coverage_gap";
import { decoupling } from "./decoupling";
import type { Facts } from "./facts";
import { intensity_change } from "./intensity_change";
import { largest_source } from "./largest_source";
import { pathway_gap } from "./pathway_gap";
import { pathway_on_track } from "./pathway_on_track";
import { pending_large } from "./pending_large";
import { renewables_jump } from "./renewables_jump";
import { site_concentration } from "./site_concentration";
import { target_off_track } from "./target_off_track";
import { RULE_WEIGHT } from "./thresholds";

export const RULES: Record<RuleId, Rule> = {
  decoupling,
  largest_source,
  site_concentration,
  pathway_gap,
  pathway_on_track,
  target_off_track,
  renewables_jump,
  intensity_change,
  biggest_mover,
  coverage_gap,
  pending_large,
};

const okData = <T>(r: { availability: string; data: T | null }): T | null => (r.availability === "ok" ? r.data : null);

export async function collectFacts(scope: InsightsScope, today = new Date().toISOString().slice(0, 10)): Promise<Facts> {
  const year = scope.period.year;
  const dScope = { ...scope, query: { ...scope.query, years: DECOUPLING_YEARS_DEFAULT } } as InsightsScope<DecouplingQuery>;
  const [summary, dec, wall] = await Promise.all([
    panelResponse<Summary, InsightsScope["query"]>("summary", scope, buildSummary),
    panelResponse<Decoupling, DecouplingQuery>("decoupling", dScope, buildDecoupling, { extras: (q) => ({ years: q.years }) }),
    panelResponse<TargetWall, InsightsScope["query"]>("target_wall", scope, buildTargetWall),
  ]);
  const ov = await overview(scope);
  const [elec0, elec1] = await electricityByYear(scope, [year - 1, year]);
  const e = scope.kpiOn ? await esg(scope) : null;
  return {
    year,
    period: scope.range,
    today,
    summary: okData(summary),
    decoupling: okData(dec),
    targetWall: okData(wall),
    gross: ov.kpis.gross,
    categories: ov.by_category,
    siteScopes: scope.siteIds.length >= 2 ? await scopesBySite(scope) : [],
    renewables: { from_pct: elec0 ? share(elec0.renewable_kwh, elec0.total_kwh) : null, to_pct: elec1 ? share(elec1.renewable_kwh, elec1.total_kwh) : null },
    pending: { count: ov.kpis.pending_review_count, tco2e: ov.kpis.pending_emission, net: ov.kpis.net },
    esg: e
      ? {
          pillars: e.pillars.map((p) => ({ pillar: p.pillar, label: p.label, approved: p.approved, pending: p.pending, missing: p.missing })),
          movers: e.movers.map((m) => ({ kpi_definition_id: m.kpi_definition_id, name: m.name, change_pct: m.change_pct, good: m.good })),
        }
      : null,
  };
}

const severityRank = (c: InsightCard) => CARD_SEVERITY_RANK.indexOf(c.severity);

/** Every rule on the facts; ranked by severity then weight; at most MAX_CARDS. */
export function runRules(facts: Facts, max = MAX_CARDS): InsightCard[] {
  const fired = RULE_IDS.map((id) => RULES[id](facts)).filter((c): c is InsightCard => c !== null);
  return fired.sort((a, b) => severityRank(a) - severityRank(b) || RULE_WEIGHT[b.rule] - RULE_WEIGHT[a.rule]).slice(0, max);
}

export const ruleCards = async (scope: InsightsScope, today?: string): Promise<InsightCard[]> => runRules(await collectFacts(scope, today));
