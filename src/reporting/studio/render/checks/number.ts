/**
 * DS-12 (RS-9 §1) · the typed-number check, shared by the server checks
 * (src/studio/checks/numbers.ts) and the editor's live markers (the FE mirror).
 * Pure: no DOM, no Node, no app imports.
 *
 *   extractNumbers(text)            numeric claims typed in prose: value, unit family, the
 *                                   rounding step the writer used, and where they sit
 *   matchClaim(claim, candidates)   match | mismatch (a near miss with the same unit) | unbound
 *
 * Rules:
 *   - Indian and Western grouping ("48,62,000", "48,620"), scale words ("1.28 million",
 *     "₹ 1.5 crore", "3 lakh", "48.6 kt") and percentages ("12.4%") are normalised;
 *   - a typed number matches a candidate when the candidate, rounded to the step the writer
 *     typed, equals it ("48,600 t" matches 48,620: the writer typed hundreds);
 *   - years, framework codes and clause numbers ("GRI 305-1", "ISO 14064-1", "E1-6",
 *     "Scope 3", "Category 4", "SDG 13", "AR5", "P6") and small counts (< 10) are ignored;
 *   - a near miss is a candidate with the same unit family within a factor of two
 *     (NUMBER_MISMATCH); anything else is NUMBER_UNBOUND (listed for review).
 */

export type UnitFamily = "t" | "%" | "energy" | "volume" | "money" | "count" | "other" | null;

export interface NumberClaim {
  /** The text as typed, e.g. "48,600 t". */
  text: string;
  /** The value in base units (t, %, GJ/MWh as typed, rupees, units). */
  value: number;
  /** The unit as typed (normalised), or null. */
  unit: string | null;
  family: UnitFamily;
  /** The rounding step the writer used, in base units (48,600 → 100; 1.28 million → 10,000). */
  step: number;
  start: number;
  end: number;
}

export interface NumberCandidate {
  value: number;
  /** The unit of the resolved figure ("tCO₂e", "%", "t CO₂", …), or null. */
  unit: string | null;
  /** What the figure is ("Scope 1", "Scope 1 · change vs prior year"), for messages. */
  label?: string;
  /** Index of the binding or token it came from, when there is one. */
  ref?: { kind: "binding" | "token"; idx: number };
}

export type MatchResult = { status: "match"; candidate: NumberCandidate } | { status: "mismatch"; candidate: NumberCandidate } | { status: "unbound" };

const SCALES: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  million: 1e6,
  mn: 1e6,
  m: 1e6,
  crore: 1e7,
  crores: 1e7,
  cr: 1e7,
  billion: 1e9,
  bn: 1e9,
};

/** Typed unit (lower case, subscripts folded) → [family, multiplier to the base unit]. */
const UNITS: Record<string, [Exclude<UnitFamily, null>, number]> = {
  t: ["t", 1],
  tonne: ["t", 1],
  tonnes: ["t", 1],
  ton: ["t", 1],
  tons: ["t", 1],
  tco2e: ["t", 1],
  "t co2e": ["t", 1],
  tco2: ["t", 1],
  "t co2": ["t", 1],
  kt: ["t", 1e3],
  ktco2e: ["t", 1e3],
  mt: ["t", 1e6],
  mtco2e: ["t", 1e6],
  kg: ["t", 1e-3],
  "%": ["%", 1],
  "per cent": ["%", 1],
  percent: ["%", 1],
  pts: ["%", 1],
  gj: ["energy", 1],
  mwh: ["energy", 1],
  kwh: ["energy", 1],
  kl: ["volume", 1],
  "m3": ["volume", 1],
  ml: ["volume", 1],
  "₹": ["money", 1],
  rs: ["money", 1],
  inr: ["money", 1],
  $: ["money", 1],
  usd: ["money", 1],
  hours: ["count", 1],
  people: ["count", 1],
  employees: ["count", 1],
  sites: ["count", 1],
  months: ["count", 1],
};

/** Folds subscripts and spacing so "tCO₂e", "t CO2e" and "TCO2E" compare equal. */
const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080))
    .replace(/³/g, "3")
    .replace(/\s+/g, " ")
    .trim();

/** The unit family of a resolved figure's unit ("tCO₂e per unit of revenue" counts as "other"). */
export function unitFamily(unit: string | null | undefined): UnitFamily {
  if (!unit) return null;
  const u = fold(unit);
  if (u.includes(" per ")) return "other";
  if (u === "%" || u.startsWith("%")) return "%";
  if (/^t\b|^tco2|^t co|^tonnes?\b|^kt\b|^mt\b/.test(u)) return "t";
  if (/gj|mwh|kwh/.test(u)) return "energy";
  if (/kl|m3/.test(u)) return "volume";
  if (/₹|inr|rs|usd|\$/.test(u)) return "money";
  if (/sites|months|people|employees|hours/.test(u)) return "count";
  return "other";
}

// A number: digits with optional grouping commas (Western or Indian) and decimals.
const NUM = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const UNIT_RX = String.raw`(?:%|per cent|percent|pts|t\s?co[2₂](?:e|-?eq)?|kt\s?co[2₂]e|mt\s?co[2₂]e|tonnes?|tons?|kt|mt|kg|t|gj|mwh|kwh|kl|m[3³]|ml|hours|people|employees|sites|months)`;
const SCALE_RX = String.raw`(?:thousand|lakhs?|lac|million|mn|crores?|cr|billion|bn|k)`;
const CLAIM = new RegExp(String.raw`(₹|rs\.?|inr|\$|usd)?\s?(${NUM})(?:\s?(${SCALE_RX})\b)?(?:\s?(${UNIT_RX})(?![a-z]))?`, "giu");

/** Words right before a number that make it an identifier, not a figure. */
const ID_BEFORE = /\b(?:scope|category|categories|cat\.?|sdg|goal|principle|clause|section|chapter|page|pages|table|figure|fig\.?|gri|brsr|esrs|iso|ar|p|e|s|g|no\.?|#|v|version|q|tier|level|step|phase|annex|appendix|disclosure|standard)\.?\s*$/i;
const MONTH_WORD = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

/** The writer's rounding step for a typed number string (before scaling). */
function stepOf(raw: string): number {
  const clean = raw.replace(/,/g, "");
  const dot = clean.indexOf(".");
  if (dot >= 0) return Math.pow(10, -(clean.length - dot - 1));
  const trailing = /0*$/.exec(clean)?.[0].length ?? 0;
  // "48,000" → step 1,000; "100" → 100; "0" → 1.
  return clean === "0" ? 1 : Math.pow(10, Math.min(trailing, clean.length - 1));
}

/** Numeric claims in a piece of prose. */
export function extractNumbers(text: string): NumberClaim[] {
  const out: NumberClaim[] = [];
  if (!text) return out;
  CLAIM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAIM.exec(text))) {
    const [whole, currency, rawNum, scaleWord, unitWord] = m;
    if (!rawNum) {
      if (m.index === CLAIM.lastIndex) CLAIM.lastIndex++;
      continue;
    }
    const numStart = m.index + whole.indexOf(rawNum);
    const before = text.slice(Math.max(0, numStart - 16), numStart);
    const prevChar = text[numStart - 1] ?? "";
    const nextChar = text[numStart + rawNum.length] ?? "";
    // Part of an identifier: "305-1", "14064-1", "E1-6", "AR5", "P6", "v2.1", "Q3", "2025-26".
    // A minus sign (start of text or after a space) is a sign, not part of an identifier.
    const sign = (prevChar === "-" || prevChar === "−") && !/[A-Za-z0-9]/.test(text[numStart - 2] ?? "");
    if ((/[A-Za-z_-]/.test(prevChar) && !sign) || (nextChar === "-" && /\d/.test(text[numStart + rawNum.length + 1] ?? "")) || (/[A-Za-z]/.test(nextChar) && !unitWord && !scaleWord)) continue;
    // Dates: "31 March", "March 31".
    if (!unitWord && !scaleWord && !currency && (MONTH_WORD.test(text.slice(numStart + rawNum.length).trimStart()) || /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*$/i.test(before))) continue;
    if (prevChar === "." && /\d/.test(text[numStart - 2] ?? "")) continue;
    if (ID_BEFORE.test(before) && !currency) continue;
    const base = Number(rawNum.replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    const unitKey = unitWord ? fold(unitWord).replace(/-?eq$/, "e").replace(/\s/g, "") : currency ? "₹" : null;
    const unitDef = unitKey ? (UNITS[unitKey] ?? UNITS[unitKey.replace(/\./g, "")] ?? (currency ? UNITS["₹"] : undefined)) : undefined;
    const isYear = !unitWord && !scaleWord && !currency && !rawNum.includes(",") && !rawNum.includes(".") && base >= 1900 && base <= 2100;
    if (isYear) continue;
    if (!unitWord && !scaleWord && !currency && !rawNum.includes(".") && base < 10) continue;
    const scale = scaleWord ? (SCALES[scaleWord.toLowerCase()] ?? 1) : 1;
    const mult = unitDef ? unitDef[1] : 1;
    const value = base * scale * mult;
    out.push({
      text: whole.trim(),
      value,
      unit: unitWord ? unitWord.trim() : currency ? currency.trim() : null,
      family: unitDef ? unitDef[0] : currency ? "money" : null,
      step: stepOf(rawNum) * scale * mult,
      start: m.index + (whole.length - whole.trimStart().length),
      end: m.index + whole.trimEnd().length,
    });
  }
  return out;
}

/** True when `candidate`, rounded to the writer's step, is the typed value. */
export function roundsTo(candidate: number, claim: Pick<NumberClaim, "value" | "step">): boolean {
  const c = Math.abs(candidate);
  const v = Math.abs(claim.value);
  const step = claim.step > 0 ? claim.step : 1;
  const rounded = Math.round(c / step) * step;
  return Math.abs(rounded - v) <= step * 1e-6 + 1e-9 || Math.abs(c - v) <= step * 1e-6 + 1e-9;
}

const compatible = (claim: NumberClaim, cand: NumberCandidate): boolean => {
  const f = unitFamily(cand.unit);
  if (!claim.family) return f !== "%"; // a bare number never matches a percentage
  if (claim.family === "%") return f === "%";
  if (!f) return claim.family === "count" || claim.family === "money";
  return f === claim.family || f === "other";
};

/** Match, near miss (same unit family, within a factor of two) or unbound. */
export function matchClaim(claim: NumberClaim, candidates: NumberCandidate[]): MatchResult {
  const usable = candidates.filter((c) => Number.isFinite(c.value) && compatible(claim, c));
  const hit = usable.find((c) => roundsTo(c.value, claim));
  if (hit) return { status: "match", candidate: hit };
  if (!claim.family || claim.family === "count" || claim.family === "other") return { status: "unbound" };
  const v = Math.abs(claim.value);
  let best: NumberCandidate | null = null;
  let bestRatio = Infinity;
  for (const c of usable) {
    const a = Math.abs(c.value);
    if (!a || !v) continue;
    const ratio = Math.max(a, v) / Math.min(a, v);
    if (ratio <= 2 && ratio < bestRatio) {
      best = c;
      bestRatio = ratio;
    }
  }
  return best ? { status: "mismatch", candidate: best } : { status: "unbound" };
}

/** The text of a candidate rounded the way the writer typed the claim ("48,600 t" for 48,620 at step 100). */
export function asTyped(candidate: number, claim: Pick<NumberClaim, "step">): number {
  const step = claim.step > 0 ? claim.step : 1;
  return Math.round(candidate / step) * step;
}
