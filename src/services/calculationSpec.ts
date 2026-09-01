import { Repository } from "typeorm";
import { ColumnConfig, CalculationSpec } from "../entities/ColumnConfig";

// Multi-field calculation specs (ColumnConfig.calculation).
//
// Most categories compute: one activity value × factor. Some categories
// (first user: Use of Sold Products, GHG Protocol Scope 3 Category 11)
// multiply SEVERAL form fields together before the factor is applied —
// e.g. units sold × energy per use × lifetime uses. Which fields multiply
// depends on a "method" dropdown on the form (energy-consuming product,
// fuel sold, gas-containing product), so the spec maps each method option
// id to its list of factor columns.
//
// The one-value heuristic in emission.controller.ts must NOT run for these
// configs: with several numeric columns present it would silently pick one
// of them (whichever survives its skip-list and magnitude rules) and store
// a plausible-looking wrong total. When a spec exists, the spec is the only
// authority — missing fields are a 400, never a fallback.

export interface SpecComputationOk {
  ok: true;
  value: number;
}

export interface SpecComputationError {
  ok: false;
  message: string;
}

export type SpecComputation = SpecComputationOk | SpecComputationError;

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
  if (!spec || spec.mode !== "per_method" || !spec.method_column || !spec.methods) {
    return null;
  }
  return spec;
}

function parsePositiveNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const num = parseFloat(String(raw));
  if (isNaN(num) || num <= 0) return null;
  return num;
}

// Multiply the method's fields together. Every listed field must hold a
// number greater than zero — a missing lifetime or a zero units-sold makes
// the whole row meaningless, so it errors in plain language instead of
// silently computing with fewer fields. Fields listed under `percent`
// are entered as percentages (e.g. 80 for 80%) and divided by 100.
export function computeSpecActivityValue(
  spec: CalculationSpec,
  activity_data: Record<string, unknown>,
): SpecComputation {
  const methodValue = activity_data[spec.method_column];
  if (methodValue === undefined || methodValue === null || methodValue === "") {
    return { ok: false, message: `Please choose a value for "${spec.method_column}".` };
  }

  const method = spec.methods[String(methodValue)];
  if (!method || !Array.isArray(method.multiply) || method.multiply.length === 0) {
    return {
      ok: false,
      message: `"${spec.method_column}" has an option ("${methodValue}") this category is not configured to calculate. Ask a Superadmin to check the category's calculation settings.`,
    };
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

  return { ok: true, value: product };
}

// Duplicate identity for spec configs. The default duplicate check treats
// site+category+date+emission_category as "the same entry", but for Use of
// Sold Products the emission_category is the country/fuel/gas — two
// different PRODUCTS sold in the same country in the same period are NOT
// duplicates. identity_columns (e.g. ["Product Name"]) narrows the match.
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
