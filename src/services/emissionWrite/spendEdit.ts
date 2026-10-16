/**
 * S3-5 · recalculating an edited spend row through the engine.
 *
 * `updateEmission` and `managerUpdateEmission` still compute other rows
 * themselves (they move onto the engine in S3-4). A spend row can't: its total
 * needs the stored rate of its purchase date and the deflator. So for a spend
 * row the edit paths call this, which runs `prepareEntry` with the row's saved
 * `fx` (reused when the currency and date are unchanged, so the total doesn't
 * move with today's rates) and returns what to store.
 */
import { EntityManager } from "typeorm";
import type { Emission } from "../../entities/Emission";
import type { EmissionFactor } from "../../entities/EmissionFactor";
import { isSpendRow, spendInputOf } from "../../scope3/spend/inputs";
import type { EmissionFx } from "../../scope3/spend/types";
import { CheckCache } from "./checks";
import { factorSnapshot, type EngineIssue } from "./compute";
import { ContextCache } from "./context";
import { prepareEntry } from "./index";

export type SpendEdit =
  | { ok: true; total: number; snapshot: ReturnType<typeof factorSnapshot>; fx: EmissionFx | null; unit: string | null }
  | { ok: false; issue: EngineIssue };

const isoDay = (d: Date | string): string => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

/**
 * The engine's result for an edited row, or null when the row isn't a spend
 * row (no spend method and no spend factor, or no amount in a currency): the
 * caller then calculates it as before.
 */
export async function recalculateSpendEdit(
  manager: EntityManager,
  emission: Emission,
  activity_data: Record<string, any>,
  factor: EmissionFactor,
  extra_data: Record<string, any> | null | undefined,
): Promise<SpendEdit | null> {
  if (!isSpendRow(activity_data, factor)) return null;
  const date = isoDay(emission.date_of_reporting);
  if (!spendInputOf(activity_data, extra_data, emission.activity_data_unit, date)) return null;
  const site_id = emission.site.site_id;
  const category_id = emission.category.category_id;
  const ctx = await new ContextCache(manager).context(site_id, category_id);
  const prepared = await prepareEntry(ctx, new CheckCache(manager), {
    site_id,
    category_id,
    activity_data,
    activity_data_unit: emission.activity_data_unit,
    period: { date_of_reporting: date, reporting_period: emission.reporting_period, year_type: emission.year_type },
    extra_data: extra_data ?? {},
    storedFx: emission.fx,
  });
  if (!prepared.ok) return prepared;
  const { factor: used, computed, input } = prepared.entry;
  if (!used || !computed) return { ok: false, issue: { code: "NO_FACTOR_FOR_YEAR", message: `No emission factor found for category "${activity_data.emission_category}"` } };
  return {
    ok: true,
    total: computed.total,
    snapshot: factorSnapshot(used, computed.deflator),
    fx: computed.fx ?? null,
    unit: input.activity_data_unit ?? null,
  };
}
