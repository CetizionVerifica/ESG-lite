// Licensed (ecoinvent) factor values are shown to superadmins only (E1 spec,
// C04). A result line priced with such a factor would give the factor back
// (line value ÷ quantity), and so would any figure that sums or weights such
// lines next to visible ones: with two licensed lines a manager could solve
// for both from a stage total plus the cut-off share, primary-data share or
// DQR. So for everyone else, once a study uses a licensed factor, those lines
// carry no value, every stage holding one hides its total, and the cut-off
// list and share, primary-data share, DQR and the fossil/biogenic split are
// withheld. The product total is the footprint itself and always shows.
import type { PcfEngineInput, PcfLine } from "./engine/computePcf";

// Line ids whose factor or recycled factor is licensed.
export function licensedLineIds(input: PcfEngineInput | undefined | null): Set<string> {
  const licensed = new Set((input?.factors ?? []).filter((f) => f.licence === "ecoinvent").map((f) => f.id));
  return new Set(
    (input?.inputs ?? [])
      .filter((i) => (i.factor_id && licensed.has(i.factor_id)) || (i.recycled_factor_id && licensed.has(i.recycled_factor_id)))
      .map((i) => i.id),
  );
}

export function redactStages(
  byStage: Record<string, number>,
  lines: Pick<PcfLine, "id" | "stage">[],
  hidden: Set<string>,
): { by_stage: Record<string, number | null>; hidden_stages: string[] } {
  const hiddenStages = [...new Set(lines.filter((l) => hidden.has(l.id)).map((l) => l.stage))];
  const out: Record<string, number | null> = { ...byStage };
  for (const s of hiddenStages) out[s] = null;
  return { by_stage: out, hidden_stages: hiddenStages };
}

export function redactLines<T extends { id: string; kgco2e_per_unit: number; cut_off_candidate?: boolean }>(lines: T[], hidden: Set<string>) {
  return lines.map((l) =>
    hidden.has(l.id) ? { ...l, kgco2e_per_unit: null, cut_off_candidate: null, value_hidden: true } : { ...l, value_hidden: false },
  );
}

// Aggregates other than the product total and the visible stages; null when
// any line is hidden.
export function redactAggregates<T extends Record<string, unknown>>(fields: T, hidden: Set<string>): { [K in keyof T]: T[K] | null } {
  if (!hidden.size) return fields;
  return Object.fromEntries(Object.keys(fields).map((k) => [k, null])) as { [K in keyof T]: null };
}
