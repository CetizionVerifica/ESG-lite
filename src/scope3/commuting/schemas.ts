/**
 * STAND-IN for `CommutingSurveyBodySchema` and `COMMUTING_SURVEY_MAX_RESPONSES`
 * in src/scope3/contracts/schemas.ts, which the S3-0 follow-up PR
 * (ESG-lite #144) adds. Same shape, field for field. When #144 merges, import
 * them from `../contracts/schemas` and delete this file.
 */
import { z } from "zod";

const id = z.number().int().positive();
const year = z.number().int().min(1990).max(2100);
const nonNegative = z.number().min(0);
const text = (max = 2000) => z.string().trim().min(1).max(max);
const yearType = z.enum(["CY", "FY"]);

export const COMMUTING_SURVEY_MAX_RESPONSES = 20_000;

/** `POST /scope3/commuting/surveys`: `ref` is the client's own code, never a name; responses are not stored. */
export const CommutingSurveyBodySchema = z.object({
  site_id: id,
  year,
  year_type: yearType,
  total_employees: z.number().int().positive(),
  responses: z
    .array(
      z.object({
        ref: z.string().max(100),
        mode: text(100),
        one_way_km: nonNegative,
        days_per_week: z.number().min(0).max(7),
        weeks_per_year: z.number().min(0).max(53),
      }),
    )
    .min(1)
    .max(COMMUTING_SURVEY_MAX_RESPONSES),
});
export type CommutingSurveyBody = z.infer<typeof CommutingSurveyBodySchema>;
