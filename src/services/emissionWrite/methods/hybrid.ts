/**
 * Hybrid method (S3-6): the supplier's own Scope 1 + 2 allocated to what we
 * bought, plus the material inputs, transport and waste lines × their
 * factors (guidance formulas [1.2], L1832, and [1.3], L1942; Examples 1.2 and
 * 1.3). Each part is stored in the snapshot as `components[]`, and the row's
 * total is their sum.
 *
 * The supplier's Scope 1 + 2 comes from one of two places, never both:
 *   - `energy` lines: the supplier's allocated activity (kWh of electricity,
 *     gas…) for our order, × factors, as in Examples 1.2 and 1.3;
 *   - otherwise its facility data: `scope12_tco2e × purchased / output`,
 *     by mass (the row's quantity in the facility's output unit) or by
 *     economic value (what was paid, in the facility's output currency),
 *     with the allocation rule PCF uses (`src/scope3/suppliers/allocate.ts`).
 * A row with energy lines and no facility data is fine; a row with neither
 * has no supplier part and is refused, since that is just average data.
 */
import { pickActivityValue } from "../../activityValue";
import { unitsMatchExact } from "../units";
import { applyFactor } from "./activity";
import { toUnit, totalsFromKg } from "./supplier";
import type { CategoryContext, ComputeResult, EngineRow } from "../compute";
import { allocatedKg, allocationShare } from "../../../scope3/suppliers/allocate";
import type { HybridLineKind } from "../../../scope3/suppliers/engineInput";

export type HybridComponent =
  | {
      kind: "supplier_scope12";
      label: string;
      supplier_facility_data_id: number;
      year: number;
      scope12_tco2e: number;
      allocation_key: "mass" | "economic";
      purchased_qty: number;
      output_qty: number;
      output_unit: string;
      share: number;
      kgco2e: number;
    }
  | {
      kind: HybridLineKind;
      label: string;
      quantity: number;
      unit: string;
      emission_factor_id: number;
      factor_value: string;
      denominator_unit: string;
      year: number;
      kgco2e: number;
    };

const fail = (code: "FIELD_REQUIRED" | "FIELD_INVALID" | "UNIT_NOT_CONVERTIBLE", message: string, field: string): ComputeResult => ({
  ok: false,
  issue: { code, message, field },
});

export const compute = (ctx: CategoryContext, row: EngineRow): ComputeResult => {
  const supplier = row.supplier;
  if (!supplier) return fail("FIELD_REQUIRED", "Choose the supplier to use the supplier's energy and materials.", "supplier_id");

  const unit = row.activity_unit;
  const activityValue = pickActivityValue(row.activity_data, ctx.selectColumns);
  const lines = supplier.lines ?? [];
  const components: HybridComponent[] = [];

  const hasEnergyLines = lines.some((l) => l.kind === "energy");
  if (!hasEnergyLines) {
    const facility = supplier.facility;
    if (!facility) {
      return fail(
        "FIELD_REQUIRED",
        "No facility data from this supplier for this year. Add its Scope 1 and 2 and output on the Suppliers page, or give its energy use as input lines.",
        "supplier_facility_data",
      );
    }
    if (!(facility.output_qty > 0)) return fail("FIELD_INVALID", "The supplier's facility output must be greater than 0.", "supplier_facility_data");

    // What we bought, in the facility's own output unit: the row's quantity
    // (by mass), or what was paid (by economic value). A row whose quantity is
    // already in the output currency can stand for what was paid.
    let purchased: number | null;
    if (facility.allocation_key === "economic") {
      purchased = supplier.purchased_value ?? (unitsMatchExact(unit, facility.output_unit) ? activityValue : null);
      if (purchased === null || !(purchased > 0)) {
        return fail("FIELD_REQUIRED", `Give what was paid for these goods, in ${facility.output_unit}, to allocate the supplier's emissions by value.`, "purchased_value");
      }
    } else {
      purchased = activityValue > 0 ? toUnit(activityValue, unit, facility.output_unit) : 0;
      if (purchased === null) {
        return fail("UNIT_NOT_CONVERTIBLE", `The supplier's output is in "${facility.output_unit}" but the quantity is in "${unit}". No conversion available.`, "activity_unit");
      }
    }
    if (purchased > facility.output_qty) {
      return fail("FIELD_INVALID", "More was bought than the supplier's facility made that year. Check the quantity or the facility data.", "activity_value");
    }
    const share = allocationShare(purchased, facility.output_qty);
    components.push({
      kind: "supplier_scope12",
      label: "Supplier's Scope 1 and 2, allocated",
      supplier_facility_data_id: facility.supplier_facility_data_id,
      year: facility.year,
      scope12_tco2e: facility.scope12_tco2e,
      allocation_key: facility.allocation_key,
      purchased_qty: purchased,
      output_qty: facility.output_qty,
      output_unit: facility.output_unit,
      share,
      kgco2e: allocatedKg(facility.scope12_tco2e, share),
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const r = applyFactor(line.quantity, line.unit, line.factor);
    if (!r.ok) return { ok: false, issue: { ...r.issue, message: `Input line ${i + 1} (${line.name}): ${r.issue.message}`, field: `extra_data.inputs[${i}]` } };
    components.push({
      kind: line.kind,
      label: line.name,
      quantity: line.quantity,
      unit: line.unit,
      emission_factor_id: line.factor.emission_factor_id,
      factor_value: String(line.factor.factor_value),
      denominator_unit: line.factor.denominator_unit,
      year: line.factor.year,
      kgco2e: Number(r.computed.total_kgco2e),
    });
  }

  const kg = components.reduce((sum, c) => sum + c.kgco2e, 0);
  const facilityPart = components.find((c) => c.kind === "supplier_scope12");
  // The oldest figure in the row sets its time score: a total is only as
  // recent as its oldest part.
  const years = components.map((c) => c.year).filter((y) => Number.isFinite(y));
  return {
    ok: true,
    computed: {
      activityValue,
      activity_unit: unit,
      ...totalsFromKg(kg),
      snapshot: {
        factor_type: "supplier",
        dataset: "supplier",
        method: "hybrid",
        supplier_id: supplier.supplier_id,
        ...(facilityPart ? { supplier_facility_data_id: facilityPart.supplier_facility_data_id, allocation_key: facilityPart.allocation_key } : {}),
        components,
        total_kgco2e: kg,
      },
      supplier_id: supplier.supplier_id,
      quality: {
        factor: { geography: supplier.country, year: years.length ? Math.min(...years) : null, factor_type: null },
        siteCountry: supplier.country,
      },
    },
  };
};
