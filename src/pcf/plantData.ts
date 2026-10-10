// A3 energy from the plant's own approved data (E1, part 4).
// Spec: docs/pcf/foundation/E1-data-and-engine/CLAUDE.md ("Calculation" 3),
// method note docs/pcf/phase0/method-note.md §2.5, §2.10, §2.12.
//
// Only approved Scope 1 and Scope 2 emissions at the study's site count.
// A row counts when the whole period it covers lies inside the reference
// period. A yearly batch or production row that only partly overlaps is never
// pro-rated: it is listed in `excluded` and blocks the calculation.
import { AppDataSource } from "../config/data-source";
import { Emission, EmissionStatus } from "../entities/Emission";
import { ProductionData, ProductionDataStatus } from "../entities/ProductionData";
import { PcfStudy, PcfAllocationKey } from "../entities/PcfStudy";
import { EngineAllocation, EngineEnergySource } from "./engine/computePcf";

const MASS_TO_T: Record<string, number> = { g: 1e-6, kg: 0.001, t: 1, tonne: 1, tonnes: 1, ton: 1, tons: 1, mt: 1 };
const massToT = (qty: number, unit: string) => {
  const f = MASS_TO_T[unit.trim().toLowerCase()];
  return f === undefined ? null : qty * f;
};

// Approved plant data is measured at the site in the reference period (§2.12).
export const PLANT_DQR = { technology: 1, geography: 1, time: 1 };

const ymd = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

// Scope number from Category.scope ("Scope 1", "Scope 2", ...); null when unset.
export function scopeNumber(scope: string | null | undefined): number | null {
  const m = /([123])/.exec(scope ?? "");
  return m ? Number(m[1]) : null;
}

// The dates a row covers. Monthly rows sit on one date; a yearly batch is
// stored on its period's last day and covers the twelve months up to it.
function emissionWindow(e: Emission): { start: string; end: string } {
  const end = ymd(e.date_of_reporting);
  if (e.reporting_period !== "yearly") return { start: end, end };
  const d = new Date(`${end}T00:00:00Z`);
  const start = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate() + 1));
  return { start: ymd(start), end };
}

const tco2e = (e: Emission) => {
  const v = Number(e.total_emission);
  return /^kg/i.test((e.unit ?? "").trim()) ? v / 1000 : v;
};

export interface KeyOverride {
  key_value_product?: number | null;
  key_value_site_total?: number | null;
}

export interface EnergySourceRow extends EngineEnergySource {
  emission_ids: number[];
}

export interface PlantData {
  allocation_key: PcfAllocationKey;
  reference_start: string;
  reference_end: string;
  sources: EnergySourceRow[];
  allocation: EngineAllocation | null;
  product_output_units: number | null;
  product_production_t: number | null;
  emission_ids_used: number[];
  production_ids_used: number[];
  excluded: { kind: "emission" | "production"; id: number; reason: string }[];
  blockers: string[];
  warnings: string[];
}

// Number of declared units in a production quantity, or null when the units can't be related.
function declaredUnits(study: PcfStudy, qty: number, unit: string): number | null {
  const p = study.product;
  const declQty = Number(p.declared_unit_qty ?? 1) || 1;
  const t = massToT(qty, unit);
  if (t !== null) {
    let perUnitKg = p.mass_per_unit_kg == null ? null : Number(p.mass_per_unit_kg);
    if (!perUnitKg && p.declared_unit) {
      const declT = massToT(declQty, p.declared_unit);
      perUnitKg = declT === null ? null : declT * 1000;
    }
    return perUnitKg ? (t * 1000) / perUnitKg : null;
  }
  if (p.declared_unit && p.declared_unit.trim().toLowerCase() === unit.trim().toLowerCase()) return qty / declQty;
  return null;
}

export async function loadPlantData(study: PcfStudy, override: KeyOverride = {}): Promise<PlantData> {
  const start = study.reference_start;
  const end = study.reference_end;
  const siteId = study.site.site_id;
  const productId = study.product.product_id;
  const out: PlantData = {
    allocation_key: study.allocation_key,
    reference_start: start,
    reference_end: end,
    sources: [],
    allocation: null,
    product_output_units: null,
    product_production_t: null,
    emission_ids_used: [],
    production_ids_used: [],
    excluded: [],
    blockers: [],
    warnings: [],
  };

  // Rows whose covered period can reach into [start, end]: monthly rows inside
  // it, yearly rows ending within a year after it.
  const emissions = await AppDataSource.getRepository(Emission)
    .createQueryBuilder("e")
    .leftJoinAndSelect("e.category", "c")
    .where("e.site_id = :siteId", { siteId })
    .andWhere("e.status = :approved", { approved: EmissionStatus.APPROVED })
    .andWhere("e.date_of_reporting >= :start AND e.date_of_reporting <= (CAST(:end AS date) + INTERVAL '1 year')", { start, end })
    .orderBy("e.pk_id")
    .getMany();

  const bySource = new Map<number, EnergySourceRow>();
  for (const e of emissions) {
    const w = emissionWindow(e);
    if (w.end < start || w.start > end) continue;
    const scope = scopeNumber(e.category?.scope);
    if (scope !== 1 && scope !== 2) continue; // Scope 3 and renewable (no scope) are outside A3 energy
    if (w.start < start || w.end > end) {
      out.excluded.push({ kind: "emission", id: e.pk_id, reason: `covers ${w.start} – ${w.end}, only partly inside the reference period` });
      out.blockers.push(
        `Approved ${e.category.category_name} data (entry ${e.pk_id}) covers ${w.start} – ${w.end}, only partly inside this footprint's period; use a period that matches how the site files it`,
      );
      continue;
    }
    const cid = e.category.category_id;
    const src =
      bySource.get(cid) ??
      ({ id: `cat-${cid}`, category_id: cid, category_name: e.category.category_name, scope, period_total_tco2e: 0, emission_ids: [] } as EnergySourceRow);
    src.period_total_tco2e += tco2e(e);
    src.emission_ids.push(e.pk_id);
    bySource.set(cid, src);
  }
  out.sources = [...bySource.values()].sort((a, b) => a.scope - b.scope || a.category_name.localeCompare(b.category_name));
  out.emission_ids_used = out.sources.flatMap((s) => s.emission_ids).sort((a, b) => a - b);
  if (!out.sources.length) out.warnings.push("No approved Scope 1 or 2 data at this site in the reference period, so A3 energy is 0");

  const production = await AppDataSource.getRepository(ProductionData)
    .createQueryBuilder("p")
    .leftJoinAndSelect("p.product", "product")
    .where("p.site_id = :siteId", { siteId })
    .andWhere("p.status = :approved", { approved: ProductionDataStatus.APPROVED })
    .andWhere("p.end_date >= :start AND p.start_date <= :end", { start, end })
    .orderBy("p.production_id")
    .getMany();

  let productUnits = 0;
  let productT = 0;
  let siteT = 0;
  let unitsKnown = true;
  let massKnown = true;
  let productMassOnly = true;
  const used: number[] = [];
  for (const p of production) {
    const ps = ymd(p.start_date);
    const pe = ymd(p.end_date);
    if (ps < start || pe > end) {
      out.excluded.push({ kind: "production", id: p.production_id, reason: `covers ${ps} – ${pe}, only partly inside the reference period` });
      out.blockers.push(
        `Approved production of ${p.product?.name ?? "a product"} (entry ${p.production_id}) covers ${ps} – ${pe}, only partly inside this footprint's period`,
      );
      continue;
    }
    const qty = Number(p.quantity);
    const t = massToT(qty, p.unit);
    const mine = p.product?.product_id === productId;
    if (t === null) {
      massKnown = false;
      if (study.allocation_key === "mass") {
        out.blockers.push(`Production row ${p.production_id} (${p.product?.name ?? "product"}) is in "${p.unit}", not a mass unit, so it can't count toward a mass key`);
      }
    } else siteT += t;
    if (mine) {
      const units = declaredUnits(study, qty, p.unit);
      if (units === null) unitsKnown = false;
      else productUnits += units;
      if (t !== null) productT += t;
      else productMassOnly = false;
    }
    used.push(p.production_id);
  }
  out.production_ids_used = used;

  const mineUsed = production.filter((p) => p.product?.product_id === productId && used.includes(p.production_id)).length;
  if (!mineUsed) {
    const msg = "No approved production of this product at this site in the reference period";
    if (out.sources.length) out.blockers.push(msg);
    else out.warnings.push(msg);
  } else if (!unitsKnown) {
    out.blockers.push("Set the product's declared unit and mass per declared unit, so production can be counted in declared units");
  } else {
    out.product_output_units = productUnits;
    out.product_production_t = productMassOnly ? productT : null;
  }

  let keyProduct: number | null = null;
  let keySite: number | null = null;
  if (study.allocation_key === "mass") {
    if (massKnown) {
      keyProduct = productT;
      keySite = siteT;
      if (out.sources.length && !(siteT > 0)) out.blockers.push("The site's approved production in the reference period adds up to 0");
    }
  } else {
    keyProduct = override.key_value_product ?? null;
    keySite = override.key_value_site_total ?? null;
    if (keyProduct === null || keySite === null) {
      if (out.sources.length) out.blockers.push(`Enter this product's and the whole site's ${study.allocation_key.replace("_", " ")} for the reference period`);
    } else if (!(keySite > 0) || keyProduct < 0 || keyProduct > keySite) {
      out.blockers.push("The product's key value must be between 0 and the site total, and the site total above 0");
    }
  }

  if (out.sources.length && !out.blockers.length && keyProduct !== null && keySite !== null && out.product_output_units) {
    out.allocation = {
      key_value_product: keyProduct,
      key_value_site_total: keySite,
      product_output_units: out.product_output_units,
      dqr: PLANT_DQR,
    };
  }
  return out;
}

// Per-source share of the plant total that one declared unit carries.
export function allocatedRows(data: PlantData) {
  const a = data.allocation;
  const share = a ? a.key_value_product / a.key_value_site_total : null;
  return data.sources.map((s) => ({
    category_id: s.category_id ?? null,
    category_name: s.category_name,
    scope: s.scope,
    period_total_tco2e: s.period_total_tco2e,
    emission_ids: s.emission_ids,
    share_pct: share === null ? null : share * 100,
    allocated_kg_per_unit: share === null || !a ? null : (s.period_total_tco2e * 1000 * share) / a.product_output_units,
  }));
}
