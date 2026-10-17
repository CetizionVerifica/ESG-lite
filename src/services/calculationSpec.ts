import { Repository } from "typeorm";
import { ColumnConfig, CalculationSpec, MethodCalculation } from "../entities/ColumnConfig";

// Multi-field calculation specs (ColumnConfig.calculation).
//
// Most categories compute: one activity value × factor. Some categories
// multiply SEVERAL form fields together before the factor is applied:
//   - per_method: a dropdown picks the fields (Use of Sold Products —
//     units sold × energy per use × lifetime uses, etc.), or, with
//     `method_column: "@method"`, the row's calculation method does (S3-9:
//     commuting distance_based / average_data / fuel_based)
//   - per_unit:   the row's unit picks the fields (Transport — tonne.km is
//     Weight × Distance, km is Distance alone)
// A method may also divide by fields (`divide`, S3-9; first used by S3-11).
//
// The one-value heuristic in emission.controller.ts must NOT run for these
// configs: with several numeric columns present it would silently pick one
// of them and store a plausible-looking wrong total. When a spec exists, the
// spec is the only authority — missing fields are a 400, never a fallback.

export interface SpecComputationOk {
  ok: true;
  value: number;
  legacy?: boolean; // per_unit: value came from the legacy field of a pre-spec row
  // per_unit: the canonical unit key that matched (e.g. "tonne.km" for
  // "Tonne KM"). Callers store/match with this so spelling variants never
  // fail the factor-unit comparison further down.
  unitKey?: string;
}

export interface SpecComputationError {
  ok: false;
  message: string;
}

export type SpecComputation = SpecComputationOk | SpecComputationError;

// "tonne.km", "Tonne KM", "tonne-km", "tonne_km", "tkm" → "tonne.km"
// S3-8: "m³.day", "m3 day" → "m3.day"; "pallet day", "teu day"; "kWh" → "kwh"; "litres" → "litre".
// Mirrored in ESG-lite_FE src/lib/emissions/emissionCalc.ts.
export function normalizeUnitKey(unit: unknown): string {
  let u = String(unit ?? "").trim().toLowerCase().replace(/[\s_\-]+/g, ".").replace(/³/g, "3");
  if (u === "tkm" || u === "t.km" || u === "tonnes.km" || u === "tonne.kms") u = "tonne.km";
  if (u === "kms") u = "km";
  if (u === "litres" || u === "liters" || u === "liter") u = "litre";
  if (u === "pallets.day") u = "pallet.day";
  return u;
}

// configs[0] ordered by config_name — the same row the data-entry frontend
// uses (it fetches the list and takes the first), so both sides always read
// one and the same spec.
export async function getCalculationSpec(
  configRepo: Repository<ColumnConfig>,
  site_id: number,
  category_id: number,
): Promise<CalculationSpec | null> {
  const configs = await configRepo.find({
    where: { site: { site_id }, category: { category_id } },
    order: { config_name: "ASC" },
  });
  const spec = configs[0]?.calculation;
  if (!spec || !spec.methods) return null;
  if (spec.mode === "per_method" && spec.method_column) return spec;
  if (spec.mode === "per_unit") return spec;
  return null;
}

function parsePositiveNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).replace(/,/g, "").trim();
  if (text === "") return null;
  const num = Number(text);
  if (!isFinite(num) || num <= 0) return null;
  return num;
}

/**
 * `method_column` value meaning "the row's calculation method picks the field
 * set" (S3-9, 01-contracts.md §6) instead of a select column. The method is
 * the row's `method` (S3-3) when the caller passes one; until S3-3 gives rows
 * that field, it travels in `activity_data["@method"]`, which the data-entry
 * form and the commuting survey plan write.
 */
export const ROW_METHOD_COLUMN = "@method";

// Select values reach us from three sources (form, bulk import, manager edit)
// and only the Python engine trimmed them. Without this a row imported with a
// trailing space in its method cell computes fine, then 400s on every later
// edit as an option "this category is not configured to calculate".
function normalizeMethodKey(raw: unknown): string {
  return String(raw).trim();
}

// Which method applies to this row: the dropdown's value (per_method), the
// row's own method (per_method with "@method") or the row's normalized unit
// (per_unit). Returns the method or an error message.
export function resolveSpecMethod(
  spec: CalculationSpec,
  activity_data: Record<string, unknown>,
  activity_data_unit?: unknown,
  rowMethod?: string | null,
): { method: MethodCalculation; key: string } | { error: string } {
  if (spec.mode === "per_unit") {
    const key = normalizeUnitKey(activity_data_unit);
    if (!key) return { error: "Please select a unit." };
    const method = spec.methods[key];
    if (!method || !Array.isArray(method.multiply) || method.multiply.length === 0) {
      const known = Object.keys(spec.methods).join(", ");
      return { error: `The unit "${activity_data_unit}" is not configured for this category (expected one of: ${known}).` };
    }
    return { method, key };
  }
  const methodColumn = spec.method_column ?? "";
  const byRow = methodColumn === ROW_METHOD_COLUMN;
  let methodValue = byRow && rowMethod ? rowMethod : activity_data[methodColumn];
  // SE-5: a form whose question replaced "@method" (migrate:entry-forms-data) still calculates the
  // rows saved before it, which have no answer: their method decides, as it did, when the spec has it.
  if (!byRow && (methodValue === undefined || methodValue === null || String(methodValue).trim() === "")) {
    const before = rowMethod ?? activity_data[ROW_METHOD_COLUMN];
    if (before !== undefined && before !== null && spec.methods[normalizeMethodKey(before)]) methodValue = before;
  }
  const methodKey =
    methodValue === undefined || methodValue === null ? "" : normalizeMethodKey(methodValue);
  if (methodKey === "") {
    return { error: byRow ? "Please choose a calculation method." : `Please choose a value for "${methodColumn}".` };
  }
  const method = spec.methods[methodKey];
  if (!method || !Array.isArray(method.multiply) || method.multiply.length === 0) {
    if (byRow) {
      const known = Object.keys(spec.methods).join(", ");
      return { error: `The method "${methodKey}" is not configured for this category (expected one of: ${known}).` };
    }
    return {
      error: `"${methodColumn}" has an option ("${methodKey}") this category is not configured to calculate. Ask a Superadmin to check the category's calculation settings.`,
    };
  }
  return { method, key: methodKey };
}

// Multiply the method's fields together (then divide by its `divide` fields). Every listed field must hold a
// number greater than zero — a missing weight or a zero distance makes the
// whole row meaningless, so it errors in plain language instead of silently
// computing with fewer fields. Fields listed under `percent` are entered as
// percentages (e.g. 80 for 80%) and divided by 100.
export function computeSpecActivityValue(
  spec: CalculationSpec,
  activity_data: Record<string, unknown>,
  activity_data_unit?: unknown,
  rowMethod?: string | null,
): SpecComputation {
  const resolved = resolveSpecMethod(spec, activity_data, activity_data_unit, rowMethod);
  if ("error" in resolved) return { ok: false, message: resolved.error };
  const { method } = resolved;
  const unitKey = spec.mode === "per_unit" ? resolved.key : undefined;

  // Legacy rows (saved before the spec): the other multiply fields are ABSENT
  // (key missing entirely, not just empty) and the legacy field holds the
  // already-multiplied value. A new form row always sends every key, so an
  // empty weight on a new row is still an error below.
  if (spec.legacy_field && method.multiply.includes(spec.legacy_field)) {
    const others = method.multiply.filter((f) => f !== spec.legacy_field);
    const othersAbsent = others.length > 0 && others.every((f) => !(f in activity_data));
    if (othersAbsent) {
      const legacyValue = parsePositiveNumber(activity_data[spec.legacy_field]);
      if (legacyValue === null) {
        return { ok: false, message: `Please enter a number greater than 0 in "${spec.legacy_field}".` };
      }
      return { ok: true, value: legacyValue, legacy: true, unitKey };
    }
  }

  const percentFields = new Set(method.percent ?? []);
  let product = 1;
  for (const fieldName of method.multiply) {
    const value = parsePositiveNumber(activity_data[fieldName]);
    if (value === null) {
      return { ok: false, message: `Please enter a number greater than 0 in "${fieldName}".` };
    }
    if (percentFields.has(fieldName)) {
      if (value > 100) {
        return { ok: false, message: `"${fieldName}" is a percentage — it cannot be more than 100.` };
      }
      product *= value / 100;
    } else {
      product *= value;
    }
  }

  // `divide` (S3-9 owns it, 01-contracts.md §6): occupancy (travellers ÷
  // travellers per vehicle), survey scaling (÷ employees surveyed) and S3-11's
  // leased-space shares (÷ building area × occupancy). Same rule as multiply:
  // every field > 0 (0 or empty → FIELD_REQUIRED), percentages ≤ 100.
  for (const fieldName of method.divide ?? []) {
    const value = parsePositiveNumber(activity_data[fieldName]);
    if (value === null) {
      return { ok: false, message: `Please enter a number greater than 0 in "${fieldName}".` };
    }
    if (percentFields.has(fieldName)) {
      if (value > 100) {
        return { ok: false, message: `"${fieldName}" is a percentage — it cannot be more than 100.` };
      }
      product /= value / 100;
    } else {
      product /= value;
    }
  }

  return { ok: true, value: product, unitKey };
}

// Duplicate identity for spec configs. The default duplicate check treats
// site+category+date+emission_category as "the same entry", but for Use of
// Sold Products the emission_category is the country/fuel/gas — two
// different PRODUCTS sold in the same country in the same period are NOT
// duplicates. identity_columns (e.g. ["Product Name"] or ["Shipment Ref"])
// narrows the match.
export function specIdentityMatches(
  spec: CalculationSpec,
  newActivityData: Record<string, unknown>,
  existingActivityData: Record<string, unknown> | null | undefined,
): boolean {
  const identityColumns = spec.identity_columns ?? [];
  if (identityColumns.length === 0) return true;
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
  return identityColumns.every(
    (col) => norm(newActivityData[col]) === norm(existingActivityData?.[col]),
  );
}
