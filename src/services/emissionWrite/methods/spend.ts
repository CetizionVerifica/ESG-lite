/**
 * Spend-based method (S3-5, formula [1.5] of the guidance; transport [4.7]
 * and travel spend work the same way):
 *
 *   kgCO₂e = amount × rate (spend currency → factor currency, on the purchase date)
 *            × index[factor base year] ÷ index[spend year] × factor value
 *
 * Pure: the rate and the deflator come on the row (`row.spend`, loaded by
 * src/scope3/spend/rates.ts). Without them only an amount already in the
 * factor's currency can be calculated (rate 1, no deflation), as the golden
 * cases do. The tCO₂e total is rounded at the end only (never before
 * multiplying); `total_kgco2e` keeps 4 dp.
 */
import { pickActivityValue } from "../../activityValue";
import { computeSpecActivityValue } from "../../calculationSpec";
import { supportedCurrency } from "../../../scope3/spend/currencies";
import { factorCurrency } from "../../../scope3/spend/rates";
import type { SpendQuote } from "../../../scope3/spend/types";
import type { CategoryContext, ComputeResult, EngineIssue, EngineRow } from "../compute";
import * as activity from "./activity";
import * as specMethod from "./spec";

/** kg → stored tCO₂e (2 dp) and kgCO₂e (4 dp). */
const totals = (kg: number) => ({ total: Math.round((kg / 1000) * 100) / 100, total_kgco2e: (Math.round(kg * 10000) / 10000).toFixed(4) });

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 });

/** The quote a row without loaded rates can still use: an amount already in the factor's currency. */
const sameCurrencyQuote = (row: EngineRow, ctx: CategoryContext): SpendQuote | null => {
  const currency = supportedCurrency(row.activity_unit);
  const to = factorCurrency(row.factor);
  if (!currency || !to || currency !== to) return null;
  const amount = pickActivityValue(row.activity_data, ctx.selectColumns);
  return {
    amount,
    amount_from: "quantity",
    spend_date: "",
    fx: { currency, to, rate: 1, as_of: "", source: "same currency" },
    fallback: false,
    deflator: null,
    // No purchase date here (golden cases and rows without loaded rates): the amount is taken in the factor's prices.
    noDeflator: false,
  };
};

export const compute = (ctx: CategoryContext, row: EngineRow): ComputeResult => {
  const quote = row.spend ?? sameCurrencyQuote(row, ctx);
  if (!quote) {
    // No amount in a currency on the row: the factor decides as before (the activity step converts or refuses the unit).
    if (!supportedCurrency(row.activity_unit) || !factorCurrency(row.factor)) return (ctx.spec ? specMethod : activity).compute(ctx, row);
    return {
      ok: false,
      issue: { code: "CURRENCY_NOT_SUPPORTED", message: `No exchange rate from ${row.activity_unit} to ${factorCurrency(row.factor)} was loaded for this row.`, field: "currency" },
    };
  }
  const { fx, deflator } = quote;
  let amount = quote.amount;
  // A form whose fields multiply into the amount (Category 15: revenue × sector share × equity share, in the
  // currency) gives the spec's product, as the spec method writes it; an explicit amount spent is taken as entered.
  if (ctx.spec && quote.amount_from !== "spent_value") {
    const product = computeSpecActivityValue(ctx.spec, row.activity_data, row.activity_unit, row.method);
    if (product.ok) {
      amount = product.value;
      // Writes the product into activity_value on purpose, as spec.ts does (see its compute()): the stored row shows the quantity used.
      row.activity_data.activity_value = String(amount);
    }
  }
  const unit = fx.currency;
  if (!(amount > 0)) return { ok: true, computed: { activityValue: amount > 0 ? amount : 0, activity_unit: unit, total: 0, total_kgco2e: "0.0000", method: "spend_based", fx } };

  const ratio = deflator ? deflator.base_index / deflator.spend_index : 1;
  const kg = amount * fx.rate * ratio * Number(row.factor.factor_value);

  const warnings: EngineIssue[] = [];
  if (quote.fallback) {
    warnings.push({
      code: "FX_RATE_FALLBACK",
      message: `No ${fx.currency}→${fx.to} rate was stored within 7 days before ${quote.spend_date}; the rate of ${fx.as_of} was used.`,
    });
  }
  if (quote.deflatorFallback && deflator?.index_year) {
    warnings.push({
      code: "DEFLATOR_FALLBACK_YEAR",
      message: `No ${deflator.spend_year} price index is published yet; ${deflator.index_year}'s was used to bring the amount to the factor's ${deflator.base_year} prices.`,
    });
  }
  if (quote.noDeflator) {
    warnings.push({
      code: "NO_DEFLATOR",
      message: `No price index to bring ${quote.spend_date.slice(0, 4) || "this year's"} ${fx.to} to the factor's ${row.factor.price_base_year} prices; the amount was not deflated.`,
    });
  }
  return {
    ok: true,
    computed: {
      activityValue: amount,
      activity_unit: unit,
      // The factor-currency amount per unit entered, so "conversion" reads as it does for units (× rate × deflator).
      ...(fx.rate !== 1 || ratio !== 1 ? { conversion: fx.rate * ratio } : {}),
      ...totals(kg),
      // Per-gas kg (S3-4) for the factor-currency amount, the quantity the factor is per.
      ...activity.gasesFor(amount * fx.rate * ratio, row.factor),
      method: "spend_based",
      fx,
      ...(deflator ? { deflator } : {}),
      ...(warnings.length ? { warnings } : {}),
    },
  };
};

/** "INR 1,240,000 × 0.01125 = USD 13,950 × 0.42 kgCO₂e/USD": how a spend total was made, for logs and tests. */
export const describe = (quote: SpendQuote, factorValue: number): string => {
  const ratio = quote.deflator ? quote.deflator.base_index / quote.deflator.spend_index : 1;
  const converted = quote.amount * quote.fx.rate * ratio;
  return `${quote.fx.currency} ${fmt(quote.amount)} × ${fmt(quote.fx.rate * ratio)} = ${quote.fx.to} ${fmt(converted)} × ${fmt(factorValue)} kgCO₂e/${quote.fx.to}`;
};
