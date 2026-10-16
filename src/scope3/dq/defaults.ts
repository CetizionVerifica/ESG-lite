/**
 * S3-3 · The automatic data quality of a row (01-contracts.md §3).
 *
 * Pure: everything it needs is passed in, so the engine, the import paths and
 * the frontend preview can all reach the same answer, and every rule can be
 * tested on its own (ci/unit/s3-3-dq-defaults.test.cjs).
 *
 * The shapes and `overallOf` belong to the S3-0 contracts; only the rules live
 * here. A score is 1 (good), 2 (fair) or 3 (poor), the same scale as PCF DQR
 * so the two can be compared (D2).
 */
import { overallOf, type Dq, type DqScore, type DataType } from "../contracts/dq";
import type { Method } from "../contracts/ghgCategory";

/**
 * Methods that describe the activity itself rather than an average of other
 * people's (Table III, guidance L1283-1300). §3 names supplier, site and
 * asset-specific for reliability and adds the lessor, lessee, franchise and
 * investment ones for primary data; they are the same idea, so one list.
 */
export const PRIMARY_METHODS: readonly Method[] = [
  "supplier_specific",
  "site_specific",
  "asset_specific",
  "lessor_specific",
  "lessee_specific",
  "franchise_specific",
  "investment_specific",
];

const isPrimaryMethod = (method: Method): boolean => PRIMARY_METHODS.includes(method);

/** What the factor says about itself, as the snapshot stores it (§2). */
export interface DqFactorInput {
  /** ISO-3166 alpha-2, a region code, or `GLO`. */
  geography?: string | null;
  year?: number | null;
  factor_type?: string | null;
}

export interface DqInput {
  method: Method;
  factor?: DqFactorInput | null;
  /** The site's country as an ISO-3166 alpha-2 code (`country.code`). */
  siteCountry?: string | null;
  /** The year the row is reported in, not the year the factor is from. */
  reportingYear: number;
  /** An evidence document is attached to the row. */
  hasEvidence?: boolean;
  /** The row is a screening estimate or extrapolation (S3-12). */
  isProxy?: boolean;
}

const GLOBAL = "GLO";
const clean = (value?: string | null): string => String(value ?? "").trim();

/**
 * §3: the factor's geography equal to the site country gives 1, a region 2,
 * `GLO` or missing 3.
 *
 * §3 is silent on a factor for a *different* country. That is poor geographic
 * representativeness, not a fair one, so it scores 3 — the same as having no
 * geography at all.
 */
export const geographyScore = (factorGeography?: string | null, siteCountry?: string | null): DqScore => {
  const geography = clean(factorGeography).toUpperCase();
  if (!geography || geography === GLOBAL) return 3;

  const isCountryCode = geography.length === 2;
  if (!isCountryCode) return 2; // a region code (EU-27, RER, NA…)

  const country = clean(siteCountry).toUpperCase();
  if (!country) return 3; // nothing to compare it against
  return geography === country ? 1 : 3;
};

/**
 * §3: the reporting year or the year before gives 1, within three years 2,
 * older 3. Measured as a distance, so a factor published for the year after
 * the reporting year is as good as one for the year before.
 */
export const timeScore = (factorYear?: number | null, reportingYear?: number | null): DqScore => {
  if (!factorYear || !reportingYear) return 3;
  const distance = Math.abs(reportingYear - factorYear);
  if (distance <= 1) return 1;
  if (distance <= 3) return 2;
  return 3;
};

/**
 * §3: the method's rank sets reliability — specific methods 1, hybrid and the
 * average, distance and fuel methods 2, spend 3. A row with no evidence
 * document can't score above 2.
 *
 * `unknown` is a legacy row that never recorded how it was calculated, so it
 * scores 3: we can't claim better than the worst case for it.
 */
export const reliabilityScore = (method: Method, hasEvidence?: boolean): DqScore => {
  const base: DqScore = method === "spend_based" || method === "unknown" ? 3 : isPrimaryMethod(method) ? 1 : 2;
  return hasEvidence ? base : (Math.max(base, 2) as DqScore);
};

/** §3: 1 unless the row is a proxy or an extrapolation (S3-12), which gives 3. */
export const completenessScore = (isProxy?: boolean): DqScore => (isProxy ? 3 : 1);

/**
 * Technology: §3 gives no rule for this indicator, so it follows the same
 * idea as the others — how closely the factor describes the thing that
 * actually happened. A supplier's own factor describes it exactly; a factor
 * per unit of spend describes it least.
 *
 * Listed under "Deviations" in the S3-3 PR, since the contract leaves it open.
 */
export const technologyScore = (method: Method, factorType?: string | null): DqScore => {
  const type = clean(factorType);
  if (type === "supplier" || type === "process") return 1;
  if (type === "eeio_spend") return 3;
  if (isPrimaryMethod(method)) return 1;
  if (method === "spend_based" || method === "unknown") return 3;
  return 2;
};

/**
 * §3: primary when the method is one of the specific ones, or when the
 * activity figure came from a meter, a bill or the supplier — which is what an
 * attached evidence document stands for. Otherwise secondary.
 */
export const dataTypeFor = (input: Pick<DqInput, "method" | "hasEvidence">): DataType =>
  isPrimaryMethod(input.method) || input.hasEvidence ? "primary" : "secondary";

/** The five indicators and the overall score for a row, with `source: 'auto'`. */
export const autoDq = (input: DqInput): Dq => {
  const indicators = {
    technology: technologyScore(input.method, input.factor?.factor_type),
    geography: geographyScore(input.factor?.geography, input.siteCountry),
    time: timeScore(input.factor?.year, input.reportingYear),
    completeness: completenessScore(input.isProxy),
    reliability: reliabilityScore(input.method, input.hasEvidence),
  };
  return { ...indicators, overall: overallOf(indicators), source: "auto" };
};

/**
 * The same row once an evidence document has been attached: §3 asks for
 * reliability to be recomputed and nothing else, so the total never moves.
 *
 * A data quality somebody entered by hand (`source: 'manual'`) is returned
 * untouched — attaching a file is not a reason to overwrite their judgement.
 */
export const dqWithEvidence = (dq: Dq, method: Method): Dq => {
  if (dq.source === "manual") return dq;
  const indicators = { ...dq, reliability: reliabilityScore(method, true) };
  return { ...indicators, overall: overallOf(indicators) };
};
