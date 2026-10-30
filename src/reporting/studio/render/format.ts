/**
 * DS-1 · number formats for what the renderer draws itself: chart axis ticks,
 * chart value labels and typed (custom) table cells. Reported figures arrive
 * already formatted in `RenderValue.display` (layer rule 4) and are never
 * re-formatted here. Deterministic: no Intl, no locale.
 *
 * #209: a tCO₂e figure the renderer draws (chart value labels, legend values,
 * bound table and flow cells) shows exactly 3 decimals, as every emission
 * figure in the app does. The caller passes the figure's unit; `auto` with a
 * tonnes-CO₂e unit prints `TONNES_DP` decimals, any other unit (%, kWh,
 * intensities, counts, custom data with no unit) keeps `auto`. Axis ticks
 * keep `auto` (they are scale marks, not figures).
 */
import type { NumberFormat, RenderSeries } from "./types";

/** Decimals of a tCO₂e figure: ESG-lite src/services/emissionWrite/round.ts TONNES_DP (#209). */
export const TONNES_DP = 3;

/**
 * Whether a unit is tonnes of CO₂e, whatever its spelling: "tCO₂e", "tCO2e",
 * "TCO2E", "t CO2e", "tonnes CO₂e", "tCO2-e", "tCO2eq". Subscripts, case,
 * spaces and hyphens are folded. Kilograms, kilotonnes, megatonnes, single
 * gases ("t CO₂") and intensities ("tCO₂e per employee") are not.
 */
export const isTonnesCo2e = (unit: string | null | undefined): boolean => {
  if (!unit) return false;
  const u = unit
    .toLowerCase()
    .replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080))
    .replace(/[\s-]+/g, "");
  return /^(t|tonnes?|metrictonnes?)co2e(q)?$/.test(u);
};

/**
 * #209 review: the unit of a series' values: its own `unit` when the source sent one (a KPI
 * binding mixes KPIs in different units; a GHG gas breakdown is tonnes of each gas), else the
 * bound value's unit. An explicit null means no unit.
 */
export const seriesUnit = (s: Pick<RenderSeries, "unit"> | null | undefined, valueUnit: string | null | undefined): string | null =>
  s && s.unit !== undefined ? s.unit : (valueUnit ?? null);

/**
 * The unit of a figure summed over several series (a stacked total, a donut's total): the
 * series' shared unit, tonnes of CO₂e when every one is (whatever the spelling), else null
 * (`auto`), so a sum across units never prints as tCO₂e. No series: the bound value's unit.
 */
export const sharedUnit = (series: Pick<RenderSeries, "unit">[], valueUnit: string | null | undefined): string | null => {
  if (!series.length) return valueUnit ?? null;
  const units = series.map((s) => seriesUnit(s, valueUnit));
  return units.every((u) => u === units[0]) || units.every(isTonnesCo2e) ? units[0] : null;
};

const group = (intPart: string, indian: boolean): string => {
  if (!indian) return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
};

/** "0999" + 1 → "1000"; "" + 1 → "1". */
const increment = (digits: string): string => {
  const d = digits.split("");
  for (let i = d.length - 1; i >= 0; i--) {
    if (d[i] !== "9") {
      d[i] = String(Number(d[i]) + 1);
      return d.join("");
    }
    d[i] = "0";
  }
  return `1${d.join("")}`;
};

/**
 * `abs` (finite, ≥ 0) rounded to `dp` decimals, half away from zero, on its
 * shortest decimal form (what `String(abs)` prints), as Intl rounds the
 * `display` figures in ESG-lite src/studio/sources/format.ts (#209 review):
 * 33102.0885 → "33102.089", where Math.round(33102.0885 × 1000) on the float
 * (33102088.4999…) would give .088. Exponent forms ("1e+21", "1.5e-7") are
 * expanded first. Returns the integer and fraction digits.
 */
const roundDecimal = (abs: number, dp: number): [string, string] => {
  const [mantissa, exp] = String(abs).split("e");
  const [ip, fp = ""] = mantissa.split(".");
  let digits = ip + fp;
  // Digits before the decimal point.
  let point = ip.length + (exp ? Number(exp) : 0);
  if (point < 0) {
    digits = "0".repeat(-point) + digits;
    point = 0;
  }
  digits = digits.padEnd(point + dp + 1, "0");
  const kept = digits.slice(0, point + dp);
  const r = digits.charCodeAt(point + dp) >= 53 /* "5" */ ? increment(kept) : kept;
  const intPart = r.slice(0, r.length - dp).replace(/^0+(?=\d)/, "") || "0";
  return [intPart, r.slice(r.length - dp)];
};

/** Fixed decimals with grouping; half away from zero on the decimal form (`roundDecimal`). */
export const fixed = (v: number, dp: number, indian = false): string => {
  if (!Number.isFinite(v)) return "–";
  const [i, f] = roundDecimal(Math.abs(v), dp);
  const s = group(i, indian) + (dp > 0 ? `.${f}` : "");
  // A value that rounds to zero shows no sign.
  return v < 0 && /[1-9]/.test(i + f) ? `−${s}` : s;
};

const compact = (v: number): string => {
  const a = Math.abs(v);
  const units: [number, string][] = [
    [1e9, "bn"],
    [1e6, "m"],
    [1e3, "k"],
  ];
  for (const [d, u] of units) {
    if (a >= d) {
      const x = v / d;
      return `${fixed(x, Math.abs(x) >= 100 ? 0 : 1).replace(/\.0$/, "")}${u}`;
    }
  }
  return fixed(v, a < 10 && a % 1 !== 0 ? 1 : 0);
};

/**
 * Formats a number the renderer draws (axis ticks, chart value labels, table
 * and flow cells, custom data). `unit` is the figure's unit: on `auto`, a
 * tonnes-CO₂e figure prints `TONNES_DP` decimals (#209); a format someone
 * picked still wins.
 */
export function formatNumber(v: number | null | undefined, f: NumberFormat = "auto", unit?: string | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (f === "auto" && isTonnesCo2e(unit)) return fixed(v, TONNES_DP);
  switch (f) {
    case "int":
      return fixed(v, 0);
    case "1dp":
      return fixed(v, 1);
    case "2dp":
      return fixed(v, 2);
    case "pct0":
      return `${fixed(v * 100, 0)}%`;
    case "pct1":
      return `${fixed(v * 100, 1)}%`;
    case "compact":
      return compact(v);
    case "indian":
      return fixed(v, 0, true);
    default: {
      const a = Math.abs(v);
      if (a >= 100) return fixed(v, 0);
      if (a >= 10) return fixed(v, 1).replace(/\.0$/, "");
      return fixed(v, 2).replace(/\.?0+$/, "");
    }
  }
}

/** Axis tick label: compact above 10,000 so long axes stay narrow. */
export const tickLabel = (v: number): string => (Math.abs(v) >= 10000 ? compact(v) : formatNumber(v, "auto"));
