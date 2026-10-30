/**
 * DS-2 · the one place a reported number is rounded for a page (layer rule:
 * "All numbers are rounded by the doc's NumberFormat in one place"). The
 * resolver sends `display` strings; the renderer and the FE show them as
 * they are and never format a reported figure themselves.
 *
 *   auto     ≥ 100: no decimals; ≥ 1: up to 2; below 1: up to 3 significant
 *   int      no decimals          1dp / 2dp   fixed decimals
 *   pct0     a share as "12%"     pct1        "12.3%" (the value is already a percentage)
 *   compact  "1.2K", "3.4M"       indian      Indian grouping ("12,34,567")
 * Negative numbers use a true minus sign (U+2212). Null is "—".
 *
 * #209: a tCO₂e figure on `auto` shows exactly 3 decimals, as every emission
 * figure in the app does; a format someone picked still wins. The unit is
 * matched by the renderer's `isTonnesCo2e`, so "tCO₂e" (GHG source), "tCO2e"
 * (KPI canonical unit) and their other spellings all count, and the renderer's
 * chart labels and table cells agree with the figures sent here.
 */
import { isTonnesCo2e } from "../../reporting/studio/render/format";
import type { NumberFormat } from "../contracts";

export const MINUS = "−";
export const EMPTY = "—";

const grouped = (n: number, min: number, max: number, locale = "en-US") =>
  n.toLocaleString(locale, { minimumFractionDigits: min, maximumFractionDigits: max });

export const TONNES_UNIT = "tCO₂e";

export function formatNumber(value: number | null | undefined, format: NumberFormat = "auto", unit?: string | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  const neg = value < 0;
  const abs = Math.abs(value);
  let text: string;
  switch (format === "auto" && isTonnesCo2e(unit) ? "tonnes" : format) {
    case "tonnes":
      text = grouped(abs, 3, 3);
      break;
    case "int":
      text = grouped(abs, 0, 0);
      break;
    case "1dp":
      text = grouped(abs, 1, 1);
      break;
    case "2dp":
      text = grouped(abs, 2, 2);
      break;
    case "pct0":
      text = `${grouped(abs, 0, 0)}%`;
      break;
    case "pct1":
      text = `${grouped(abs, 1, 1)}%`;
      break;
    case "compact":
      text = abs.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
      break;
    case "indian":
      text = grouped(abs, 0, abs >= 100 ? 0 : 2, "en-IN");
      break;
    case "auto":
    default:
      text = abs >= 100 ? grouped(abs, 0, 0) : abs >= 1 ? grouped(abs, 0, 2) : abs === 0 ? "0" : grouped(Number(abs.toPrecision(3)), 0, 6);
  }
  // A value that rounds to zero shows no sign.
  return neg && /[1-9]/.test(text) ? `${MINUS}${text}` : text;
}

/** A change in percent with its sign: "+4.2%", "−12.0%". */
export function formatChangePct(value: number | null | undefined, format: NumberFormat = "pct1"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  const body = formatNumber(Math.abs(value), format === "pct0" ? "pct0" : "pct1");
  return value === 0 || !/[1-9]/.test(body) ? body : `${value > 0 ? "+" : MINUS}${body}`;
}

/** A change in the binding's unit with its sign: "+120", "−4.5". */
export function formatChangeAbs(value: number | null | undefined, format: NumberFormat = "auto", unit?: string | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  const body = formatNumber(Math.abs(value), format, unit);
  return value === 0 || !/[1-9]/.test(body) ? body : `${value > 0 ? "+" : MINUS}${body}`;
}
