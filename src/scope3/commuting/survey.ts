/**
 * S3-9 · the yearly commuting survey → one import plan per site and year.
 *
 *   GET  /scope3/commuting/sites    the caller's sites with Category 7
 *   POST /scope3/commuting/surveys
 *     {site_id, year, year_type, total_employees, responses: [{ref, mode, one_way_km, days_per_week, weeks_per_year}]}
 *
 * For each mode it sums one_way_km × 2 × days_per_week × weeks_per_year over
 * the responses (formula 7.1, L4426-4440) and plans one yearly Category 7 row
 * with the distance_based fields: Total distance (km), Total employees and
 * Employees surveyed (the distinct refs). The engine scales and multiplies
 * (calculationSpec `divide`); nothing here applies a factor. The plan goes
 * through the normal plan → commit review (channel Bulk upload).
 *
 * Responses are not stored: the plan rows carry per-mode sums and counts only,
 * plus `survey` (→ extra_data.survey, S3-12 backfills emission.proxy from it).
 * Refs and modes are never logged.
 */
import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import { accessibleSiteIds } from "../../utils/companyScope";
import { createPlan } from "../../imports/plans/service";
import type { TokenUser } from "../../imports/plans/scope";
import type { ImportRow } from "../../imports/contracts";
import { toStoredPeriod } from "../../services/emissionWrite/period";
import { ROW_METHOD_COLUMN } from "../../services/calculationSpec";
import { BoundaryError } from "../boundary/errors";
import { COL_SURVEYED, COL_TOTAL_DISTANCE, COL_TOTAL_EMPLOYEES, COMMUTE_OPTIONS, unitOfOption } from "./configs";
import { ensureTravelForm } from "./forms";
import { CommutingSurveyBodySchema, type CommutingSurveyBody } from "./schemas";

// ── Mode matching ────────────────────────────────────────────────────────────
/** Survey wording → the Category 7 form's mode label. Fuel options are not survey modes. */
const MODE_ALIASES: Array<[RegExp, string]> = [
  [/^(walk(ing)?|on foot|foot|bicycle|bike|cycle|cycling|push ?bike)$/, ""], // zero emission
  [/^(underground|metro|subway|tube)$/, "Underground or metro [passenger.km]"],
  [/^(tram|light rail)$/, "Light rail and tram [passenger.km]"],
  [/^(rail|train|national rail|local train)$/, "Rail [passenger.km]"],
  [/^(bus|local bus)$/, "Bus [passenger.km]"],
  [/^coach$/, "Coach [passenger.km]"],
  [/^(car|drive|driving|car \(unknown fuel\)|car, unknown fuel)$/, "Car, unknown fuel [vehicle.km]"],
  [/^(petrol car|car, petrol|car \(petrol\))$/, "Car, petrol [vehicle.km]"],
  [/^(diesel car|car, diesel|car \(diesel\))$/, "Car, diesel [vehicle.km]"],
  [/^(hybrid car|car, hybrid|car \(hybrid\)|hybrid)$/, "Car, hybrid [vehicle.km]"],
  [/^(electric car|ev|battery electric car|car, electric|car, battery electric|car \(electric\))$/, "Car, battery electric [vehicle.km]"],
  [/^(motorbike|motorcycle|scooter|moped)$/, "Motorbike [vehicle.km]"],
  [/^(taxi|cab)$/, "Taxi [passenger.km]"],
];

const SURVEY_LABELS = Object.keys(COMMUTE_OPTIONS).filter((l) => unitOfOption(l) !== "litre");

export type ModeMatch = { kind: "mode"; label: string } | { kind: "zero" } | { kind: "unknown"; label: string };

/** A survey answer's mode → a form label, a zero-emission mode (walking, cycling), or unknown (kept as written). */
export function matchMode(raw: string): ModeMatch {
  const text = raw.trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const exact = SURVEY_LABELS.find((l) => l.toLowerCase() === lower || l.replace(/\s*\[[^\]]+\]\s*$/, "").toLowerCase() === lower);
  if (exact) return { kind: "mode", label: exact };
  for (const [re, label] of MODE_ALIASES) if (re.test(lower)) return label ? { kind: "mode", label } : { kind: "zero" };
  return { kind: "unknown", label: text };
}

// ── Aggregation (pure) ───────────────────────────────────────────────────────
export interface ModeSum {
  /** The form's mode label (or the survey wording when it matched none). */
  mode: string;
  matched: boolean;
  /** Distinct refs that use this mode. */
  respondents: number;
  /** Σ one_way_km × 2 × days_per_week × weeks_per_year over the sample. */
  total_km: number;
  unit: string | null;
}

export interface SurveySummary {
  /** Distinct refs in the survey (every mode, zero-emission ones included). */
  respondents: number;
  total_employees: number;
  /** total_employees ÷ respondents: what the engine scales each mode's distance by. */
  scale: number;
  coverage_pct: number;
  modes: ModeSum[];
  /** Modes with no row: walking and cycling (factor 0, L4542-4581), or no distance at all. */
  skipped: Array<{ mode: string; reason: "zero_emission" | "no_distance"; respondents: number }>;
}

const round = (n: number, dp = 6) => Number(n.toFixed(dp));

export function summariseSurvey(body: Pick<CommutingSurveyBody, "total_employees" | "responses">): SurveySummary {
  const refs = new Set<string>();
  const byMode = new Map<string, { matched: boolean; refs: Set<string>; km: number }>();
  const zero = new Map<string, Set<string>>();
  body.responses.forEach((r, i) => {
    // An empty ref still counts as one respondent (its own position).
    const ref = r.ref.trim() || `#${i + 1}`;
    refs.add(ref);
    const match = matchMode(r.mode);
    if (match.kind === "zero") {
      const key = r.mode.trim();
      zero.set(key, (zero.get(key) ?? new Set()).add(ref));
      return;
    }
    const entry = byMode.get(match.label) ?? { matched: match.kind === "mode", refs: new Set<string>(), km: 0 };
    entry.refs.add(ref);
    entry.km += r.one_way_km * 2 * r.days_per_week * r.weeks_per_year;
    byMode.set(match.label, entry);
  });
  const modes: ModeSum[] = [];
  const skipped: SurveySummary["skipped"] = [...zero].map(([mode, s]) => ({ mode, reason: "zero_emission" as const, respondents: s.size }));
  for (const [mode, e] of byMode) {
    if (e.km <= 0) {
      skipped.push({ mode, reason: "no_distance", respondents: e.refs.size });
      continue;
    }
    modes.push({ mode, matched: e.matched, respondents: e.refs.size, total_km: round(e.km), unit: e.matched ? unitOfOption(mode) : null });
  }
  const respondents = refs.size;
  return {
    respondents,
    total_employees: body.total_employees,
    scale: round(body.total_employees / respondents, 4),
    coverage_pct: round((respondents / body.total_employees) * 100, 2),
    modes,
    skipped,
  };
}

/** The plan rows: one yearly distance_based row per mode with a distance. */
export function surveyRows(summary: SurveySummary, site_id: number, category_id: number, period: ImportRow["period"], tag: string): ImportRow[] {
  return summary.modes.map((m, i) => ({
    row_ref: `commuting-survey-${tag}-${i + 1}`,
    site_id,
    category_id,
    period,
    activity_name: m.mode,
    // An unmatched mode keeps a placeholder unit; the plan shows it as an unknown activity to fix.
    activity_unit: m.unit ?? "passenger.km",
    fields: {
      [ROW_METHOD_COLUMN]: "distance_based",
      [COL_TOTAL_DISTANCE]: m.total_km,
      [COL_TOTAL_EMPLOYEES]: summary.total_employees,
      [COL_SURVEYED]: summary.respondents,
    },
    survey: { basis: "sample", respondents: summary.respondents, total_employees: summary.total_employees, coverage_pct: summary.coverage_pct },
  }));
}

// ── Endpoint service ─────────────────────────────────────────────────────────
const SURVEY_ROLES = new Set<string>([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN]);

/** The site's Category 7 category (lowest id when it has several). */
async function category7Of(siteId: number): Promise<number | null> {
  const rows: any[] = await AppDataSource.query(
    `SELECT c.category_id FROM category c JOIN site_categories sc ON sc.category_id = c.category_id
      WHERE sc.site_id = $1 AND c.ghg_category = 7 ORDER BY c.category_id LIMIT 1`,
    [siteId],
  );
  return rows.length ? Number(rows[0].category_id) : null;
}

/**
 * GET /scope3/commuting/sites: the caller's sites with a Category 7 category,
 * for the survey page's site picker (Manager and above; own sites only).
 */
export async function listSurveySites(companyId: number, user: TokenUser) {
  if (!SURVEY_ROLES.has(user.role)) throw new BoundaryError("SCOPE3_FORBIDDEN");
  const rows: any[] = await AppDataSource.query(
    `SELECT s.site_id, s.name, MIN(c.category_id) AS category_id
       FROM site s
       JOIN site_categories sc ON sc.site_id = s.site_id
       JOIN category c ON c.category_id = sc.category_id AND c.ghg_category = 7
      WHERE s.company_id = $1
      GROUP BY s.site_id, s.name
      ORDER BY s.name, s.site_id`,
    [companyId],
  );
  const allowed = await accessibleSiteIds(user.userId, user.role);
  return {
    company_id: companyId,
    sites: rows
      .filter((r) => !allowed || allowed.has(Number(r.site_id)))
      .map((r) => ({ site_id: Number(r.site_id), name: String(r.name), category_id: Number(r.category_id) })),
  };
}

/** Validation issues without input values (refs and modes stay out of responses' details and logs). */
const issuesOf = (issues: Array<{ path: PropertyKey[]; message: string; code: string }>) =>
  issues.slice(0, 20).map((i) => ({ field: i.path.map(String).join("."), code: i.code, message: i.message }));

export async function planSurvey(companyId: number, user: TokenUser, raw: unknown) {
  if (!SURVEY_ROLES.has(user.role)) throw new BoundaryError("SCOPE3_FORBIDDEN");
  const parsed = CommutingSurveyBodySchema.safeParse(raw ?? {});
  if (!parsed.success) throw new BoundaryError("SCOPE3_VALIDATION", { issues: issuesOf(parsed.error.issues) });
  const body = parsed.data;

  const site: any[] = await AppDataSource.query(`SELECT site_id FROM site WHERE site_id = $1 AND company_id = $2`, [body.site_id, companyId]);
  if (!site.length) throw new BoundaryError("SCOPE3_NOT_FOUND");
  const allowed = await accessibleSiteIds(user.userId, user.role);
  if (allowed && !allowed.has(body.site_id)) throw new BoundaryError("SCOPE3_NOT_FOUND");

  const category_id = await category7Of(body.site_id);
  if (category_id === null) throw new BoundaryError("SCOPE3_VALIDATION", { field: "site_id", reason: "CATEGORY_7_NOT_ASSIGNED" });
  const period = { kind: "yearly" as const, year_type: body.year_type, year: body.year };
  const stored = toStoredPeriod(period, category_id);
  if (!stored.ok) throw new BoundaryError("SCOPE3_VALIDATION", { field: "year", message: stored.message });

  const summary = summariseSurvey(body);
  if (summary.respondents > body.total_employees) {
    throw new BoundaryError("SCOPE3_VALIDATION", { field: "total_employees", reason: "FEWER_EMPLOYEES_THAN_RESPONDENTS", respondents: summary.respondents });
  }

  // The standard commuting form must be the site's form: the plan rows use its fields.
  const form = await AppDataSource.transaction((m) => ensureTravelForm(m, body.site_id, category_id, 7));
  if (form.config === "customised") throw new BoundaryError("SCOPE3_VALIDATION", { field: "site_id", reason: "COMMUTING_FORM_CUSTOMISED" });
  if (form.config === "has_entries") throw new BoundaryError("SCOPE3_VALIDATION", { field: "site_id", reason: "COMMUTING_HAS_ENTRIES" });

  const rows = surveyRows(summary, body.site_id, category_id, period, `${body.year_type}${body.year}`);
  if (!rows.length) return { plan: null, summary };
  const plan = await createPlan(
    user,
    { source_name: `Commuting survey ${body.year_type} ${body.year}`, channel: "bulk_upload", company_id: companyId, rows },
    new Set(),
  );
  return { plan, summary };
}
