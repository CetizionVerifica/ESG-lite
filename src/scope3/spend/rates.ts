/**
 * S3-5 · the stored rates and deflators a spend row uses, read once per plan
 * (a SpendRateSource lives on the ContextCache). The engine itself stays
 * pure: SpendRateSource.quote loads what it needs and hands it over on the row.
 *
 *   rate     fx_rate on the spend date, or the nearest earlier day within 7
 *            days; otherwise the latest stored rate (FX_RATE_FALLBACK); a USD
 *            peg when nothing is stored for AED, SAR or BHD; the live service
 *            (FX_RATE_FALLBACK) when nothing is stored at all yet.
 *   deflator price_deflator for the country of the factor's currency, at the
 *            factor's price base year and the spend year (NO_DEFLATOR when
 *            either is missing).
 */
import type { EntityManager } from "typeorm";
import type { EmissionFactor } from "../../entities/EmissionFactor";
import { getUsdRate } from "../../services/fxRate";
import { DEFLATOR_COUNTRY, USD_PEGS, supportedCurrency, type SupportedCurrency } from "./currencies";
import type { DeflatorUsed, EmissionFx, SpendQuote } from "./types";
import type { SpendInput } from "./inputs";

/** Look back this many days for a stored rate before falling back to the latest one. */
export const FX_LOOKBACK_DAYS = 7;

export interface UsdRate {
  /** Units of the currency per 1 USD. */
  per_usd: number;
  date: string;
  source: string;
  fallback: boolean;
}

export type QuoteResult =
  | { ok: true; quote: SpendQuote }
  | { ok: false; code: "CURRENCY_NOT_SUPPORTED" | "FIELD_INVALID"; message: string; field: "currency" | "emission_category" };

/** The factor's currency: its price currency, or its unit when that is a currency ("USD"). */
export const factorCurrency = (factor: Pick<EmissionFactor, "price_currency" | "denominator_unit">): SupportedCurrency | null =>
  supportedCurrency(factor.price_currency) ?? supportedCurrency(factor.denominator_unit);

const day = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export class SpendRateSource {
  private readonly rates = new Map<string, Promise<UsdRate | null>>();
  private readonly indexes = new Map<string, Promise<{ index: number; source: string } | null>>();

  constructor(private readonly manager: EntityManager) {}

  /** Units of `currency` per 1 USD for `date` (memoised per plan). */
  usdRate(currency: SupportedCurrency, date: string): Promise<UsdRate | null> {
    const key = `${currency}:${date}`;
    let p = this.rates.get(key);
    if (!p) {
      p = this.loadRate(currency, date);
      this.rates.set(key, p);
    }
    return p;
  }

  private async loadRate(currency: SupportedCurrency, date: string): Promise<UsdRate | null> {
    if (currency === "USD") return { per_usd: 1, date, source: "same currency", fallback: false };
    const near = await this.query<{ rate: string; date: string; source: string }>(
      `SELECT rate_to_usd AS rate, date::text AS date, source FROM fx_rate
        WHERE currency = $1 AND date <= $2::date AND date >= $2::date - $3::int
        ORDER BY date DESC LIMIT 1`,
      [currency, date, FX_LOOKBACK_DAYS],
    );
    if (near) return { per_usd: Number(near.rate), date: day(near.date), source: near.source, fallback: false };
    const peg = USD_PEGS[currency as keyof typeof USD_PEGS];
    if (peg) return { per_usd: peg, date, source: "peg", fallback: false };
    const latest = await this.query<{ rate: string; date: string; source: string }>(
      `SELECT rate_to_usd AS rate, date::text AS date, source FROM fx_rate WHERE currency = $1 ORDER BY date DESC LIMIT 1`,
      [currency],
    );
    if (latest) return { per_usd: Number(latest.rate), date: day(latest.date), source: latest.source, fallback: true };
    // Nothing stored yet (a new deploy before the first job run): today's live rate, flagged.
    try {
      const live = await getUsdRate(currency);
      return { per_usd: live.rate, date: day(live.asOf && !Number.isNaN(Date.parse(live.asOf)) ? new Date(live.asOf) : new Date()), source: live.source === "live" ? "live" : `live service ${live.source}`, fallback: true };
    } catch {
      return null;
    }
  }

  /** The price index of `country` in `year`, or null. */
  deflatorIndex(country: string, year: number): Promise<{ index: number; source: string } | null> {
    const key = `${country}:${year}`;
    let p = this.indexes.get(key);
    if (!p) {
      p = this.query<{ index: string; source: string }>(`SELECT "index", source FROM price_deflator WHERE country = $1 AND year = $2`, [country, year]).then((r) =>
        r ? { index: Number(r.index), source: r.source } : null,
      );
      this.indexes.set(key, p);
    }
    return p;
  }

  private async query<T>(sql: string, params: unknown[]): Promise<T | null> {
    try {
      const rows: T[] = await this.manager.query(sql, params);
      return rows[0] ?? null;
    } catch (err) {
      // fx_rate / price_deflator not migrated yet: behave as if empty. Ids and codes only in logs.
      console.warn("[spend] rate lookup failed:", (err as { code?: string })?.code ?? (err as Error)?.name);
      return null;
    }
  }

  /**
   * Everything the spend method needs for one row, or why it can't be
   * calculated. `stored` is the row's saved `fx`: a recalculation with the same
   * currencies and purchase date reuses that rate, never today's.
   */
  async quote(input: SpendInput, factor: EmissionFactor, stored?: EmissionFx | null): Promise<QuoteResult> {
    const from = supportedCurrency(input.currency);
    if (!from) {
      return { ok: false, code: "CURRENCY_NOT_SUPPORTED", field: "currency", message: `${input.currency || "This currency"} can't be converted yet. Use one of the currencies in the list.` };
    }
    const to = factorCurrency(factor);
    if (!to) {
      // A spend (EEIO) factor in a currency ESGLite doesn't convert, or a factor per kg chosen for an amount spent.
      return factor.factor_type === "eeio_spend" || factor.price_currency
        ? {
            ok: false,
            code: "CURRENCY_NOT_SUPPORTED",
            field: "currency",
            message: `The spend factor "${factor.emission_category_name}" is per ${factor.price_currency || factor.denominator_unit}, which can't be converted yet.`,
          }
        : {
            ok: false,
            code: "FIELD_INVALID",
            field: "emission_category",
            message: `"${factor.emission_category_name}" is a factor per ${factor.denominator_unit || "unit"}, not per amount spent. Choose a spend factor for this row.`,
          };
    }
    let rate = 1;
    let as_of = input.spend_date;
    let source = "same currency";
    let fallback = false;
    if (stored && stored.currency === from && stored.to === to && stored.spend_date === input.spend_date && Number(stored.rate) > 0) {
      rate = Number(stored.rate);
      as_of = stored.as_of;
      source = stored.source;
    } else if (from !== to) {
      const [a, b] = await Promise.all([this.usdRate(from, input.spend_date), this.usdRate(to, input.spend_date)]);
      if (!a || !b) return { ok: false, code: "CURRENCY_NOT_SUPPORTED", field: "currency", message: `No exchange rate is stored for ${!a ? from : to} yet.` };
      rate = b.per_usd / a.per_usd; // 1 `from` = 1/a USD = b/a `to`
      // The older of the two days is the one the conversion can be reproduced from.
      as_of = from === "USD" ? b.date : to === "USD" ? a.date : a.date < b.date ? a.date : b.date;
      source = from === "USD" ? b.source : to === "USD" ? a.source : a.source === b.source ? a.source : `${a.source} / ${b.source}`;
      fallback = a.fallback || b.fallback;
    }

    let deflator: DeflatorUsed | null = null;
    let noDeflator = false;
    const base = factor.price_base_year;
    const spendYear = Number(input.spend_date.slice(0, 4));
    if (base != null && base !== spendYear) {
      const country = DEFLATOR_COUNTRY[to];
      const [bi, si] = await Promise.all([this.deflatorIndex(country, base), this.deflatorIndex(country, spendYear)]);
      if (bi && si && si.index > 0) {
        deflator = { country, base_year: base, spend_year: spendYear, base_index: bi.index, spend_index: si.index, source: si.source };
      } else {
        noDeflator = true;
      }
    }
    return {
      ok: true,
      quote: { amount: input.amount, amount_from: input.amount_from, spend_date: input.spend_date, fx: { currency: from, to, rate, as_of, source, spend_date: input.spend_date }, fallback, deflator, noDeflator },
    };
  }
}
