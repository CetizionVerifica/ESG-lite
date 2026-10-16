/**
 * S3-6 · What the supplier-specific and hybrid methods need about a supplier,
 * loaded once per entry and handed to the engine on the row (layer rule 1:
 * this module prepares inputs, `emissionWrite/methods/` does the maths).
 *
 * Everything is read inside the caller's company: a supplier, factor or
 * facility row of another company is never loaded, so it can never reach a
 * calculation (layer rule 2).
 */
import type { EntityManager } from "typeorm";
import type { EmissionFactor } from "../../entities/EmissionFactor";
import type { AllocationKey } from "./allocate";

/** A supplier's own cradle-to-gate figure for one item (`supplier_factor`). */
export interface SupplierFactorInput {
  supplier_factor_id: number;
  item: string;
  unit: string;
  kgco2e_per_unit: number;
  boundary: string;
  reference_year: number;
  gwp_set: string | null;
  /** An evidence document is attached to the figure (C06 file or upload). */
  has_evidence: boolean;
  source: "supplier_request" | "manual";
}

/** A supplier facility's Scope 1 + 2 for a year (`supplier_facility_data`). */
export interface FacilityInput {
  supplier_facility_data_id: number;
  year: number;
  scope12_tco2e: number;
  output_qty: number;
  output_unit: string;
  allocation_key: AllocationKey;
}

/** The kinds of line a hybrid row adds up (guidance formula [1.2]). */
export const HYBRID_LINE_KINDS = ["energy", "material", "transport", "waste"] as const;
export type HybridLineKind = (typeof HYBRID_LINE_KINDS)[number];

/**
 * One hybrid input line as stored on the row (`extra_data.inputs[]`): what it
 * is, how much, and the activity name of the factor it is multiplied by.
 * `energy` lines are the supplier's own allocated Scope 1 + 2 activity (for
 * example kWh per order); when there are none, the supplier's facility data is
 * allocated instead.
 */
export interface HybridLineInput {
  kind: HybridLineKind;
  name: string;
  quantity: number;
  unit: string;
}

/** A hybrid line once its factor is resolved from the site × category's factors. */
export interface HybridLine extends HybridLineInput {
  factor: EmissionFactor;
}

/** What the engine gets on `EngineRow.supplier`. */
export interface SupplierEngineInput {
  supplier_id: number;
  /** ISO-3166 alpha-2, when known: where the supplier's production happens. */
  country: string | null;
  /** supplier_specific: the figure to use, already chosen (`pickSupplierFactor`). */
  factor?: SupplierFactorInput | null;
  /** hybrid: the facility data for the newest year up to the reporting year. */
  facility?: FacilityInput | null;
  /** hybrid: the resolved input lines. */
  lines?: HybridLine[];
  /** hybrid, economic allocation: what was paid, in the facility's output unit (a currency). */
  purchased_value?: number | null;
}

/** A supplier and everything it has given, for one company. */
export interface LoadedSupplier {
  supplier_id: number;
  name: string;
  country: string | null;
  factors: SupplierFactorInput[];
  facilities: FacilityInput[];
}

const fold = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

/**
 * Whether a figure has evidence: a document attached to it, or — for a figure
 * from an accepted C06 request — the file the supplier sent with its answer,
 * which stays on the request (`supplier_request.reply_file`). Alias `sf`.
 */
export const FACTOR_EVIDENCE_SQL = `(sf.evidence_document_id IS NOT NULL OR EXISTS (
  SELECT 1 FROM supplier_request sr
   WHERE sr.material_factor_id = sf.material_factor_id AND sf.material_factor_id IS NOT NULL
     AND sr.company_id = sf.company_id AND sr.reply_file_name IS NOT NULL))`;

/** Loads a supplier of `companyId` with its factors and facility data, or null when it is not that company's. */
export const loadSupplier = async (manager: EntityManager, companyId: number, supplierId: number): Promise<LoadedSupplier | null> => {
  if (!Number.isInteger(supplierId) || supplierId <= 0) return null;
  const [supplier] = await manager.query(`SELECT supplier_id, name, country FROM "supplier" WHERE supplier_id = $1 AND company_id = $2`, [supplierId, companyId]);
  if (!supplier) return null;
  const [factors, facilities] = await Promise.all([
    manager.query(
      `SELECT sf.supplier_factor_id, sf.item, sf.unit, sf.kgco2e_per_unit, sf.boundary, sf.reference_year, sf.gwp_set, sf.source,
              ${FACTOR_EVIDENCE_SQL} AS has_evidence
         FROM supplier_factor sf WHERE sf.supplier_id = $1 AND sf.company_id = $2
        ORDER BY sf.reference_year DESC, sf.supplier_factor_id DESC`,
      [supplierId, companyId],
    ),
    manager.query(
      `SELECT supplier_facility_data_id, year, scope12_tco2e, output_qty, output_unit, allocation_key
         FROM supplier_facility_data WHERE supplier_id = $1 AND company_id = $2
        ORDER BY year DESC, supplier_facility_data_id DESC`,
      [supplierId, companyId],
    ),
  ]);
  return {
    supplier_id: Number(supplier.supplier_id),
    name: supplier.name,
    country: supplier.country ?? null,
    factors: factors.map((f: any) => ({
      supplier_factor_id: Number(f.supplier_factor_id),
      item: f.item,
      unit: f.unit,
      kgco2e_per_unit: Number(f.kgco2e_per_unit),
      boundary: f.boundary,
      reference_year: Number(f.reference_year),
      gwp_set: f.gwp_set ?? null,
      has_evidence: !!f.has_evidence,
      source: f.source,
    })),
    facilities: facilities.map((f: any) => ({
      supplier_facility_data_id: Number(f.supplier_facility_data_id),
      year: Number(f.year),
      scope12_tco2e: Number(f.scope12_tco2e),
      output_qty: Number(f.output_qty),
      output_unit: f.output_unit,
      allocation_key: f.allocation_key === "economic" ? "economic" : "mass",
    })),
  };
};

export type FactorPick = { ok: true; factor: SupplierFactorInput } | { ok: false; reason: "none_for_year" | "not_found" | "ambiguous" | "future_year" };

/**
 * The supplier figure a row uses (spec §Build.4): its `reference_year` must be
 * the reporting year or earlier, and the newest such figure wins.
 *   - `supplierFactorId` given: that figure, if it is this supplier's and not from a later year.
 *   - else the figures whose item matches the activity name (case-folded);
 *   - else, when the supplier has given figures for one item only, that item.
 * Two or more items and no name match is ambiguous: the row must say which.
 */
export const pickSupplierFactor = (
  factors: SupplierFactorInput[],
  reportingYear: number,
  activityName: string | null | undefined,
  supplierFactorId?: number | null,
): FactorPick => {
  if (supplierFactorId) {
    const chosen = factors.find((f) => f.supplier_factor_id === supplierFactorId);
    if (!chosen) return { ok: false, reason: "not_found" };
    if (chosen.reference_year > reportingYear) return { ok: false, reason: "future_year" };
    return { ok: true, factor: chosen };
  }
  const usable = factors.filter((f) => f.reference_year <= reportingYear);
  if (!usable.length) return { ok: false, reason: factors.length ? "none_for_year" : "not_found" };
  const newest = (list: SupplierFactorInput[]) =>
    [...list].sort((a, b) => b.reference_year - a.reference_year || b.supplier_factor_id - a.supplier_factor_id)[0];
  const byName = usable.filter((f) => fold(f.item) === fold(activityName));
  if (byName.length) return { ok: true, factor: newest(byName) };
  const items = new Set(usable.map((f) => fold(f.item)));
  if (items.size === 1) return { ok: true, factor: newest(usable) };
  return { ok: false, reason: "ambiguous" };
};

/** The facility data a hybrid row allocates: the newest year up to the reporting year. */
export const pickFacility = (facilities: FacilityInput[], reportingYear: number): FacilityInput | null =>
  [...facilities].filter((f) => f.year <= reportingYear).sort((a, b) => b.year - a.year || b.supplier_facility_data_id - a.supplier_facility_data_id)[0] ?? null;

/** Most input lines one hybrid row may carry. */
export const MAX_HYBRID_LINES = 50;

export type LinesParse = { ok: true; lines: HybridLineInput[] } | { ok: false; field: string; message: string };

/** Reads `extra_data.inputs` into hybrid lines, refusing (and naming) the first bad one. */
export const parseHybridLines = (raw: unknown): LinesParse => {
  if (raw === undefined || raw === null) return { ok: true, lines: [] };
  if (!Array.isArray(raw)) return { ok: false, field: "extra_data.inputs", message: "inputs must be a list of lines." };
  if (raw.length > MAX_HYBRID_LINES) return { ok: false, field: "extra_data.inputs", message: `A hybrid entry can have at most ${MAX_HYBRID_LINES} input lines.` };
  const lines: HybridLineInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i] as Record<string, unknown> | null;
    const field = `extra_data.inputs[${i}]`;
    if (!l || typeof l !== "object") return { ok: false, field, message: `Input line ${i + 1} is not valid.` };
    const kind = String(l.kind ?? "material") as HybridLineKind;
    if (!HYBRID_LINE_KINDS.includes(kind)) return { ok: false, field: `${field}.kind`, message: `Input line ${i + 1}: kind must be one of ${HYBRID_LINE_KINDS.join(", ")}.` };
    const name = typeof l.name === "string" ? l.name.trim() : "";
    if (!name) return { ok: false, field: `${field}.name`, message: `Input line ${i + 1} needs the name of its emission factor.` };
    const quantity = Number(l.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, field: `${field}.quantity`, message: `Input line ${i + 1} needs a quantity greater than 0.` };
    const unit = typeof l.unit === "string" ? l.unit.trim() : "";
    if (!unit) return { ok: false, field: `${field}.unit`, message: `Input line ${i + 1} needs a unit.` };
    lines.push({ kind, name, quantity, unit });
  }
  return { ok: true, lines };
};
