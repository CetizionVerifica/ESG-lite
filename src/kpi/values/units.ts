/**
 * KPI-4 · units (layer rule 5, D10). Each KPI has a canonical unit; a value may
 * be entered in any of its allowed units and is converted here.
 *
 * Unit spellings are read through the emission engine's `canonicalUnit`
 * (src/services/emissionWrite/units.ts: "MT" → tonne, "m3" → cubic meter,
 * "Ltr" → litre …), then looked up in the KPI registry below, which adds what
 * the engine lacks: water volumes (kL, ML), counts, percentages and rates,
 * time, CO₂e masses and same-currency scales (INR lakh/crore).
 *
 * Each unit belongs to a dimension (01-contracts §2 `unit_dimension`) and a
 * family; only units of the same family convert (tCO₂e never converts to
 * tonnes of waste; INR never converts to USD). Never guess: anything unknown
 * or in another family is KPI_UNIT_NOT_ALLOWED. Dimension `none` takes its
 * canonical unit only (intensities such as "GJ per INR crore", calculated by
 * KPI-6).
 *
 * Pure: no database. The FE mirror is `src/lib/kpi/units.ts`.
 */
import { canonicalUnit } from "../../services/emissionWrite/units";
import type { UnitDimension } from "../contracts/enums";
import { KpiError } from "../contracts/errors";

export interface KpiUnit {
  /** The spelling shown and stored (`kL`, `tCO2e`, `INR crore`). */
  label: string;
  dimension: Exclude<UnitDimension, "none">;
  /** Only units of one family convert to each other. */
  family: string;
  /** Multiply by this to get the family's base unit. */
  toBase: number;
}

const u = (label: string, dimension: KpiUnit["dimension"], family: string, toBase: number): KpiUnit => ({ label, dimension, family, toBase });

/** Keyed by the normalised spelling (lower case, after `canonicalUnit` and KPI_ALIASES). */
export const KPI_UNITS: Record<string, KpiUnit> = {
  // Energy (base kWh)
  kwh: u("kWh", "energy", "energy", 1),
  mwh: u("MWh", "energy", "energy", 1_000),
  gwh: u("GWh", "energy", "energy", 1_000_000),
  mj: u("MJ", "energy", "energy", 1 / 3.6),
  gj: u("GJ", "energy", "energy", 1_000 / 3.6),
  tj: u("TJ", "energy", "energy", 1_000_000 / 3.6),
  // Mass (base kg)
  g: u("g", "mass", "mass", 0.001),
  kg: u("kg", "mass", "mass", 1),
  tonne: u("tonne", "mass", "mass", 1_000),
  lb: u("lb", "mass", "mass", 0.45359237),
  // CO2-equivalent mass (base kgCO2e)
  kgco2e: u("kgCO2e", "mass", "co2e", 1),
  tco2e: u("tCO2e", "mass", "co2e", 1_000),
  // Volume, water included (base m³)
  ml: u("mL", "volume", "volume", 0.000001),
  litre: u("litre", "volume", "volume", 0.001),
  "cubic meter": u("m3", "volume", "volume", 1),
  kl: u("kL", "volume", "volume", 1),
  megalitre: u("ML", "volume", "volume", 1_000),
  gallon: u("gallon", "volume", "volume", 0.003785411784),
  // Counts
  count: u("count", "count", "count", 1),
  days: u("days", "count", "days", 1),
  // Ratios
  "%": u("%", "ratio", "percent", 1),
  fraction: u("fraction", "ratio", "percent", 100),
  "per million hours": u("per million hours", "ratio", "injury_rate", 1),
  "per 200000 hours": u("per 200000 hours", "ratio", "injury_rate", 5),
  ratio: u("ratio", "ratio", "times", 1),
  // Time (base hours)
  hours: u("hours", "time", "time", 1),
  minutes: u("minutes", "time", "time", 1 / 60),
  // Money: same currency only (base one unit of it)
  inr: u("INR", "currency", "INR", 1),
  "inr lakh": u("INR lakh", "currency", "INR", 100_000),
  "inr million": u("INR million", "currency", "INR", 1_000_000),
  "inr crore": u("INR crore", "currency", "INR", 10_000_000),
  usd: u("USD", "currency", "USD", 1),
  "usd million": u("USD million", "currency", "USD", 1_000_000),
  eur: u("EUR", "currency", "EUR", 1),
  "eur million": u("EUR million", "currency", "EUR", 1_000_000),
};

/** Spellings the engine's UNIT_ALIASES doesn't know (applied after `canonicalUnit`). */
export const KPI_ALIASES: Record<string, string> = {
  t: "tonne",
  ton: "tonne",
  tons: "tonne",
  tonnes: "tonne",
  "kilo litre": "kl",
  kilolitre: "kl",
  kilolitres: "kl",
  kiloliter: "kl",
  kiloliters: "kl",
  megalitres: "megalitre",
  megaliter: "megalitre",
  megaliters: "megalitre",
  "mega litre": "megalitre",
  millilitre: "ml",
  "tco₂e": "tco2e",
  "kgco₂e": "kgco2e",
  "t co2e": "tco2e",
  "tonnes co2e": "tco2e",
  "kg co2e": "kgco2e",
  percent: "%",
  pct: "%",
  "#": "count",
  number: "count",
  nos: "count",
  "no.": "count",
  people: "count",
  persons: "count",
  day: "days",
  hour: "hours",
  hrs: "hours",
  hr: "hours",
  h: "hours",
  minute: "minutes",
  min: "minutes",
  mins: "minutes",
  "per 1,000,000 hours": "per million hours",
  "per 1000000 hours": "per million hours",
  "per 200,000 hours": "per 200000 hours",
  "₹": "inr",
  rs: "inr",
  "rs lakh": "inr lakh",
  "rs crore": "inr crore",
  "₹ crore": "inr crore",
  "₹ lakh": "inr lakh",
  times: "ratio",
};

/**
 * The registry key of a unit, or null when unknown. "ML" (megalitre) is read
 * before lower-casing, since the engine reads "ml" as millilitre.
 */
export const normaliseUnit = (unit: string | null | undefined): string | null => {
  const raw = (unit ?? "").trim();
  if (!raw) return null;
  if (raw === "ML" || raw === "Ml") return "megalitre";
  const lower = raw.toLowerCase().replace(/\s+/g, " ");
  const viaKpi = KPI_ALIASES[lower] ?? lower;
  if (KPI_UNITS[viaKpi]) return viaKpi;
  const viaEngine = canonicalUnit(lower);
  const key = KPI_ALIASES[viaEngine] ?? viaEngine;
  return KPI_UNITS[key] ? key : null;
};

export const unitInfo = (unit: string | null | undefined): KpiUnit | null => {
  const key = normaliseUnit(unit);
  return key ? KPI_UNITS[key] : null;
};

/** Factor from `from` to `to` (same family only), else null. */
export const conversionFactor = (from: string, to: string): number | null => {
  const a = unitInfo(from);
  const b = unitInfo(to);
  if (!a || !b || a.family !== b.family) return null;
  return a.toBase / b.toBase;
};

/** Rounds away binary noise (1 GJ in kWh is 277.7777…, kept to 12 significant digits). */
const tidy = (n: number) => Number(n.toPrecision(12));

export const convert = (value: number, from: string, to: string): number | null => {
  const f = conversionFactor(from, to);
  return f === null ? null : tidy(value * f);
};

/** The KPI fields units need. */
export interface UnitKpi {
  unit_dimension: string;
  canonical_unit: string | null;
  allowed_units: string[];
}

const sameSpelling = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether `unit` is one of the KPI's allowed units (alias-aware). */
export const unitAllowed = (unit: string, kpi: UnitKpi): boolean => {
  if (kpi.unit_dimension === "none") return !!kpi.canonical_unit && sameSpelling(unit, kpi.canonical_unit);
  const key = normaliseUnit(unit);
  if (!key) return false;
  return kpi.allowed_units.some((a) => normaliseUnit(a) === key);
};

export interface CanonicalValue {
  /** The unit as stored: the registry spelling of what was entered. */
  unit: string;
  value_canonical: number;
  /** True when the entered unit isn't the canonical one (KPI_UNIT_CONVERTED). */
  converted: boolean;
}

/**
 * A numeric value in the KPI's canonical unit. An omitted unit means the
 * canonical one. KPI_UNIT_NOT_ALLOWED when the unit isn't allowed or can't
 * convert; details name the units, never the value.
 */
export const toCanonical = (value: number, unit: string | null | undefined, kpi: UnitKpi): CanonicalValue => {
  const canonical = kpi.canonical_unit;
  if (!canonical) {
    if (unit) throw new KpiError("KPI_UNIT_NOT_ALLOWED", { unit, allowed: [] });
    return { unit: "", value_canonical: value, converted: false };
  }
  const entered = unit && unit.trim() ? unit.trim() : canonical;
  if (!unitAllowed(entered, kpi)) throw new KpiError("KPI_UNIT_NOT_ALLOWED", { unit: entered, allowed: kpi.allowed_units.length ? kpi.allowed_units : [canonical] });
  if (kpi.unit_dimension === "none") return { unit: canonical, value_canonical: value, converted: false };
  const converted = convert(value, entered, canonical);
  if (converted === null) throw new KpiError("KPI_UNIT_NOT_ALLOWED", { unit: entered, allowed: kpi.allowed_units });
  const info = unitInfo(entered)!;
  return { unit: info.label, value_canonical: converted, converted: normaliseUnit(entered) !== normaliseUnit(canonical) };
};

/**
 * Library check (KPI-2): the canonical unit belongs to the dimension and every
 * allowed unit converts to it. Returns problems (empty = fine).
 */
export const unitProblems = (kpi: UnitKpi): string[] => {
  const problems: string[] = [];
  const dim = kpi.unit_dimension;
  if (dim === "none") {
    if (kpi.allowed_units.some((a) => !kpi.canonical_unit || !sameSpelling(a, kpi.canonical_unit))) problems.push("A KPI with no unit dimension allows its canonical unit only.");
    return problems;
  }
  if (!kpi.canonical_unit) return ["A KPI with a unit dimension needs a canonical unit."];
  const canonical = unitInfo(kpi.canonical_unit);
  if (!canonical) return [`Unknown canonical unit "${kpi.canonical_unit}".`];
  if (canonical.dimension !== dim) problems.push(`"${kpi.canonical_unit}" isn't a ${dim} unit.`);
  for (const a of kpi.allowed_units) {
    if (conversionFactor(a, kpi.canonical_unit) === null) problems.push(`"${a}" can't convert to "${kpi.canonical_unit}".`);
  }
  return problems;
};
