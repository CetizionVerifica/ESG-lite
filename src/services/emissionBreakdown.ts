// Consumption and emissions per emission category (fuel type, waste stream …)
// for one category: the My entries "Breakdown" panel. Same rules as the old My
// emissions sidebar, which paged every row into the browser to compute this.

export interface BreakdownSourceRow {
  activity_data: Record<string, unknown> | null;
  activity_data_unit: string | null;
  total_emission: number | string | null;
}

export interface BreakdownGroup {
  emission_category: string;
  entries: number;
  /** tCO₂e, rounded to 2 decimals. */
  total_emission: number;
  /** Sum of each entry's activity value. */
  consumption: number;
  /** The entries' unit; "mixed" when they differ; null when none has one. */
  unit: string | null;
}

export const BLANK_GROUP = "(not set)";
export const MIXED_UNIT = "mixed";

// One field, not the sum of the numbers: same priority as the reporting layer
// and the create/update controllers.
const CONSUMPTION_KEYS = ["activity data", "activity_value", "value", "quantity", "amount", "consumption"];

function valueCI(data: Record<string, unknown>, key: string): unknown {
  if (data[key] !== undefined) return data[key];
  const lower = key.toLowerCase();
  const hit = Object.keys(data).find((k) => k.toLowerCase() === lower);
  return hit === undefined ? undefined : data[hit];
}

const toNumber = (raw: unknown): number | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** The entry's activity value: a canonical key first, then the category's number columns. */
export function consumptionOf(data: Record<string, unknown>, numberColumns: string[]): number {
  for (const key of [...CONSUMPTION_KEYS, ...numberColumns]) {
    const n = toNumber(valueCI(data, key));
    if (n !== null) return n;
  }
  return 0;
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** Groups by emission_category (case-insensitively, first spelling kept), largest emissions first. */
export function computeBreakdown(rows: BreakdownSourceRow[], numberColumns: string[]): BreakdownGroup[] {
  const groups = new Map<string, { label: string; entries: number; emission: number; consumption: number; units: Set<string> }>();
  for (const row of rows) {
    const data = row.activity_data ?? {};
    const raw = valueCI(data, "emission_category");
    const label = raw === undefined || raw === null || String(raw).trim() === "" ? BLANK_GROUP : String(raw).trim();
    const key = label.toLowerCase();
    const g = groups.get(key) ?? { label, entries: 0, emission: 0, consumption: 0, units: new Set<string>() };
    g.entries += 1;
    g.emission += Number(row.total_emission) || 0;
    g.consumption += consumptionOf(data, numberColumns);
    if (row.activity_data_unit) g.units.add(row.activity_data_unit);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({
      emission_category: g.label,
      entries: g.entries,
      total_emission: round(g.emission, 2),
      consumption: round(g.consumption, 4),
      unit: g.units.size === 1 ? [...g.units][0] : g.units.size > 1 ? MIXED_UNIT : null,
    }))
    .sort((a, b) => b.total_emission - a.total_emission || a.emission_category.localeCompare(b.emission_category));
}
