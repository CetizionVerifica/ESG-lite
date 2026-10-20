/**
 * Design Studio contracts (DS-0) §6: check ids, default severities and the
 * kinds they apply to. DS-12 runs them (`POST /studio/docs/:id/checks`).
 *
 * RS checks stay (rs-base/01-contracts §6), with YEAR_NOT_LOCKED for the
 * sustainability kind only; the GHG kind adds its own. Severities are the
 * defaults; D8 decides which ISO 14064-1 checks become errors when ISO
 * conformance is selected (`ISO_ESCALATION`).
 */
import { z } from "zod";
import { CheckSeveritySchema, type CheckSeverity, type ReportKind } from "./enums";

export const RS_CHECK_IDS = [
  "YEAR_NOT_LOCKED",
  "VALUES_MISSING",
  "NUMBER_MISMATCH",
  "NUMBER_UNBOUND",
  "TEXT_OVERFLOW",
  "OUTSIDE_SAFE_AREA",
  "OVERLAPS_LOCKED",
  "FONT_TOO_SMALL",
  "LOW_CONTRAST",
  "EMPTY_PLACEHOLDER",
  "MISSING_ALT",
  "AI_UNREVIEWED",
  "LEADERSHIP_UNCONFIRMED",
  "DATA_CHANGED",
] as const;

export const GHG_CHECK_IDS = [
  "GHG_PENDING_ENTRIES",
  "GHG_SITES_MISSING",
  "GHG_MONTHS_MISSING",
  "CONSOLIDATION_MISSING",
  "PERIOD_MISSING",
  "BASE_YEAR_MISSING",
  "RECALC_POLICY_MISSING",
  "SCOPE2_MARKET_MISSING",
  "GAS_BREAKDOWN_MISSING",
  "BIOGENIC_IN_SCOPE",
  "BIOGENIC_NOT_SHOWN",
  "SCOPE3_CATEGORY_UNADDRESSED",
  "EXCLUSION_NO_REASON",
  "SCOPE3_DQ_MISSING",
  "EF_SOURCE_MISSING",
  "GWP_MIXED",
  "RESPONSIBLE_PERSON_MISSING",
  "UNCERTAINTY_MISSING",
  "VERIFICATION_STATEMENT_MISSING",
  "INTENSITY_MISSING",
  "TOTAL_MISMATCH",
  "YOY_UNEXPLAINED",
  "UNLINKED_DATA",
] as const;

/** DS-10: text Resize cut to fit a slot (info; the copy's build.resize.truncated lists them). */
export const RESIZE_CHECK_IDS = ["TEXT_TRUNCATED"] as const; // DS-10

export const CHECK_IDS = [...RS_CHECK_IDS, ...GHG_CHECK_IDS, ...RESIZE_CHECK_IDS] as const;
export const CheckIdSchema = z.enum(CHECK_IDS);
export type CheckId = z.infer<typeof CheckIdSchema>;

export interface CheckRule {
  severity: CheckSeverity;
  kinds: readonly ReportKind[];
  /** True when the error blocks only a final (not a proof). */
  finalOnly?: boolean;
}

const BOTH: readonly ReportKind[] = ["ghg", "sustainability"];
const GHG: readonly ReportKind[] = ["ghg"];
const SUS: readonly ReportKind[] = ["sustainability"];

export const CHECK_RULES: Record<CheckId, CheckRule> = {
  YEAR_NOT_LOCKED: { severity: "error", kinds: SUS, finalOnly: true },
  VALUES_MISSING: { severity: "warning", kinds: BOTH },
  NUMBER_MISMATCH: { severity: "error", kinds: BOTH },
  NUMBER_UNBOUND: { severity: "info", kinds: BOTH },
  TEXT_OVERFLOW: { severity: "error", kinds: BOTH },
  OUTSIDE_SAFE_AREA: { severity: "error", kinds: BOTH },
  OVERLAPS_LOCKED: { severity: "warning", kinds: BOTH },
  FONT_TOO_SMALL: { severity: "error", kinds: BOTH },
  // Error, or warning when the background is an image (RS §6).
  LOW_CONTRAST: { severity: "error", kinds: BOTH },
  EMPTY_PLACEHOLDER: { severity: "error", kinds: BOTH },
  MISSING_ALT: { severity: "warning", kinds: BOTH },
  AI_UNREVIEWED: { severity: "warning", kinds: BOTH },
  LEADERSHIP_UNCONFIRMED: { severity: "error", kinds: SUS },
  DATA_CHANGED: { severity: "warning", kinds: BOTH },
  GHG_PENDING_ENTRIES: { severity: "error", kinds: GHG, finalOnly: true },
  GHG_SITES_MISSING: { severity: "warning", kinds: GHG },
  GHG_MONTHS_MISSING: { severity: "warning", kinds: GHG },
  CONSOLIDATION_MISSING: { severity: "error", kinds: GHG },
  PERIOD_MISSING: { severity: "error", kinds: GHG },
  BASE_YEAR_MISSING: { severity: "warning", kinds: GHG },
  RECALC_POLICY_MISSING: { severity: "warning", kinds: GHG },
  SCOPE2_MARKET_MISSING: { severity: "warning", kinds: GHG },
  GAS_BREAKDOWN_MISSING: { severity: "warning", kinds: GHG },
  BIOGENIC_IN_SCOPE: { severity: "error", kinds: GHG },
  BIOGENIC_NOT_SHOWN: { severity: "warning", kinds: GHG },
  SCOPE3_CATEGORY_UNADDRESSED: { severity: "error", kinds: GHG },
  EXCLUSION_NO_REASON: { severity: "error", kinds: GHG },
  SCOPE3_DQ_MISSING: { severity: "warning", kinds: GHG },
  EF_SOURCE_MISSING: { severity: "error", kinds: GHG },
  GWP_MIXED: { severity: "warning", kinds: GHG },
  RESPONSIBLE_PERSON_MISSING: { severity: "warning", kinds: GHG },
  UNCERTAINTY_MISSING: { severity: "info", kinds: GHG },
  VERIFICATION_STATEMENT_MISSING: { severity: "warning", kinds: GHG },
  INTENSITY_MISSING: { severity: "warning", kinds: GHG },
  TOTAL_MISMATCH: { severity: "error", kinds: GHG },
  YOY_UNEXPLAINED: { severity: "info", kinds: GHG },
  UNLINKED_DATA: { severity: "info", kinds: BOTH },
  TEXT_TRUNCATED: { severity: "info", kinds: BOTH }, // DS-10
};

/** D8: with ISO 14064-1 conformance selected these move up one step. */
export const ISO_ESCALATION: Partial<Record<CheckId, CheckSeverity>> = {
  RESPONSIBLE_PERSON_MISSING: "error",
  UNCERTAINTY_MISSING: "warning",
};

export const checksFor = (kind: ReportKind): CheckId[] => CHECK_IDS.filter((id) => CHECK_RULES[id].kinds.includes(kind));

export const CHECK_FIXES = [
  "replace_with_token",
  "shrink_text",
  "move_inside",
  "open_values",
  "open_inputs",
  // DS-12: GHG fixes (DS-12 spec "Fix actions") and links.
  "mark_excluded", // opens the exclusion input for a Scope 3 category (details.category), with an AI draft when DS-9 is on
  "open_pending", // Review, filtered to the period (details.link)
  "add_market_note", // inserts the market-based Scope 2 "Not reported" row
  "add_gas_chart", // inserts a gas_split chart
  "add_biogenic", // inserts a biogenic CO₂ figure, reported separately
  "add_factor_table", // inserts the emission factors section
  "open_link", // any other app page that fixes it (details.link: sites, months, Scope 3 screening, KPI review)
] as const;
export const CheckFixSchema = z.enum(CHECK_FIXES);

/** `Check { id, severity, pageId?, elementId?, message, details?, fix? }` (RS §6). */
export const CheckSchema = z
  .object({
    id: CheckIdSchema,
    severity: CheckSeveritySchema,
    pageId: z.string().optional(),
    elementId: z.string().optional(),
    message: z.string(),
    details: z.unknown().optional(),
    fix: CheckFixSchema.optional(),
  })
  .strict();
export type Check = z.infer<typeof CheckSchema>;

// ---------------------------------------------------------------------------
// DS-12 · POST /docs/:id/checks and the final gate
// ---------------------------------------------------------------------------

/** One element's browser measurement (render/measure.ts `Measurement`), as the editor sends it. */
export const MeasurementSchema = z
  .object({
    pageId: z.string().max(120),
    elementId: z.string().max(120),
    type: z.string().max(40),
    rectMm: z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().finite(), h: z.number().finite() }).strict(),
    overflowMm: z.number().finite().min(0),
    outsideSafe: z.boolean(),
    outsidePage: z.boolean(),
    minFontPt: z.number().finite().nullable(),
    contrast: z.number().finite().nullable(),
    onImage: z.boolean(),
    bleed: z.boolean(),
  })
  .strict();
export type MeasurementInput = z.infer<typeof MeasurementSchema>;

/** `{rev, measurements?}`: measurements (the editor's live ones) are used for the live view only. */
export const ChecksBodySchema = z
  .object({
    rev: z.number().int().min(0),
    measurements: z.array(MeasurementSchema).max(10000).optional(),
    company_id: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

export interface ChecksResponse {
  checks: Check[];
  /** True while an error check is open: a final is refused (warnings only need acknowledging). */
  blocking: boolean;
  /** The check ids a final needs in `acknowledgedWarnings`. */
  warnings: CheckId[];
  /** Where the layout checks came from: the editor's live measuring, the last render at this rev, or none yet. */
  layout: "live" | "render" | "none";
  rev: number;
}

/** The rank the panel and the gate sort by: errors, warnings, info; GHG_PENDING_ENTRIES first. */
export const SEVERITY_RANK: Record<CheckSeverity, number> = { error: 0, warning: 1, info: 2 };
