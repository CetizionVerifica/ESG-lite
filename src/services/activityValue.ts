import { Repository } from "typeorm";
import { ColumnConfig } from "../entities/ColumnConfig";

// Dropdown columns hold option ids, not quantities. These names are skipped
// even without a config (older categories).
const KNOWN_SELECTS = ["material", "disposal_method", "fuel_type", "vehicle_type", "source_type", "waste_type", "transport_mode"];

// Common names for the quantity, tried first (case-insensitive).
const COMMON_FIELDS = ["activity_value", "quantity", "value", "amount", "consumption", "activity data", "activity_data"];

/** "Waste Type", "waste-type" and "waste_type" are the same column. */
const columnKey = (name: string) => name.toLowerCase().trim().replace(/[\s-]+/g, "_");

/** Names (normalised) of the site+category's select columns. */
export async function getSelectColumns(
  configRepo: Repository<ColumnConfig>,
  site_id: number,
  category_id: number,
): Promise<Set<string>> {
  const configs = await configRepo.find({
    where: { site: { site_id }, category: { category_id } },
    relations: ["columns"],
  });
  const names = new Set<string>();
  for (const config of configs) {
    for (const col of config.columns ?? []) {
      if (col.column_type === "select") names.add(columnKey(col.column_name));
    }
  }
  return names;
}

/**
 * The quantity in an entry's activity_data, for categories without a
 * calculation spec: a common quantity name first, then any number ≥ 100, then
 * any positive number. Select columns are skipped by name, including the
 * site's own configured selects: "Waste Type": "6" is an option id, and
 * picking it made a manager edit of 9.17 t of sludge compute 6 t.
 */
export function pickActivityValue(activity_data: Record<string, unknown>, selectColumns: Set<string> = new Set()): number {
  let common = 0;
  for (const field of COMMON_FIELDS) {
    const matchingKey = Object.keys(activity_data).find((k) => k.toLowerCase() === field.toLowerCase());
    if (matchingKey && activity_data[matchingKey] !== undefined && activity_data[matchingKey] !== "") {
      common = parseFloat(activity_data[matchingKey] as string);
      if (!isNaN(common) && common > 0) return common;
    }
  }
  // A quantity field that isn't a positive number means no total (as before),
  // rather than another field's value; only an exact 0 falls through.
  if (common !== 0) return 0;

  const skip = (key: string) => key === "emission_category" || KNOWN_SELECTS.includes(key.toLowerCase()) || selectColumns.has(columnKey(key));
  const firstNumber = (min: number) => {
    for (const [key, value] of Object.entries(activity_data)) {
      if (skip(key) || value === undefined || value === "") continue;
      const num = parseFloat(value as string);
      if (!isNaN(num) && num >= min && num > 0) return num;
    }
    return 0;
  };
  // Small integers are often dropdown ids, so prefer real-looking quantities first.
  return firstNumber(100) || firstNumber(0);
}
