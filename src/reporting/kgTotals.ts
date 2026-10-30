/**
 * D14 (#209 follow-up, decided 30 Oct 2026): every reported tCO₂e total adds
 * the rows' exact kgCO₂e and rounds once. The GHG tables, the Scope 3 section,
 * EDE, Overview, targets, intensity, export totals and the studio's monthly
 * split all total rows through these helpers, so a figure shown in two places
 * is the same figure: two approved rows of 1,234.4 kg (stored 1.234 t each)
 * report 2.469 t everywhere, not 2.468 in one section and 2.469 in another.
 *
 * Nothing here calculates a row: it reads what emissionWrite stored. A row
 * saved before kg totals (total_kgco2e null) counts as its stored tCO₂e × 1000.
 * A row's own total (its `total_emission`) is shown as stored.
 *
 *   rowKgSql(alias)          one row's kgCO₂e in SQL
 *   sumKgSql(alias, when?)   SUM of the rows' kgCO₂e (only rows matching `when`), 0 when none
 *   rowKg(row)               one row's kgCO₂e in JS (an entity or a raw row)
 *   sumKg(list) / addKg(...) kg figures added exactly (each to 4 dp, as stored)
 *   kgToTonnes(kg)           kgCO₂e → tCO₂e, rounded once (roundTonnes, 3 dp)
 */
import { roundTonnes } from "../services/emissionWrite/round";

/** One emission row's kgCO₂e (`alias` = the emission table's alias): the stored kg, else the stored tonnes × 1000. */
export const rowKgSql = (alias: string): string => `COALESCE(${alias}.total_kgco2e, ${alias}.total_emission::numeric * 1000)`;

/** SUM of the rows' kgCO₂e, 0 when there are none; with `when`, only the rows matching that SQL condition. */
export const sumKgSql = (alias: string, when?: string): string =>
  when ? `COALESCE(SUM(CASE WHEN ${when} THEN ${rowKgSql(alias)} ELSE 0 END), 0)` : `COALESCE(SUM(${rowKgSql(alias)}), 0)`;

/** One row's kgCO₂e in JS, by the same rule as rowKgSql. */
export const rowKg = (row: { total_kgco2e?: unknown; total_emission?: unknown }): number =>
  row.total_kgco2e !== null && row.total_kgco2e !== undefined && row.total_kgco2e !== ""
    ? Number(row.total_kgco2e) || 0
    : (Number(row.total_emission) || 0) * 1000;

/**
 * kg figures added exactly: each is taken to 4 dp (the stored precision) and
 * summed in whole 0.0001 kg, so float noise from adding many of them can never
 * move a total across a rounding edge.
 */
export const sumKg = (kg: Iterable<unknown>): number => {
  let units = 0;
  for (const v of kg) units += Math.round((Number(v) || 0) * 10000);
  return units / 10000;
};

/** sumKg for a few figures: addKg(a, b, c). */
export const addKg = (...kg: unknown[]): number => sumKg(kg);

/**
 * kgCO₂e → tCO₂e, rounded once to 3 dp by roundTonnes, the arithmetic every
 * row's stored total and the Scope 3 section (ghg-scope3 `kgToT`) use.
 */
export const kgToTonnes = (kg: unknown): number => roundTonnes((Number(kg) || 0) / 1000) || 0;
