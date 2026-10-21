/**
 * IN-6 · the data-to-disclosure flow graph (pure, I9): turns figures the
 * sources already read into Sankey nodes and links. Nothing here reads data.
 *
 *   flowGraph(input)
 *     column 0 → 1  site → Scope n, tCO₂e = the site's approved Scope n (Overview), links > 0 only
 *     column 1 → 2  Scope n → GHG KPI, tCO₂e = the KPI's approved figure for the year (a KPI
 *                   with no figure, or a company-level one while only some sites are read,
 *                   gets no tonnes link but stays a node when it feeds a disclosure)
 *                   or, with KPI tracking off, Scope n → category, tCO₂e = the category total
 *     column 2 → 3  KPI → disclosure, measure 'count', value 1 per mapping row, with its fit
 *   Nodes appear once, in column order; a node nothing links to is left out, except
 *   sites and scopes (always shown, the left half reads even when it is empty).
 */
import type { Flow } from "../contracts/panels";

export type FlowNode = Flow["nodes"][number];
export type FlowLink = Flow["links"][number];

export interface FlowInput {
  sites: Array<{ site_id: number; name: string; scope_1: number; scope_2: number; scope_3: number }>;
  /** Column 2 KPIs (KPI on): `scope` set for GHG KPIs (tonnes from that scope), null for count-only KPIs. */
  kpis?: Array<{ code: string; name: string; scope: 1 | 2 | 3 | null; value: number | null }>;
  /** KPI → disclosure mapping rows of the enabled frameworks. */
  mappings?: Array<{ kpi: string; framework: string; code: string; title: string; fit: "exact" | "partial" | "derived" }>;
  /** Column 2 categories (KPI off): the top ones by tCO₂e. */
  categories?: Array<{ category_id: number; name: string; scope: 1 | 2 | 3; total: number }>;
}

export const SCOPE_LABELS: Record<1 | 2 | 3, string> = { 1: "Scope 1", 2: "Scope 2", 3: "Scope 3" };

export function flowGraph(input: FlowInput): Flow {
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const seen = new Set<string>();
  const node = (n: FlowNode) => {
    if (!seen.has(n.id)) {
      seen.add(n.id);
      nodes.push(n);
    }
  };
  for (const s of input.sites) node({ id: `site:${s.site_id}`, label: s.name, column: 0, kind: "site" });
  for (const n of [1, 2, 3] as const) node({ id: `scope:${n}`, label: SCOPE_LABELS[n], column: 1, kind: "scope" });
  for (const s of input.sites) {
    for (const n of [1, 2, 3] as const) {
      const v = s[`scope_${n}` as const];
      if (v > 0) links.push({ source: `site:${s.site_id}`, target: `scope:${n}`, value: v, measure: "tCO2e" });
    }
  }
  const mapped = new Set((input.mappings ?? []).map((m) => m.kpi));
  for (const k of input.kpis ?? []) {
    const tonnes = k.scope !== null && k.value !== null && k.value > 0;
    if (!tonnes && !mapped.has(k.code)) continue;
    node({ id: `kpi:${k.code}`, label: k.name, column: 2, kind: "kpi" });
    if (tonnes) links.push({ source: `scope:${k.scope}`, target: `kpi:${k.code}`, value: k.value as number, measure: "tCO2e" });
  }
  for (const m of input.mappings ?? []) {
    if (!seen.has(`kpi:${m.kpi}`)) continue;
    const id = `disc:${m.framework}:${m.code}`;
    node({ id, label: m.title, column: 3, kind: "disclosure" });
    links.push({ source: `kpi:${m.kpi}`, target: id, value: 1, measure: "count", fit: m.fit });
  }
  for (const c of input.categories ?? []) {
    if (!(c.total > 0)) continue;
    node({ id: `cat:${c.category_id}`, label: c.name, column: 2, kind: "category" });
    links.push({ source: `scope:${c.scope}`, target: `cat:${c.category_id}`, value: c.total, measure: "tCO2e" });
  }
  return { nodes, links };
}

/** Σ of link values out of / into a node, per measure (tests and the conservation golden). */
export const flowTotal = (f: Flow, id: string, side: "in" | "out", measure: "tCO2e" | "count" = "tCO2e"): number =>
  f.links.filter((l) => l.measure === measure && (side === "in" ? l.target === id : l.source === id)).reduce((a, l) => a + l.value, 0);
