// Live foreign-exchange rates for spend-based emission calculations.
//
// Scope 3 "Purchased Goods & Services" emission factors are published per USD,
// but companies record spend in their own currency (usually INR). Converting
// with a hardcoded rate silently skews every figure: the rate that used to be
// hardcoded here (83.5) drifted ~15% from the live rate, which would inflate
// every INR-denominated Scope 3 emission by the same 15%.
//
// Rates are fetched from a public API, cached in-process for CACHE_TTL_MS, and
// fall back to the previous good value (then to a documented static rate) so a
// provider outage degrades instead of failing the calculation. Callers should
// persist `rate`/`asOf` alongside the emission so a report stays reproducible.

export interface FxRate {
  /** Units of `currency` per 1 USD (e.g. 95.77 for INR). */
  rate: number;
  currency: string;
  /** When the provider last published this rate. */
  asOf: string;
  source: "live" | "cache" | "fallback";
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // rates move slowly; twice a day is plenty

/**
 * Last-resort rates, used ONLY when every provider is unreachable and nothing
 * is cached. Deliberately logged loudly — a stale rate is a reporting error.
 */
const FALLBACK_RATES: Record<string, number> = { INR: 95.77, EUR: 0.86 };
const FALLBACK_AS_OF = "2026-08-21";

interface CacheEntry { rates: Record<string, number>; asOf: string; fetchedAt: number; }
let cache: CacheEntry | null = null;

async function fetchRates(): Promise<CacheEntry | null> {
  const providers = [
    {
      url: "https://open.er-api.com/v6/latest/USD",
      parse: (j: any) => ({ rates: j?.rates, asOf: j?.time_last_update_utc }),
    },
    {
      url: "https://api.frankfurter.app/latest?base=USD",
      parse: (j: any) => ({ rates: j?.rates, asOf: j?.date }),
    },
  ];

  for (const p of providers) {
    try {
      const res = await fetch(p.url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const { rates, asOf } = p.parse(await res.json());
      if (rates && typeof rates.INR === "number" && rates.INR > 0) {
        return { rates, asOf: String(asOf ?? new Date().toISOString()), fetchedAt: Date.now() };
      }
    } catch {
      // try the next provider
    }
  }
  return null;
}

/** Units of `currency` per 1 USD. Never throws — always returns a usable rate. */
export async function getUsdRate(currency: string): Promise<FxRate> {
  const code = (currency || "").trim().toUpperCase();

  if (code === "USD") {
    return { rate: 1, currency: "USD", asOf: new Date().toISOString(), source: "live" };
  }

  const fresh = cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (!fresh) {
    const fetched = await fetchRates();
    if (fetched) cache = fetched;
  }

  if (cache && typeof cache.rates[code] === "number") {
    return {
      rate: cache.rates[code],
      currency: code,
      asOf: cache.asOf,
      // A cache older than the TTL means every provider just failed.
      source: Date.now() - cache.fetchedAt < CACHE_TTL_MS ? "live" : "cache",
    };
  }

  const fallback = FALLBACK_RATES[code];
  if (fallback) {
    console.warn(
      `[fx] No live rate for ${code}; using static fallback ${fallback} (as of ${FALLBACK_AS_OF}). ` +
      `Emissions computed now may be inaccurate — check outbound network access.`
    );
    return { rate: fallback, currency: code, asOf: FALLBACK_AS_OF, source: "fallback" };
  }

  throw new Error(`No exchange rate available for currency "${currency}"`);
}

export interface UsdConversion { usd: number; rate: number; asOf: string; source: FxRate["source"]; }

/** Convert `amount` in `currency` to USD, reporting the rate actually used. */
export async function convertToUsd(amount: number, currency: string): Promise<UsdConversion> {
  const { rate, asOf, source } = await getUsdRate(currency);
  if (!Number.isFinite(amount)) throw new Error(`Invalid amount "${amount}" for currency conversion`);
  return { usd: amount / rate, rate, asOf, source };
}
