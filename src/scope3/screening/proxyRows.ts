/**
 * S3-12 · `emission.proxy` for rows made from a sample: the S3-9 commuting
 * survey (`extra_data.survey`, basis `sample`). Pure, no database, so the
 * engine (emissionWrite/index.ts) can use it on commit and the backfill
 * (migrate:scope3-screening) writes the same shape for older rows.
 */
import type { Proxy } from "../contracts/schemas";
import { METHOD_KEYS, type Method } from "../contracts/ghgCategory";

/** The survey scaling an S3-9 row carries in `extra_data.survey`. */
export interface SurveyScaling {
  basis?: string;
  respondents?: number;
  total_employees?: number;
  coverage_pct?: number;
}

/** A respondents share in (0, 100], or undefined when the survey doesn't give a usable one. */
const share = (s: SurveyScaling): number | undefined => {
  const direct = Number(s.coverage_pct);
  if (Number.isFinite(direct) && direct > 0) return Math.min(100, Math.round(direct * 100) / 100);
  const r = Number(s.respondents);
  const t = Number(s.total_employees);
  if (r > 0 && t > 0) return Math.min(100, Math.round((r / t) * 10000) / 100);
  return undefined;
};

/** `{basis: "sample", coverage_pct, from: []}` for a survey-scaled row. */
export function surveyProxy(survey: SurveyScaling): Proxy {
  const pct = share(survey);
  return pct === undefined ? { basis: "sample", from: [] } : { basis: "sample", coverage_pct: pct, from: [] };
}

/**
 * The backfill as one idempotent statement for a batch of up to `batch` rows:
 * rows with `extra_data.survey` and no `proxy` get `{basis: "sample", coverage_pct, from: []}`
 * (coverage_pct from the survey, kept within (0, 100]; left out when the survey has none).
 * Returns the number of rows updated per run; run until 0.
 */
export const SURVEY_BACKFILL_SQL = (batch: number) => `
  UPDATE emission e
     SET proxy = jsonb_strip_nulls(jsonb_build_object(
           'basis', 'sample',
           'coverage_pct', CASE
             WHEN (e.extra_data -> 'survey' ->> 'coverage_pct') ~ '^[0-9]+(\\.[0-9]+)?$'
                  AND (e.extra_data -> 'survey' ->> 'coverage_pct')::numeric > 0
               THEN to_jsonb(LEAST(100, ROUND((e.extra_data -> 'survey' ->> 'coverage_pct')::numeric, 2)))
           END,
           'from', '[]'::jsonb))
   WHERE e.pk_id IN (
           SELECT pk_id FROM emission
            WHERE proxy IS NULL AND extra_data ? 'survey' AND jsonb_typeof(extra_data -> 'survey') = 'object'
            ORDER BY pk_id
            LIMIT ${Math.max(1, Math.floor(batch))})`;

/** The most common source method; ties go to the more specific (earlier) method key. */
export function commonMethod(methods: (string | null)[]): Method | null {
  const counts = new Map<Method, number>();
  for (const m of methods) if (m && (METHOD_KEYS as readonly string[]).includes(m) && m !== "unknown") counts.set(m as Method, (counts.get(m as Method) ?? 0) + 1);
  let best: Method | null = null;
  for (const [m, n] of counts) {
    const bn = best ? counts.get(best)! : -1;
    if (n > bn || (n === bn && METHOD_KEYS.indexOf(m) < METHOD_KEYS.indexOf(best!))) best = m;
  }
  return best;
}
