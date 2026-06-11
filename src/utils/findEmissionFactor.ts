import { Repository } from "typeorm";
import { EmissionFactor } from "../entities/EmissionFactor";

interface LookupArgs {
  site_id: number;
  category_id: number;
  emissionCategory: string;
  year: number;
}

const normalize = (s: string | null | undefined): string =>
  (s ?? "").trim().toLowerCase();

/**
 * Resolve the emission factor for a site + category + emission-category value,
 * trying progressively looser matches:
 *   1. exact emission_category_name + year
 *   2. exact global_category_name + year
 *   3. exact emission_category_name (any year)
 *   4. exact global_category_name (any year)
 *   5. normalized (trim + case-insensitive) emission_category_name + year
 *   6. normalized emission_category_name (any year)
 *
 * Steps 5–6 guard against whitespace/casing drift between uploaded factor
 * names and the value the data-entry form submits. They do NOT bridge
 * structurally different names (e.g. a leaf "CNG [km]" vs the full
 * "Road - Van - CNG [km]") — those require fixing the data.
 */
export const findEmissionFactorForCategory = async (
  repo: Repository<EmissionFactor>,
  { site_id, category_id, emissionCategory, year }: LookupArgs
): Promise<EmissionFactor | null> => {
  const base = { site: { site_id }, category: { category_id } };

  const exact =
    (await repo.findOne({ where: { ...base, emission_category_name: emissionCategory, year } })) ||
    (await repo.findOne({ where: { ...base, global_category_name: emissionCategory, year } })) ||
    (await repo.findOne({ where: { ...base, emission_category_name: emissionCategory } })) ||
    (await repo.findOne({ where: { ...base, global_category_name: emissionCategory } }));

  if (exact) return exact;

  // Normalized fallback: load this site+category's factors and compare
  // case/space-insensitively. The candidate set is small (≤ a few hundred).
  const candidates = await repo.find({ where: base });
  const target = normalize(emissionCategory);
  const matches = candidates.filter(
    (f) =>
      normalize(f.emission_category_name) === target ||
      normalize(f.global_category_name) === target
  );

  return (
    matches.find((f) => f.year === year) ||
    matches[0] ||
    null
  );
};
