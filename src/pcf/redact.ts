// Licensed (ecoinvent) factor values are shown to superadmins only (E1 spec,
// C04). A result line priced with such a factor would give the factor back
// (line value ÷ quantity), so for everyone else those lines carry no value,
// and a stage whose total rests on exactly one such line hides its total too.
// The product total is the footprint itself and always shows.
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
  const perStage = new Map<string, number>();
  for (const l of lines) if (hidden.has(l.id)) perStage.set(l.stage, (perStage.get(l.stage) ?? 0) + 1);
  const hiddenStages = [...perStage].filter(([, n]) => n === 1).map(([s]) => s);
  const out: Record<string, number | null> = { ...byStage };
  for (const s of hiddenStages) out[s] = null;
  return { by_stage: out, hidden_stages: hiddenStages };
}

export function redactLines<T extends { id: string; kgco2e_per_unit: number }>(lines: T[], hidden: Set<string>) {
  return lines.map((l) => (hidden.has(l.id) ? { ...l, kgco2e_per_unit: null, value_hidden: true } : { ...l, value_hidden: false }));
}
