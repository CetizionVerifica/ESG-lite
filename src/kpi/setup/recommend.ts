/**
 * KPI-3 · the recommendation rule (pure; unit tested in ci/unit/kpi-setup.test.cjs).
 *
 * A KPI is recommended when it maps to a disclosure of a framework version the
 * company enabled and either:
 *   - the disclosure's requirement is `required` or `core` (and, for an ESRS
 *     disclosure with a topic, that topic isn't marked not material); or
 *   - the requirement is `if_material` and its `esrs_topic` is marked material.
 * Calculated KPIs pull in their inputs, transitively: GHG_INTENSITY_REVENUE
 * adds GHG_SCOPE1, GHG_SCOPE2_LB and REVENUE. Retired KPIs never appear.
 */
export interface RecDisclosure {
  id: number;
  framework_id: number;
  code: string;
  requirement: string;
  esrs_topic: string | null;
}
export interface RecFramework {
  id: number;
  code: string;
  version: string;
}
export interface RecDefinition {
  id: number;
  code: string;
  source: string;
  formula: string | null;
  active: boolean;
}
export interface RecInput {
  /** Framework versions the company enabled. */
  frameworks: RecFramework[];
  disclosures: RecDisclosure[];
  mappings: Array<{ disclosure_id: number; kpi_definition_id: number }>;
  definitions: RecDefinition[];
  /** ESRS topic → material (true) or not (false); undecided topics are absent. */
  material: Map<string, boolean>;
  /** The KPI codes a formula names. */
  refsOf: (formula: string) => string[];
}
export interface RecReason {
  framework: string;
  version: string;
  disclosure: string;
  requirement: string;
}
export interface Recommendation {
  kpi_definition_id: number;
  code: string;
  /** The disclosures that ask for it. Empty when it's only an input of a calculated KPI. */
  reasons: RecReason[];
  /** Calculated KPIs that need it as an input. */
  pulled_in_by: string[];
}

/** Whether a disclosure asks for its KPIs, given the company's material topics. */
export const disclosureApplies = (d: Pick<RecDisclosure, "requirement" | "esrs_topic">, material: Map<string, boolean>): boolean => {
  if (d.requirement === "required" || d.requirement === "core") return !d.esrs_topic || material.get(d.esrs_topic) !== false;
  if (d.requirement === "if_material") return !!d.esrs_topic && material.get(d.esrs_topic) === true;
  return false;
};

export function recommend(input: RecInput): Recommendation[] {
  const fw = new Map(input.frameworks.map((f) => [f.id, f]));
  const disclosures = new Map(input.disclosures.filter((d) => fw.has(d.framework_id)).map((d) => [d.id, d]));
  const defs = new Map(input.definitions.filter((d) => d.active).map((d) => [d.id, d]));
  const byCode = new Map([...defs.values()].map((d) => [d.code, d]));
  const out = new Map<number, Recommendation>();
  const entry = (d: RecDefinition) => {
    if (!out.has(d.id)) out.set(d.id, { kpi_definition_id: d.id, code: d.code, reasons: [], pulled_in_by: [] });
    return out.get(d.id)!;
  };

  for (const mp of input.mappings) {
    const d = disclosures.get(mp.disclosure_id);
    const def = defs.get(mp.kpi_definition_id);
    if (!d || !def || !disclosureApplies(d, input.material)) continue;
    const f = fw.get(d.framework_id)!;
    entry(def).reasons.push({ framework: f.code, version: f.version, disclosure: d.code, requirement: d.requirement });
  }

  // Calculated KPIs pull in their inputs (and their inputs' inputs).
  const queue = [...out.values()].map((r) => defs.get(r.kpi_definition_id)!);
  while (queue.length) {
    const def = queue.shift()!;
    if (def.source !== "formula" || !def.formula) continue;
    for (const code of input.refsOf(def.formula)) {
      const dep = byCode.get(code);
      if (!dep) continue;
      const known = out.has(dep.id);
      const rec = entry(dep);
      if (!rec.pulled_in_by.includes(def.code)) rec.pulled_in_by.push(def.code);
      if (!known) queue.push(dep);
    }
  }
  for (const r of out.values()) {
    r.reasons.sort((a, b) => a.framework.localeCompare(b.framework) || a.disclosure.localeCompare(b.disclosure));
    r.pulled_in_by.sort();
  }
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
}
