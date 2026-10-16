/**
 * S3-5 · shapes shared by the spend inputs (rates.ts), the engine method
 * (emissionWrite/methods/spend.ts) and the stored row (`emission.fx`).
 */

/** `emission.fx` (01-contracts.md §4, `FxSchema` plus `to`). 1 `currency` = `rate` `to`, on `as_of`. */
export interface EmissionFx {
  currency: string;
  /** The factor's currency the amount was converted into. */
  to: string;
  rate: number;
  /** The date of the rate used (YYYY-MM-DD): the spend date, or the nearest earlier stored day. */
  as_of: string;
  /** Where the rate came from: `ecb`, `open.er-api.com`, `peg`, `same currency`, `live` (no stored rate yet). */
  source: string;
  /** The purchase date the rate was looked up for; a recalculation with the same currency and date reuses this rate. */
  spend_date?: string;
}

/** The deflator a spend row used, kept in its factor snapshot. index[base_year] ÷ index[spend_year]. */
export interface DeflatorUsed {
  country: string;
  base_year: number;
  spend_year: number;
  base_index: number;
  spend_index: number;
  source: string;
}

/**
 * Everything the spend method needs that comes from the database, loaded by
 * SpendRateSource.quote before the (pure) engine runs.
 */
export interface SpendQuote {
  /** The amount spent, in `fx.currency`. */
  amount: number;
  /** Where the amount came from; a `quantity` on a form with a calculation spec is the spec's product (Category 15 revenue × share × equity). */
  amount_from?: "spent_value" | "quantity";
  /** The purchase date the rate is for (YYYY-MM-DD). */
  spend_date: string;
  fx: EmissionFx;
  /** No stored rate within 7 days before the spend date: the latest one was used (FX_RATE_FALLBACK). */
  fallback: boolean;
  deflator: DeflatorUsed | null;
  /** The factor has a price base year but one of the two indexes is missing (NO_DEFLATOR). */
  noDeflator: boolean;
}
