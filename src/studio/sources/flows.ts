/**
 * The rows of the GHG flow tables, which the renderer reads from
 * `RenderData.flow` / `RenderData.scope3` by section id (DS-1 flow/index.ts):
 *
 *   ghg_factor_table    the emission factors on the approved rows of the doc's
 *                       year and sites (ghg/rows.ts `factorsUsed`: each row's
 *                       factor snapshot), grouped by scope
 *   scope3_categories   the 15 GHG Protocol categories from `computeScope3`
 *                       (the report's own Scope 3 rows): reported with the
 *                       category's tCO₂e, excluded with the report inputs'
 *                       reason, or not addressed
 *
 * Approved data only, through the same GhgLoader as the bindings, so a
 * table's figures equal the doc's charts and chips. Nothing is recomputed:
 * tCO₂e are computeScope3's, factors are as stored on the rows.
 * `scope3_categories` statuses follow the DS-12 checks: a category is
 * excluded when the report inputs exclude it (inputs.ts `exclusionFor`), and
 * reported when it has approved tCO₂e.
 */
import type { FlowType, NumberFormat, ReportDoc, ReportInputs } from "../contracts";
import { methodMixText, STATUS_LABELS, type Scope3Report } from "../../reporting/ghg-scope3";
import type { FlowRow, FlowTable, Scope3CategoryRow } from "../../reporting/studio/render/types";
import { formatNumber } from "./format";
import type { GhgLoader } from "./ghg";
import type { FactorUsedRow } from "./ghg/rows";
import { exclusionFor } from "./inputs";
import type { ResolveContext } from "./types";

/** The flow types filled here. */
export const DATA_FLOW_TYPES = ["ghg_factor_table", "scope3_categories"] as const satisfies readonly FlowType[];
export type DataFlowType = (typeof DATA_FLOW_TYPES)[number];

export interface FlowRef {
  id: string;
  flowType: FlowType;
}

/** Flow rows by section id, as `renderData(…, {flow, scope3})` takes them. */
export interface FlowData {
  flow: Record<string, FlowTable>;
  scope3: Record<string, Scope3CategoryRow[]>;
}

const isDataFlow = (t: string): t is DataFlowType => (DATA_FLOW_TYPES as readonly string[]).includes(t);

/** The doc's flow sections that need rows (hidden ones too: they cost nothing and a toggle shows them at once). */
export const dataFlows = (doc: Pick<ReportDoc, "pages">): FlowRef[] =>
  doc.pages.flatMap((p) => (p.kind === "flow" && isDataFlow(p.flowType) ? [{ id: p.id, flowType: p.flowType }] : []));

/** A stored factor value as text, without trailing zeros (numeric(18,8) keeps up to 8 decimals). */
export const factorValueText = (v: string | null): string | null => {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 8 }) : v;
};

export const FACTOR_COLUMNS = ["Source category", "Emission factor", "kgCO₂e per unit", "Unit", "Source", "GWP", "Entries"];

/** The factor table: one group per scope, one line per source category × factor. */
export function factorTable(rows: FactorUsedRow[], missing: number, periodLabel: string): FlowTable {
  const out: FlowRow[] = [];
  let scope: string | null = null;
  for (const r of rows) {
    if (r.scope !== scope) {
      scope = r.scope;
      out.push({ cells: [r.scope], group: true });
    }
    out.push({
      cells: [
        r.category,
        r.factor ?? "Not recorded",
        factorValueText(r.value) ?? "Not recorded",
        r.unit ?? "Not recorded",
        r.source ? `${r.source}${r.version ? ` ${r.version}` : ""}` : "Not recorded",
        r.gwp ?? "Not recorded",
        r.rows,
      ],
    });
  }
  const note =
    `Emission factors as stored on each approved entry when it was calculated, ${periodLabel}. Every factor is in kgCO₂e per unit of activity.` +
    (missing ? ` ${missing} approved ${missing === 1 ? "entry has" : "entries have"} no factor record.` : "");
  return { columns: FACTOR_COLUMNS, rows: out, note };
}

const NOT_ADDRESSED_REASON: Record<string, string> = {
  screening: "Still being screened; no approved data.",
  included: "Included in the boundary, but no approved data for the period.",
  excluded: "Excluded on the Scope 3 boundary, but not in this report's details.",
  not_relevant: "Not relevant on the Scope 3 boundary, but not excluded in this report's details.",
};

/** The 15 category rows from the report's Scope 3 rows and the doc's report inputs. */
export function scope3Rows(r: Scope3Report, inputs: ReportInputs, format: NumberFormat = "auto"): Scope3CategoryRow[] {
  const out: Scope3CategoryRow[] = [];
  for (const row of r.rows) {
    if (row.n === null) continue; // Unmapped: not a GHG Protocol category (the Scope 3 total still holds it)
    const n = row.n;
    const excl = exclusionFor(inputs, n);
    if (row.tco2e > 0) {
      const dq = row.dq.overall !== null ? row.dq.overall.toFixed(1) : r.tracked.dq ? "Not scored" : "Not recorded";
      out.push({
        n,
        name: row.name,
        status: "reported",
        display: formatNumber(row.tco2e, format, "tCO₂e"), // #209
        method: r.tracked.method ? methodMixText(row) : "Not recorded",
        dq,
        reason: excl ? `Excluded in the report details, but approved data is reported.` : (row.method_note ?? ""),
      });
    } else if (excl) {
      out.push({ n, name: row.name, status: "excluded", reason: excl.reason.trim() || "No reason given." });
    } else {
      const status = row.status ?? "screening";
      out.push({ n, name: row.name, status: "not_addressed", reason: NOT_ADDRESSED_REASON[status] ?? `${STATUS_LABELS[status] ?? status}; no approved data.` });
    }
  }
  return out.sort((a, b) => a.n - b.n);
}

/** Rows for each flow section in `flows`, from approved data in the resolve context (doc year, CY/FY, sites, inputs). */
export async function resolveFlows(L: GhgLoader, ctx: ResolveContext, flows: FlowRef[]): Promise<FlowData> {
  const out: FlowData = { flow: {}, scope3: {} };
  const wanted = flows.filter((f) => isDataFlow(f.flowType));
  if (!wanted.length || !ctx.siteIds.length) return out;
  const sites = ctx.siteIds;
  for (const f of wanted) {
    if (f.flowType === "ghg_factor_table") {
      const [{ rows, missing }, t] = await Promise.all([L.factors(ctx.year, sites), L.tables(ctx.year, sites)]);
      out.flow[f.id] = factorTable(rows, missing, t.filters.periodLabel);
    } else {
      out.scope3[f.id] = scope3Rows(await L.scope3(ctx.year, sites), ctx.inputs);
    }
  }
  return out;
}
