/**
 * Unit conversions for the emission engine (IM1). Moved unchanged from
 * emission.controller.ts so typed entries, bulk uploads and Claude imports
 * convert the same way. Currency rows refresh from the live FX service.
 */
import { getUsdRate } from "../fxRate";

// Common unit conversions
export const unitConversions: Record<string, Record<string, number>> = {
  // Volume
  litre: { gallon: 0.264172, ml: 1000, "cubic meter": 0.001, "kilo litre": 0.001, kl: 0.001 },
  kl: { litre: 1000, gallon: 264.172, ml: 1000000, "cubic meter": 1 },
  "kilo litre": { litre: 1000, gallon: 264.172, ml: 1000000, "cubic meter": 1 },
  gallon: { litre: 3.78541, ml: 3785.41, "cubic meter": 0.00378541, kl: 0.00378541 },
  ml: { litre: 0.001, gallon: 0.000264172, kl: 0.000001 },
  "cubic meter": { litre: 1000, gallon: 264.172, kl: 1 },
  // Weight
  //
  kg: { lb: 2.20462, tonne: 0.001, g: 1000, ton: 0.001, tonnes : 0.001 },
  lb: { kg: 0.453592, tonne: 0.000453592, g: 453.592, tonnes : 0.000453592, ton: 0.000453592 },
  // "ton" is the metric tonne (1,000 kg), as DEFRA and the factor library use it, not the US short ton.
  ton: { kg: 1000, lb: 2204.62, g: 1000000, tonne: 1, tonnes: 1 },
  tonne: { kg: 1000, lb: 2204.62, g: 1000000 , tonnes : 1, ton: 1 },
  Tonnes : { kg: 1000, lb: 2204.62, g: 1000000, tonne : 1 },
  tonnes: { kg: 1000, lb: 2204.62, g: 1000000, tonne: 1, ton: 1 }, 
  g: { kg: 0.001, lb: 0.00220462 },
  // Energy
  kwh: { mwh: 0.001, gj: 0.0036, mj: 3.6 },
  mwh: { kwh: 1000, gj: 3.6, mj: 3600 },
  gj: { kwh: 277.778, mwh: 0.277778, mj: 1000 },
  mj: { kwh: 0.277778, gj: 0.001 },
  // Currency — seed values only. These are refreshed from the live FX service
  // below (refreshCurrencyRates), because a frozen rate silently skews every
  // spend-based Scope 3 figure: the previous hardcoded 83.5 had drifted ~15%
  // from the real rate, inflating every INR spend line by the same 15%.
  inr: { usd: 1 / 95.77 },
  usd: { inr: 95.77, eur: 0.86 },
  eur: { usd: 1 / 0.86 },

  "tonne.km": { "kg.km": 1000, "g.km": 1000000 },
"kg.km": { "tonne.km": 0.001, "g.km": 1000 },
"g.km": { "tonne.km": 0.000001, "kg.km": 0.001},
};

//comment

// Keep the currency rows of `unitConversions` in step with the live market.
// Done as a periodic refresh rather than an async lookup so that
// getConversionFactor stays synchronous and no call site has to change.
// Both directions are written as exact inverses, so converting INR->USD->INR
// can no longer drift (the old table had 0.012 vs 83.5, which did not agree).
async function refreshCurrencyRates(): Promise<void> {
  try {
    const [inr, eur] = await Promise.all([getUsdRate("INR"), getUsdRate("EUR")]);
    unitConversions.usd.inr = inr.rate;
    unitConversions.inr.usd = 1 / inr.rate;
    unitConversions.usd.eur = eur.rate;
    unitConversions.eur.usd = 1 / eur.rate;
  } catch (err) {
    console.warn("[fx] Could not refresh currency rates; keeping previous values.", err);
  }
}
void refreshCurrencyRates();
setInterval(refreshCurrencyRates, 12 * 60 * 60 * 1000).unref?.();

/**
 * Other spellings of the same unit, as client sheets and bills write them
 * ("MT" for a metric tonne and "SCM" for a city-gas cubic metre on Indian
 * records, "Ltr" for a litre). Read as the canonical unit before comparing or
 * converting, so a unit that used to be refused as not convertible now
 * resolves; nothing that converted before changes.
 */
export const UNIT_ALIASES: Record<string, string> = {
  mt: "tonne",
  "m.t.": "tonne",
  "metric ton": "tonne",
  "metric tons": "tonne",
  "metric tonne": "tonne",
  "metric tonnes": "tonne",
  scm: "cubic meter",
  sm3: "cubic meter",
  "sm³": "cubic meter",
  m3: "cubic meter",
  "m³": "cubic meter",
  "cubic metre": "cubic meter",
  "cubic meters": "cubic meter",
  "cubic metres": "cubic meter",
  ltr: "litre",
  ltrs: "litre",
  lt: "litre",
  lts: "litre",
  l: "litre",
  litres: "litre",
  liter: "litre",
  liters: "litre",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
};

export const canonicalUnit = (unit: string | null | undefined): string => {
  const u = (unit ?? "").toLowerCase().trim();
  return UNIT_ALIASES[u] ?? u;
};

// Get conversion factor between two units
export const getConversionFactor = (fromUnit: string, toUnit: string): number | null => {
  const from = canonicalUnit(fromUnit);
  const to = canonicalUnit(toUnit);
  if (from && from === to) return 1;
  return unitConversions[from]?.[to] || null;
};

// Check if units match (handles null/undefined like frontend)
export const unitsMatchExact = (unit1: string | null | undefined, unit2: string | null | undefined): boolean => {
  if (!unit1 || !unit2) return true; // Treat null/undefined as match (like frontend)
  return canonicalUnit(unit1) === canonicalUnit(unit2);
};
