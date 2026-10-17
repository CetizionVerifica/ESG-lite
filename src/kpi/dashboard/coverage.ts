/**
 * KPI-10 · framework coverage for a year (pure).
 *
 * A disclosure counts when it's `required` or `core`, or `if_material` with
 * its ESRS topic material (an undecided topic isn't material, as in KPI-3).
 * `voluntary` disclosures are shown but never counted.
 *
 * The KPIs that answer a disclosure are those mapped with fit exact or
 * partial; a disclosure mapped only by derived fits is answered by those.
 * Each answering KPI is:
 *   - excluded      not selected, with the KPI-3 reason → it doesn't count;
 *   - not tracked   not selected and no reason → the disclosure is missing;
 *   - its state     approved | pending | missing | not_due (from the service).
 * The disclosure is excluded when every answering KPI is (listed with the
 * reasons, never missing), or when its ESRS topic isn't material. Otherwise:
 * missing if any KPI is missing or not tracked (or none is mapped), else pending
 * if any is pending, else approved if all are, else not_due (nothing due yet).
 *
 * percent = approved / counted (excluded disclosures aren't counted), rounded.
 * BRSR also reports Core: `core {done, total}` over its counted core disclosures.
 */
export type KpiState = "approved" | "pending" | "missing" | "not_due";
export type DisclosureState = KpiState | "excluded" | "voluntary";

export interface CoverageDisclosure {
  id: number;
  code: string;
  title: string;
  section: string;
  requirement: string;
  esrs_topic: string | null;
}

export interface CoverageInput {
  framework: { id: number; code: string; version: string };
  disclosures: CoverageDisclosure[];
  mappings: Array<{ disclosure_id: number; kpi_definition_id: number; fit: string }>;
  /** Every KPI the company can use, keyed by id. */
  kpis: Map<number, { selected: boolean; reason_excluded: string | null; state?: KpiState }>;
  /** ESRS topic → materiality decision. */
  material: Map<string, { material: boolean; reason: string | null }>;
}

export interface DisclosureCoverage {
  disclosure_id: number;
  code: string;
  title: string;
  section: string;
  requirement: string;
  state: DisclosureState;
  /** The KPIs that answer it (selected and not excluded). */
  kpis: number[];
  reason_kind?: "not_material" | "excluded" | "not_tracked";
  reason?: string | null;
}

export interface FrameworkCoverage {
  framework: string;
  framework_id: number;
  version: string;
  required: number;
  approved: number;
  pending: number;
  missing: number;
  not_due: number;
  excluded: number;
  percent: number;
  core: { done: number; total: number } | null;
  disclosures: DisclosureCoverage[];
  excluded_disclosures: Array<{ disclosure_id: number; code: string; title: string; reason_kind: string; reason: string | null }>;
}

/** The KPI ids answering a disclosure: exact/partial fits, else derived ones. */
export const answeringKpis = (disclosureId: number, mappings: CoverageInput["mappings"]): number[] => {
  const mine = mappings.filter((m) => m.disclosure_id === disclosureId);
  const strong = mine.filter((m) => m.fit === "exact" || m.fit === "partial");
  return [...new Set((strong.length ? strong : mine).map((m) => m.kpi_definition_id))];
};

export function disclosureState(d: CoverageDisclosure, input: Pick<CoverageInput, "mappings" | "kpis" | "material">): DisclosureCoverage {
  const out: DisclosureCoverage = { disclosure_id: d.id, code: d.code, title: d.title, section: d.section, requirement: d.requirement, state: "missing", kpis: [] };
  if (d.requirement === "voluntary") return { ...out, state: "voluntary", kpis: answeringKpis(d.id, input.mappings).filter((k) => input.kpis.get(k)?.selected) };
  if (d.requirement === "if_material" && d.esrs_topic) {
    const m = input.material.get(d.esrs_topic);
    if (!m?.material) return { ...out, state: "excluded", reason_kind: "not_material", reason: m ? m.reason : null };
  }
  const answering = answeringKpis(d.id, input.mappings);
  if (!answering.length) return { ...out, reason_kind: "not_tracked", reason: null };
  const excludedReasons: string[] = [];
  const states: Array<KpiState | "not_tracked"> = [];
  const counted: number[] = [];
  for (const id of answering) {
    const k = input.kpis.get(id);
    if (!k || !k.selected) {
      if (k?.reason_excluded) excludedReasons.push(k.reason_excluded);
      else states.push("not_tracked");
      continue;
    }
    counted.push(id);
    states.push(k.state ?? "missing");
  }
  if (!states.length) return { ...out, state: "excluded", reason_kind: "excluded", reason: [...new Set(excludedReasons)].join("; ") || null };
  out.kpis = counted;
  if (states.includes("not_tracked") && !counted.length) return { ...out, state: "missing", reason_kind: "not_tracked", reason: null };
  if (states.some((s) => s === "missing" || s === "not_tracked")) return { ...out, state: "missing", ...(states.includes("not_tracked") ? { reason_kind: "not_tracked" as const, reason: null } : {}) };
  if (states.includes("pending")) return { ...out, state: "pending" };
  if (states.every((s) => s === "approved")) return { ...out, state: "approved" };
  return { ...out, state: "not_due" };
}

export function coverage(input: CoverageInput): FrameworkCoverage {
  const disclosures = input.disclosures.map((d) => disclosureState(d, input));
  const counted = disclosures.filter((d) => d.state !== "excluded" && d.state !== "voluntary");
  const count = (s: DisclosureState) => counted.filter((d) => d.state === s).length;
  const approved = count("approved");
  const coreRows = input.framework.code === "BRSR" ? counted.filter((d) => d.requirement === "core") : [];
  const excluded = disclosures.filter((d) => d.state === "excluded");
  return {
    framework: input.framework.code,
    framework_id: input.framework.id,
    version: input.framework.version,
    required: counted.length,
    approved,
    pending: count("pending"),
    missing: count("missing"),
    not_due: count("not_due"),
    excluded: excluded.length,
    percent: counted.length ? Math.round((approved / counted.length) * 100) : 0,
    core: input.framework.code === "BRSR" ? { done: coreRows.filter((d) => d.state === "approved").length, total: coreRows.length } : null,
    disclosures,
    excluded_disclosures: excluded.map((d) => ({ disclosure_id: d.disclosure_id, code: d.code, title: d.title, reason_kind: d.reason_kind as string, reason: d.reason ?? null })),
  };
}
