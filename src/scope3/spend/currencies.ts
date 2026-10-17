/**
 * S3-5 · the currencies a spend row may be entered in, their USD pegs and
 * the country whose price index deflates them. One list for the engine, the
 * daily FX job, `GET /fx-rates/currencies` and the forms' Currency select.
 */

/** Every currency here converts: ECB cross rates (EUR, INR, GBP), a USD peg (AED, SAR, BHD), or USD itself. */
export const SUPPORTED_CURRENCIES = ["INR", "USD", "EUR", "GBP", "BHD", "SAR", "AED"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** Currencies the ECB publishes; fetched from the providers. */
export const MARKET_CURRENCIES = ["EUR", "INR", "GBP"] as const satisfies readonly SupportedCurrency[];

/**
 * Units per 1 USD of the currencies fixed to the dollar (central bank pegs:
 * UAE dirham since 1997, Saudi riyal since 1986, Bahraini dinar since 2001).
 * The ECB doesn't publish them; they're stored with source `peg`.
 */
export const USD_PEGS: Record<"AED" | "SAR" | "BHD", number> = { AED: 3.6725, SAR: 3.75, BHD: 0.376 };

/** The price index used to deflate an amount in this currency (`price_deflator.country`). */
export const DEFLATOR_COUNTRY: Record<SupportedCurrency, string> = {
  USD: "US",
  EUR: "EU",
  INR: "IN",
  GBP: "GB",
  AED: "AE",
  SAR: "SA",
  BHD: "BH",
};

export const CURRENCY_NAMES: Record<SupportedCurrency, string> = {
  USD: "US dollar",
  EUR: "Euro",
  INR: "Indian rupee",
  GBP: "Pound sterling",
  AED: "UAE dirham",
  SAR: "Saudi riyal",
  BHD: "Bahraini dinar",
};

/** "inr", " INR " → "INR"; null when it isn't a supported currency. */
export const supportedCurrency = (value: unknown): SupportedCurrency | null => {
  const code = String(value ?? "").trim().toUpperCase();
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code) ? (code as SupportedCurrency) : null;
};

/**
 * The factor's currency: its unit when that is a currency ("USD", the unit the
 * factor is per), else its price currency; null for a factor per kg, kWh… or
 * in a currency ESGLite doesn't convert.
 */
export const factorCurrency = (factor: { price_currency?: string | null; denominator_unit?: string | null }): SupportedCurrency | null =>
  supportedCurrency(factor.denominator_unit) ?? supportedCurrency(factor.price_currency);

/**
 * ISO 4217 codes a unit field may hold, supported or not. A list, not a
 * three-letter pattern: "kwh", "ton" and "kgs" are units, not currencies.
 */
export const KNOWN_CURRENCY_CODES: readonly string[] = [
  ...SUPPORTED_CURRENCIES,
  "JPY", "CNY", "AUD", "CAD", "CHF", "SGD", "HKD", "NZD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "TRY",
  "ZAR", "BRL", "MXN", "KRW", "IDR", "MYR", "THB", "PHP", "VND", "PKR", "BDT", "LKR", "NPR", "QAR", "OMR", "KWD", "JOD",
  "EGP", "NGN", "KES", "ILS", "RUB", "UAH", "ARS", "CLP", "COP", "PEN", "TWD",
];
const KNOWN_CURRENCIES = new Set<string>(KNOWN_CURRENCY_CODES);

/** The unit is an amount of money in some currency (supported or not). */
export const looksLikeCurrency = (value: unknown): boolean => KNOWN_CURRENCIES.has(String(value ?? "").trim().toUpperCase());
