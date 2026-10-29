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
import type { NumberFormat } from "./types";

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

const group = (intPart: string, indian: boolean): string => {
  if (!indian) return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
};

/** Fixed decimals with grouping; half away from zero. */
export const fixed = (v: number, dp: number, indian = false): string => {
  if (!Number.isFinite(v)) return "–";
  const neg = v < 0;
  const p = Math.pow(10, dp);
  const r = Math.round(Math.abs(v) * p) / p;
  const [i, f] = r.toFixed(dp).split(".");
  const s = group(i, indian) + (f ? `.${f}` : "");
  return neg && r !== 0 ? `−${s}` : s;
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
