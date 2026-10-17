/**
 * KPI-11 · values in a framework's display unit (D10: BRSR energy in GJ, ESRS
 * in MWh, GRI water in ML …), converted from the KPI's canonical unit with
 * KPI-4's unit registry (values/units.ts). Pure.
 *
 *   displayFactor(canonical, display)
 *     same unit                    → 1
 *     same family                  → the registry factor (GJ → MWh, kL → ML, tonne → kg)
 *     "A per B" on both sides      → factor(A) / factor(B) (MWh per EUR million needs both)
 *     anything else                → null: the value stays in the canonical unit with a note
 *                                    (never a guessed conversion; INR never becomes EUR)
 */
import { conversionFactor, normaliseUnit } from "../values/units";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() || (normaliseUnit(a) !== null && normaliseUnit(a) === normaliseUnit(b));

const factorOf = (from: string, to: string): number | null => (same(from, to) ? 1 : conversionFactor(from, to));

export function displayFactor(canonical: string | null, display: string | null): number | null {
  if (!display || !canonical) return 1;
  const whole = factorOf(canonical, display);
  if (whole !== null) return whole;
  const [cn, cd] = canonical.split(/\s+per\s+/i);
  const [dn, dd] = display.split(/\s+per\s+/i);
  if (cd === undefined || dd === undefined) return null;
  const top = factorOf(cn, dn);
  const bottom = factorOf(cd, dd);
  return top === null || bottom === null ? null : top / bottom;
}

const tidy = (n: number) => Number(n.toPrecision(12));

export interface Displayed {
  value: number | null;
  unit: string | null;
  /** Set when the framework's unit couldn't be reached from the canonical one. */
  unit_note: string | null;
}

/** A canonical value in the display unit, or kept canonical with a note when no exact conversion exists. */
export function toDisplay(value: number | null, canonical: string | null, display: string | null): Displayed {
  const f = displayFactor(canonical, display);
  if (f === null) {
    return { value, unit: canonical, unit_note: `Shown in ${canonical}: ${display} needs a conversion ESGLite doesn't make.` };
  }
  return { value: value === null ? null : tidy(value * f), unit: display || canonical, unit_note: null };
}
