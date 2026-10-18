/**
 * D19 (wave E) · the ESG dashboard's headline KPIs and which way is good.
 *
 *   HEADLINES      the fixed headline list, per topic, in the order the dashboard
 *                  picks them. `GET /kpi/esg` `trends` takes, for each pillar, the
 *                  entries whose KPIs the company selected and whose KPI is in that
 *                  pillar (the KPI's own `pillar`, so a Superadmin override moves
 *                  it), at most HEADLINES_PER_PILLAR. The first four of each pillar
 *                  are the headlines; the rest stand in when a company doesn't
 *                  track one of them.
 *   DIRECTION_GOOD for every library KPI: "down" (less is better), "up" (more is
 *                  better) or null (neither: headcount, revenue, ethics concerns
 *                  raised). Movers read it,
 *                  and a headline's direction is its entry's.
 *
 * A headline with more than one part is their sum (same canonical unit): GHG
 * Scope 1 + 2 adds the approved Scope 1 and location-based Scope 2 values,
 * which KPI-5 wrote from the GHG report's own functions (computeGhgTables).
 * When only one part is selected, the headline is that KPI alone.
 */
import type { KpiTopic, TargetDirection } from "../contracts/enums";

export type DirectionGood = "down" | "up" | null;

export interface Headline {
  /** The KPI code, or the headline's own code when it adds up several KPIs. */
  code: string;
  topic: KpiTopic;
  /** Library KPI codes it reads; several = their sum. */
  parts: string[];
  /** The name of a headline with several parts (one part: the KPI's name). */
  name?: string;
  direction_good: DirectionGood;
}

export const HEADLINES_PER_PILLAR = 4;

export const HEADLINES: readonly Headline[] = [
  // Environment
  { code: "GHG_SCOPE1_2", topic: "climate", parts: ["GHG_SCOPE1", "GHG_SCOPE2_LB"], name: "GHG emissions, Scope 1 and 2", direction_good: "down" },
  { code: "ENERGY_TOTAL", topic: "energy", parts: ["ENERGY_TOTAL"], direction_good: "down" },
  { code: "WATER_WITHDRAWAL", topic: "water", parts: ["WATER_WITHDRAWAL"], direction_good: "down" },
  { code: "WASTE_GENERATED", topic: "waste", parts: ["WASTE_GENERATED"], direction_good: "down" },
  { code: "GHG_SCOPE3", topic: "climate", parts: ["GHG_SCOPE3"], direction_good: "down" },
  { code: "ENERGY_RENEWABLE_SHARE", topic: "energy", parts: ["ENERGY_RENEWABLE_SHARE"], direction_good: "up" },
  { code: "WATER_CONSUMPTION", topic: "water", parts: ["WATER_CONSUMPTION"], direction_good: "down" },
  { code: "WASTE_HAZARDOUS", topic: "waste", parts: ["WASTE_HAZARDOUS"], direction_good: "down" },
  // Social
  { code: "EMPLOYEES_TOTAL", topic: "workforce", parts: ["EMPLOYEES_TOTAL"], direction_good: null },
  { code: "LTIFR", topic: "health_safety", parts: ["LTIFR"], direction_good: "down" },
  { code: "WOMEN_IN_WORKFORCE", topic: "diversity", parts: ["WOMEN_IN_WORKFORCE"], direction_good: "up" },
  { code: "TRAINING_HOURS_AVG", topic: "training", parts: ["TRAINING_HOURS_AVG"], direction_good: "up" },
  { code: "FATALITIES", topic: "health_safety", parts: ["FATALITIES"], direction_good: "down" },
  { code: "EMPLOYEE_TURNOVER_RATE", topic: "workforce", parts: ["EMPLOYEE_TURNOVER_RATE"], direction_good: "down" },
  { code: "COMPLAINTS_RECEIVED", topic: "human_rights", parts: ["COMPLAINTS_RECEIVED"], direction_good: "down" },
  // Governance: board composition (governance topic, as in ESRS 2 GOV-1 and GRI 2-9) and
  // anti-corruption (ethics topic, GRI 205 and ESRS G1).
  { code: "WOMEN_ON_BOARD", topic: "governance", parts: ["WOMEN_ON_BOARD"], direction_good: "up" },
  { code: "BOARD_INDEPENDENCE", topic: "governance", parts: ["BOARD_INDEPENDENCE"], direction_good: "up" },
  { code: "CORRUPTION_INCIDENTS", topic: "ethics", parts: ["CORRUPTION_INCIDENTS"], direction_good: "down" },
  { code: "ANTI_CORRUPTION_TRAINING_SHARE", topic: "ethics", parts: ["ANTI_CORRUPTION_TRAINING_SHARE"], direction_good: "up" },
];

export const DIRECTION_GOOD: Readonly<Record<string, DirectionGood>> = {
  GHG_SCOPE1: "down",
  GHG_SCOPE2_LB: "down",
  GHG_SCOPE2_MB: "down",
  GHG_SCOPE3: "down",
  GHG_INTENSITY_REVENUE: "down",
  ENERGY_TOTAL: "down",
  ENERGY_RENEWABLE: "up",
  ENERGY_NON_RENEWABLE: "down",
  ENERGY_INTENSITY_REVENUE: "down",
  ENERGY_RENEWABLE_SHARE: "up",
  WATER_WITHDRAWAL: "down",
  WATER_DISCHARGE: null,
  WATER_CONSUMPTION: "down",
  WATER_INTENSITY_REVENUE: "down",
  WATER_RECYCLED: "up",
  WASTE_GENERATED: "down",
  WASTE_HAZARDOUS: "down",
  WASTE_DIVERTED: "up",
  WASTE_DISPOSED: "down",
  WASTE_INTENSITY_REVENUE: "down",
  AIR_NOX: "down",
  AIR_SOX: "down",
  AIR_PM: "down",
  REVENUE: null,
  HOURS_WORKED: null,
  EMPLOYEES_TOTAL: null,
  EMPLOYEES_PERMANENT: null,
  EMPLOYEES_TEMPORARY: null,
  WORKERS_TOTAL: null,
  EMPLOYEES_DIFFERENTLY_ABLED: "up",
  NEW_HIRES: null,
  EMPLOYEES_LEFT: "down",
  EMPLOYEE_TURNOVER_RATE: "down",
  PARENTAL_LEAVE_RETURN_RATE: "up",
  WELLBEING_SPEND_SHARE: "up",
  LOST_TIME_INJURIES: "down",
  LTIFR: "down",
  RECORDABLE_INJURIES: "down",
  HIGH_CONSEQUENCE_INJURIES: "down",
  FATALITIES: "down",
  DAYS_LOST: "down",
  SAFETY_COMPLAINTS: "down",
  TRAINING_HOURS_AVG: "up",
  EMPLOYEES_TRAINED_HS_SHARE: "up",
  PERFORMANCE_REVIEW_SHARE: "up",
  EMPLOYEES_TRAINED_HR_SHARE: "up",
  WOMEN_IN_WORKFORCE: "up",
  WOMEN_ON_BOARD: "up",
  WOMEN_IN_MANAGEMENT: "up",
  EMPLOYEES_BY_AGE: null,
  GENDER_PAY_GAP: "down",
  FEMALE_WAGES_SHARE: "up",
  MEDIAN_REMUNERATION: null,
  PAY_RATIO_TOP_MEDIAN: "down",
  MIN_WAGE_SHARE: "up",
  COMPLAINTS_RECEIVED: "down",
  COMPLAINTS_RESOLVED: "up",
  POSH_COMPLAINTS: "down",
  BOARD_INDEPENDENCE: "up",
  CORRUPTION_INCIDENTS: "down",
  ANTI_CORRUPTION_TRAINING_SHARE: "up",
  FINES_PAID: "down",
  // More concerns raised can mean people trust the channel; neither way is good on its own.
  ETHICS_CONCERNS: null,
  DAYS_PAYABLE: "down",
  DATA_BREACHES: "down",
};

/**
 * Which way is good for a KPI: the table above for library KPIs; a company's
 * own KPI follows its target (reduce → down, increase → up), else null.
 */
export const directionGood = (code: string, targetDirection?: TargetDirection | null): DirectionGood => {
  if (Object.prototype.hasOwnProperty.call(DIRECTION_GOOD, code)) return DIRECTION_GOOD[code];
  if (targetDirection === "reduce") return "down";
  if (targetDirection === "increase") return "up";
  return null;
};

/** Whether a change reads as good: down for "down", up for "up"; never for a neutral KPI or no change. */
export const isGood = (direction: DirectionGood, changePct: number): boolean =>
  direction === "down" ? changePct < 0 : direction === "up" ? changePct > 0 : false;
