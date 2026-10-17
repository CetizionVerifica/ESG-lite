/**
 * S3-12 · screening estimates: a rough tCO₂e per category from one cheap
 * figure (layer rule 1 exception: shown as an estimate, never saved as an
 * emission row).
 *
 *   spend, revenue  amount in a currency × the USEEIO sector factor (S3-5
 *                   library), through S3-5's FX rate at mid-year and its
 *                   deflator, by the engine's own spend method (so the maths
 *                   is the one a spend row would get)
 *   headcount       Category 7 only: employees × the screening commute below
 *   mass_sold,      no estimate (the input is kept and shown; the category is
 *   other           sized from its recorded rows)
 */
import type { EntityManager } from "typeorm";
import type { EmissionFactor } from "../../entities/EmissionFactor";
import * as spendMethod from "../../services/emissionWrite/methods/spend";
import * as activity from "../../services/emissionWrite/methods/activity";
import type { CategoryContext } from "../../services/emissionWrite/compute";
import { SpendRateSource } from "../spend/rates";
import { TRAVEL_FACTORS } from "../commuting/factors";

export type EstimateBasis = "spend" | "revenue" | "headcount";

export interface InputRow {
  ghg_category: number;
  basis: string;
  amount: number;
  currency: string | null;
  eeio_sector: string | null;
}

export interface Estimate {
  kg: number | null;
  basis: EstimateBasis | null;
  /** Why there is no estimate, or what it assumed (plain words, for the drawer). */
  note: string | null;
  /** The library sector the estimate used. */
  sector?: { code: string | null; name: string; factor_value: string; price_base_year: number | null } | null;
  /** FX and deflator the spend estimate used. */
  fx?: { currency: string; to: string; rate: number; as_of: string } | null;
  warnings?: string[];
}

/**
 * The commute a screening estimate assumes per employee, for Category 7
 * without a survey: every employee drives an average car (unknown fuel, the
 * DEFRA 2025 factor S3-9 seeds), 15 km each way, 2 trips a day, 230 working
 * days. S3-9's average-data form has fields but no defaults, so these are
 * S3-12's; they only size the category, and the drawer shows them.
 */
export const COMMUTE_SCREENING = {
  one_way_km: 15,
  trips_per_day: 2,
  working_days: 230,
  factor_name: "Car - Average car - Unknown fuel [vehicle.km]",
} as const;

const commuteFactor = (): { value: number; year: string } | null => {
  const f = TRAVEL_FACTORS.find((x) => x.name === COMMUTE_SCREENING.factor_name);
  const year = f ? Object.keys(f.values).sort().pop() : undefined;
  return f && year ? { value: f.values[year].value, year } : null;
};

/** The screening date for a year's FX rate and deflator: the middle of the year (1 July CY, 1 October for an April FY). */
export const midYear = (year: number, yearType: "CY" | "FY"): string => (yearType === "FY" ? `${year - 1}-10-01` : `${year}-07-01`);

/** "Air transportation (NAICS 481000)" → "481000". */
export const sectorCode = (name: string): string | null => /\(NAICS ([0-9A-Za-z]+)\)\s*$/.exec(name)?.[1] ?? null;

const ctxFor = (): CategoryContext => ({
  site_id: 0,
  category_id: 0,
  category_name: "Scope 3 screening",
  scope: "Scope 3",
  assigned: true,
  hasForm: false,
  spec: null,
  selectColumns: new Set(),
  factors: null as any,
  fera: null,
});

export class Estimator {
  private readonly rates: SpendRateSource;
  private readonly sectors = new Map<string, Promise<EmissionFactor | null>>();

  constructor(private readonly manager: EntityManager, private readonly year: number, private readonly yearType: "CY" | "FY") {
    this.rates = new SpendRateSource(manager);
  }

  /** The library (USEEIO) factor for a sector code or full name; newest price year first. */
  private sector(key: string): Promise<EmissionFactor | null> {
    let p = this.sectors.get(key);
    if (!p) {
      p = this.manager
        .query(
          `SELECT emission_factor_id, emission_category_name, global_category_name, factor_value, denominator_unit, source, year,
                  factor_type, gwp_set, geography, dataset, dataset_version, price_base_year, price_currency
             FROM emission_factors
            WHERE site_id IS NULL AND factor_type = 'eeio_spend'
              AND (emission_category_name = $1 OR emission_category_name LIKE '%(NAICS ' || $1 || ')')
            ORDER BY price_base_year DESC NULLS LAST, year DESC, emission_factor_id DESC
            LIMIT 1`,
          [key],
        )
        .then((rows: any[]) => (rows[0] ? ({ ...rows[0], price_base_year: rows[0].price_base_year == null ? null : Number(rows[0].price_base_year) } as EmissionFactor) : null));
      this.sectors.set(key, p);
    }
    return p;
  }

  async estimate(input: InputRow): Promise<Estimate> {
    const amount = Number(input.amount);
    if (input.basis === "headcount") {
      if (input.ghg_category !== 7) return { kg: null, basis: null, note: "Headcount estimates Category 7 (employee commuting) only." };
      const f = commuteFactor();
      if (!f) return { kg: null, basis: null, note: "The commuting factor isn't available." };
      const km = amount * COMMUTE_SCREENING.one_way_km * COMMUTE_SCREENING.trips_per_day * COMMUTE_SCREENING.working_days;
      const factor = { emission_factor_id: 0, emission_category_name: COMMUTE_SCREENING.factor_name, factor_value: String(f.value), denominator_unit: "vehicle.km" } as unknown as EmissionFactor;
      const r = activity.applyFactor(km, "vehicle.km", factor);
      return {
        kg: r.ok ? Number(r.computed.total_kgco2e) : null,
        basis: "headcount",
        note: `${amount.toLocaleString("en-US")} employees × ${COMMUTE_SCREENING.one_way_km} km each way × ${COMMUTE_SCREENING.trips_per_day} trips × ${COMMUTE_SCREENING.working_days} days by average car (DEFRA ${f.year}, ${f.value} kgCO₂e per vehicle.km)`,
      };
    }
    if (input.basis !== "spend" && input.basis !== "revenue") return { kg: null, basis: null, note: "This basis has no screening estimate; the category is sized from its recorded rows." };
    if (!input.currency) return { kg: null, basis: null, note: "Add the currency to estimate from this amount." };
    if (!input.eeio_sector) return { kg: null, basis: null, note: "Choose a sector to estimate from this amount." };
    const factor = await this.sector(input.eeio_sector);
    if (!factor) return { kg: null, basis: null, note: "The sector isn't in the spend factor library." };
    const quoted = await this.rates.quote({ amount, currency: input.currency, spend_date: midYear(this.year, this.yearType), amount_from: "spent_value" }, factor);
    if (!quoted.ok) return { kg: null, basis: null, note: quoted.message };
    const r = spendMethod.compute(ctxFor(), {
      factor,
      activity_data: { activity_value: String(amount) },
      activity_unit: input.currency,
      method: "spend_based",
      spend: quoted.quote,
    });
    if (!r.ok) return { kg: null, basis: null, note: r.issue.message };
    const c = r.computed;
    return {
      kg: Number(c.total_kgco2e),
      basis: input.basis,
      note: null,
      sector: { code: sectorCode(factor.emission_category_name), name: factor.emission_category_name, factor_value: String(factor.factor_value), price_base_year: factor.price_base_year ?? null },
      fx: c.fx ? { currency: c.fx.currency, to: c.fx.to, rate: c.fx.rate, as_of: c.fx.as_of } : null,
      ...(c.warnings?.length ? { warnings: c.warnings.map((w) => w.message) } : {}),
    };
  }
}

/** Which input sizes a category when it has several: spend first, then revenue, then headcount. */
export const ESTIMATE_ORDER: EstimateBasis[] = ["spend", "revenue", "headcount"];
