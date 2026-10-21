/**
 * IN-3 · the facts every rule reads: plain data the engine collects once per
 * scope from the panels already computed (summary, decoupling, target wall)
 * and the sources (Overview categories and per-site scopes, electricity, /kpi/esg).
 * A part whose panel isn't `ok` is null, so its rules don't fire.
 */
import type { Pillar } from "../contracts/enums";
import type { Decoupling, Summary, TargetWall } from "../contracts/panels";

export interface Facts {
  year: number;
  /** ISO dates of the period and today (coverage_gap's "after month 9"). */
  period: { start: string; end: string };
  today: string;
  summary: Summary | null;
  decoupling: Decoupling | null;
  targetWall: TargetWall | null;
  /** Overview's gross and its scoped categories (largest first). */
  gross: number;
  categories: Array<{ category_id: number; category_name: string; scope: string; total: number }>;
  /** Approved Scope 1/2/3 per site (two or more sites for site_concentration). */
  siteScopes: Array<{ site_id: number; name: string; scope_1: number; scope_2: number; scope_3: number }>;
  /** Renewable share of electricity, % — last year and this year (null without data). */
  renewables: { from_pct: number | null; to_pct: number | null };
  /** Pending entries (approvals count), their tCO₂e and the approved net (Overview). */
  pending: { count: number; tco2e: number; net: number };
  /** /kpi/esg, KPI on and set up only. */
  esg: {
    pillars: Array<{ pillar: Pillar; label: string; approved: number; pending: number; missing: number }>;
    movers: Array<{ kpi_definition_id: number; name: string; change_pct: number | null; good: boolean }>;
  } | null;
}
