/**
 * Which units a data-entry row may use for its emission category (ESG-lite
 * #183, U1-BE). Pure: no database, no totals. It only answers "would the
 * engine accept this unit", with the same checks `applyFactor` runs
 * (`unitsMatchExact`, then `getConversionFactor`), so a unit offered here is
 * never refused with UNIT_NOT_CONVERTIBLE on save.
 */
import { normalizeUnitKey } from "../calculationSpec";
import { normalizeName } from "./resolve";
import { canonicalUnit, convertibleUnitsOf, getConversionFactor, unitsMatchExact } from "./units";
import type { LoadedContext } from "./context";

export interface AllowedUnitsInput {
  /** The activity's factor units, newest factor first. Blank ones are ignored. */
  factorUnits: Array<string | null | undefined>;
  /** Units the form could offer (the admin's unit rows first, so their spelling wins). */
  candidates: string[];
  /** SE-2 `form.units.fixed`: when set, it is the only unit. */
  fixedUnit?: string | null;
  /** A per_unit calculation spec: the engine reads the row's unit as `normalizeUnitKey` before the factor step. */
  perUnit?: boolean;
  /** The per_unit spec's unit keys: a unit outside them is refused before the factor step. */
  specUnitKeys?: string[] | null;
}

const clean = (units: Array<string | null | undefined>): string[] => units.map((u) => (u ?? "").trim()).filter(Boolean);

/**
 * The units a row may use, the factor's own unit first. Duplicates by
 * canonical key are dropped, keeping the first spelling (the admin's). With
 * no factor unit the candidates come back unfiltered: the engine refuses such
 * a row with UNIT_REQUIRED whatever the unit.
 */
export const allowedUnitsFor = ({ factorUnits, candidates, fixedUnit, perUnit = false, specUnitKeys }: AllowedUnitsInput): string[] => {
  if (fixedUnit?.trim()) return [fixedUnit.trim()];
  const rowUnit = (u: string) => (perUnit ? normalizeUnitKey(u) : u);
  const keyOf = (u: string) => canonicalUnit(rowUnit(u));
  const unique = (units: string[]) => {
    const seen = new Set<string>();
    return units.filter((u) => !seen.has(keyOf(u)) && !!seen.add(keyOf(u)));
  };

  const factors = unique(clean(factorUnits));
  const pool = unique([...clean(candidates), ...factors]);
  if (!factors.length) return pool;

  const fits = (u: string) => factors.some((f) => unitsMatchExact(f, rowUnit(u)) || getConversionFactor(rowUnit(u), f) !== null);
  const own = factors.map((f) => pool.find((u) => keyOf(u) === keyOf(f)) ?? f);
  const rest = pool.filter((u) => !own.some((o) => keyOf(o) === keyOf(u)) && fits(u));
  const allowed = unique([...own, ...rest]);

  const keys = (specUnitKeys ?? []).map(normalizeUnitKey);
  const configured = keys.length ? allowed.filter((u) => keys.includes(normalizeUnitKey(u))) : [];
  return configured.length ? configured : allowed;
};

export interface UnitOptionsByActivity {
  /** form.units.fixed (SE-2), else null. */
  fixed_unit: string | null;
  /** Today's flat list (admin units ∪ factor units), for a row with no emission category yet. */
  all_units: string[];
  activities: Array<{
    /** As stored: a factor name, a global name or a company alias. */
    name: string;
    /** An alias → the factor name it points at. */
    maps_to?: string;
    /** The newest factor's denominator_unit. */
    factor_unit: string | null;
    /** The allowed list, factor unit first. */
    units: string[];
  }>;
}

export interface UnitOptionsSource {
  factors: Array<{ emission_factor_id: number; emission_category_name: string | null; global_category_name: string | null; denominator_unit: string | null; year: number }>;
  /** Client wording → factor name, as the engine resolves it (mappings win over a factor of the same name). */
  mappings: Array<{ name: string; factor_name: string; emission_factor_id: number | null }>;
  /** The admin's unit rows for the site × category. */
  formUnits: string[];
  /** Units named by the form's method_options. */
  methodUnits: string[];
  fixedUnit: string | null;
  perUnit: boolean;
  specUnitKeys: string[] | null;
}

type Factor = UnitOptionsSource["factors"][number];
const newestFirst = (a: Factor, b: Factor) => b.year - a.year || a.emission_factor_id - b.emission_factor_id;

/** Every activity name of a site × category with the units its rows may use. */
export const buildUnitOptions = (src: UnitOptionsSource): UnitOptionsByActivity => {
  // Distinct spellings only: a spend category has thousands of factors in one or two currencies.
  const factorUnitList = [...new Set(clean([...src.factors].sort(newestFirst).map((f) => f.denominator_unit)))];
  const candidates = [...src.formUnits, ...src.methodUnits, ...factorUnitList];
  const options = (factors: Factor[]) => {
    const sorted = [...factors].sort(newestFirst);
    const factorUnits = sorted.map((f) => f.denominator_unit);
    // Every unit the engine converts to the factor's unit is offered too, after the admin's units so
    // their spelling wins (#183 follow-up): an auto-generated form has only the factor's unit.
    const convertible = [...new Set(clean(factorUnits))].flatMap(convertibleUnitsOf);
    return {
      factor_unit: clean(factorUnits)[0] ?? null,
      units: allowedUnitsFor({ factorUnits, candidates: [...candidates, ...convertible], fixedUnit: src.fixedUnit, perUnit: src.perUnit, specUnitKeys: src.specUnitKeys }),
    };
  };

  const byName = new Map<string, UnitOptionsByActivity["activities"][number]>();
  const groups = new Map<string, { name: string; factors: Factor[] }>();
  for (const f of src.factors) {
    for (const name of [f.emission_category_name, f.global_category_name]) {
      const key = normalizeName(name);
      if (!key) continue;
      const group = groups.get(key) ?? groups.set(key, { name: (name ?? "").trim(), factors: [] }).get(key)!;
      if (!group.factors.includes(f)) group.factors.push(f);
    }
  }
  for (const [key, group] of groups) byName.set(key, { name: group.name, ...options(group.factors) });
  for (const m of src.mappings) {
    const key = normalizeName(m.name);
    if (!key) continue;
    const pinned = m.emission_factor_id ? src.factors.find((f) => f.emission_factor_id === m.emission_factor_id) : undefined;
    const target = pinned ? [pinned] : (groups.get(normalizeName(m.factor_name))?.factors ?? []);
    byName.set(key, { name: m.name.trim(), maps_to: m.factor_name, ...options(target) });
  }

  const seen = new Set<string>();
  const all = clean([...src.formUnits, ...factorUnitList]).filter((u) => !seen.has(canonicalUnit(u)) && !!seen.add(canonicalUnit(u)));
  return {
    fixed_unit: src.fixedUnit?.trim() || null,
    all_units: all,
    activities: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
};

/** The unit-options input of one site × category, from the engine's own context. */
export const unitOptionsSourceOf = (ctx: LoadedContext): UnitOptionsSource => {
  const perUnit = ctx.spec?.mode === "per_unit";
  return {
    factors: ctx.factors.factors,
    mappings: ctx.mappings.entries(),
    formUnits: ctx.formUnits ?? [],
    methodUnits: ctx.method_unit_names ?? [],
    fixedUnit: ctx.form?.fixed_unit ?? null,
    perUnit,
    specUnitKeys: perUnit ? Object.keys(ctx.spec?.methods ?? {}) : null,
  };
};

/** The allowed units of one activity name (case-blind), or null when the name isn't one of the site × category's. */
export const unitsForActivity = (options: UnitOptionsByActivity, name: string): string[] | null =>
  options.activities.find((a) => normalizeName(a.name) === normalizeName(name))?.units ?? null;

/** Whether `unit` is one of `allowed`, with aliases and spellings folded as the engine folds them ("Ltr" is litre). */
export const isUnitAllowed = (allowed: string[], unit: string, perUnit = false): boolean => {
  const keyOf = (u: string) => canonicalUnit(perUnit ? normalizeUnitKey(u) : u);
  return allowed.some((u) => keyOf(u) === keyOf(unit));
};
