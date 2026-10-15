/**
 * S3-2 · the factor metadata backfill rules (migrate:scope3-factor-meta),
 * kept pure so they are unit-tested. They only read what a factor already
 * has: its category's name and scope, its unit and its free-text source.
 *
 * The type keys are literals on purpose: a migration is a historical snapshot
 * and must keep producing the same values if the enum later changes.
 */

export type FactorRowForBackfill = {
  category_name: string | null;
  scope: string | null;
  denominator_unit: string | null;
  source: string | null;
};

export type BackfilledMeta = {
  factor_type: string;
  includes_wtt: boolean;
  gwp_set: string | null;
  dataset: string | null;
};

/** Units that are an amount of money (currency rows of emissionWrite/units.ts, plus the ones the form offers). */
const CURRENCY_UNITS = new Set(["inr", "usd", "eur", "gbp", "aed", "sar", "bhd", "qar", "omr", "kwd", "jpy", "cny", "aud", "cad", "chf", "sgd"]);

/** "Scope 3", "scope3", "S3", "Scope-3" → 3. */
export function scopeNumber(scope: string | null): 1 | 2 | 3 | null {
  const m = /^\s*s(?:cope)?[\s_-]*([123])\s*$/i.exec(scope ?? "");
  return m ? (Number(m[1]) as 1 | 2 | 3) : null;
}

// Scope 3 category names → GHG Protocol number. The default category names
// (src/utils/defaultExtraFields.ts) plus the guidance's own wording.
const GHG_NAME_RULES: [RegExp, number][] = [
  [/purchased goods|goods and services/, 1],
  [/capital goods/, 2],
  [/fuel[- ]and[- ]energy|energy[- ]related/, 3],
  [/upstream transport|inbound (logistics|freight)/, 4],
  [/waste/, 5],
  [/business travel/, 6],
  [/commut/, 7],
  [/upstream leased/, 8],
  [/downstream transport|outbound (logistics|freight)/, 9],
  [/processing of sold/, 10],
  [/use of sold/, 11],
  [/end[- ]of[- ]life/, 12],
  [/downstream leased/, 13],
  [/franchis/, 14],
  [/investment/, 15],
];

export function ghgNumberFromName(name: string | null): number | null {
  const n = (name ?? "").toLowerCase();
  for (const [re, num] of GHG_NAME_RULES) if (re.test(n)) return num;
  return null;
}

export function factorTypeFor(row: FactorRowForBackfill): string {
  const name = (row.category_name ?? "").trim().toLowerCase();
  // FERA categories ("FERA", "FERA stationary combustion", ...) hold the WTT twin factors.
  if (/^fera\b/.test(name)) return "wtt";
  const scope = scopeNumber(row.scope);
  if (scope === 1 || scope === 2) return "combustion";
  const ghg = ghgNumberFromName(name);
  if (ghg === null) return "other";
  if (ghg === 1 || ghg === 2) {
    const unit = (row.denominator_unit ?? "").trim().toLowerCase();
    return CURRENCY_UNITS.has(unit) ? "eeio_spend" : "cradle_to_gate";
  }
  if ([4, 6, 7, 9].includes(ghg)) return "life_cycle";
  return "other";
}

/** The source text says WTT is included or summed in ("DEFRA freighting goods + WTT, summed"). */
export function includesWtt(source: string | null): boolean {
  const s = source ?? "";
  return /\bwtt\b|well[\s-]*to[\s-]*tank/i.test(s) && /includ|\bincl\b|summed|\bsum\b|\+|\bplus\b/i.test(s);
}

export function gwpSetFrom(source: string | null): string | null {
  const m = /\bAR\s*([456])\b/i.exec(source ?? "");
  return m ? `AR${m[1]}` : null;
}

const DATASET_RULES: [RegExp, string][] = [
  [/\bdefra\b|\bdesnz\b|\bbeis\b/i, "DEFRA"],
  [/\biea\b/i, "IEA"],
  [/\bipcc\b/i, "IPCC"],
  [/\bepa\b|\buseeio\b/i, "EPA"],
  [/ecoinvent/i, "ecoinvent"],
];

export function datasetFrom(source: string | null): string | null {
  for (const [re, name] of DATASET_RULES) if (re.test(source ?? "")) return name;
  return null;
}

export function backfillMeta(row: FactorRowForBackfill): BackfilledMeta {
  return {
    factor_type: factorTypeFor(row),
    includes_wtt: includesWtt(row.source),
    gwp_set: gwpSetFrom(row.source),
    dataset: datasetFrom(row.source),
  };
}
