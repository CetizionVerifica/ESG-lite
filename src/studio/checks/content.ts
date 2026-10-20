/**
 * DS-12 (RS-9 §2) · content checks, for both report kinds:
 *
 *   EMPTY_PLACEHOLDER        a layout placeholder still on a printed page (error)
 *   MISSING_ALT              an image, frame or grid cell with a picture and no alt text (warning)
 *   AI_UNREVIEWED            text from AI not yet edited or ticked reviewed (warning)
 *   LEADERSHIP_UNCONFIRMED   the leadership message not ticked as confirmed (sustainability, error)
 *   VALUES_MISSING           a bound figure with no approved value (warning; inputs that have
 *                            their own GHG check are left to it)
 *   YEAR_NOT_LOCKED          the year's KPI values aren't locked (sustainability, error, final)
 *   UNLINKED_DATA            a typed ("custom") chart or table, listed for review (info)
 *
 * DATA_CHANGED (RS-10 drift) belongs to DS-13 and isn't raised here.
 */
import type { Check, Element, ReportInputKey } from "../contracts";
import type { ResolvedBinding, UnavailableReason } from "../sources/types";
import { check, type CheckInput } from "./types";
import { visibleElements } from "./walk";

/** Inputs whose absence a GHG check names in its own words (ghg.ts). */
const INPUTS_WITH_OWN_CHECK: ReportInputKey[] = [
  "consolidation_approach",
  "reporting_period",
  "responsible_person",
  "base_year",
  "recalculation_policy",
  "significance_threshold_pct",
  "uncertainty_statement",
  "verification",
  "exclusions",
];

/** Unavailable reasons that are a check of their own, or not missing data at all. */
const NOT_MISSING: UnavailableReason[] = ["NOT_RECORDED", "EXCLUDED"];

const REASON_TEXT: Partial<Record<UnavailableReason, string>> = {
  NO_DATA: "there's no approved data for the period",
  NOT_TRACKED: "no approved entry records it",
  NO_INPUT: "a report detail it needs is empty",
  NO_BASE_YEAR: "no base year is set",
  NO_TARGET: "the KPI has no target",
  KPI_TRACKING_OFF: "KPI tracking is off for your company",
  DIVIDE_BY_ZERO: "the denominator is zero",
};

const elementLabel = (e: Element): string => {
  const p = e.props as Record<string, unknown>;
  const t = (typeof p.title === "string" && p.title) || (typeof p.label === "string" && p.label) || "";
  return t ? `"${t}"` : e.type === "chart" ? "A chart" : e.type === "table" ? "A table" : "A figure";
};

export function contentChecks(input: CheckInput): Check[] {
  const { doc, ix, resolved } = input;
  const out: Check[] = [];

  for (const { pageId, element: e } of visibleElements(doc)) {
    const at = { pageId, elementId: e.id };
    if (e.type === "placeholder") {
      out.push(check(doc, "EMPTY_PLACEHOLDER", `An empty placeholder is still on this page${e.props.hint ? ` ("${e.props.hint}")` : ""}. Fill it or delete it.`, at));
    }
    if ((e.type === "image" || e.type === "frame") && e.props.assetId && !e.props.alt.trim()) {
      out.push(check(doc, "MISSING_ALT", "This picture has no alt text. Describe it for people using screen readers.", at));
    }
    if (e.type === "grid") {
      const n = e.props.cells.filter((c) => c.assetId && !c.alt.trim()).length;
      if (n) out.push(check(doc, "MISSING_ALT", `${n} ${n === 1 ? "picture" : "pictures"} in this grid ${n === 1 ? "has" : "have"} no alt text.`, { ...at, details: { cells: n } }));
    }
    if (e.source === "ai" && !e.reviewed) {
      out.push(check(doc, "AI_UNREVIEWED", "Suggested by AI and not reviewed yet. Edit it or tick it as reviewed.", at));
    }
    if (doc.kind === "sustainability" && (e.type === "text" || e.type === "callout") && /(^|\.)message$/.test(e.id) && /leadership/.test(pageLayout(doc, pageId)) && !e.reviewed) {
      out.push(check(doc, "LEADERSHIP_UNCONFIRMED", "The leadership message isn't confirmed by its signatory yet. Tick it as confirmed once they have approved it.", at));
    }
    const binding = (e.props as { binding?: { source?: string } }).binding;
    if (binding?.source === "custom") {
      out.push(check(doc, "UNLINKED_DATA", "Typed data, not linked to approved data. Check the figures before the final.", at));
    }
  }

  // Bound figures with no value.
  for (const b of ix.bindings) {
    if (b.hidden || b.binding.source === "custom") continue;
    if (b.binding.source === "input" && INPUTS_WITH_OWN_CHECK.includes(b.binding.key)) continue;
    const r: ResolvedBinding | undefined = resolved.values[b.idx];
    const reason = r?.unavailable?.reason;
    if (!reason || NOT_MISSING.includes(reason)) continue;
    const isKpi = b.binding.source === "kpi";
    out.push(
      check(doc, "VALUES_MISSING", `${elementLabel(b.element)} shows "Not reported": ${REASON_TEXT[reason] ?? "the value isn't available"}.`, {
        pageId: b.pageId,
        elementId: b.elementId,
        fix: reason === "NO_INPUT" || b.binding.source === "input" ? "open_inputs" : isKpi ? "open_values" : "open_link",
        details: { reason, ...(isKpi ? { link: "/data/approvals?view=kpi" } : reason === "NO_DATA" ? { link: "/data/approvals" } : {}) },
      }),
    );
  }
  for (const t of ix.tokens) {
    if (t.hidden) continue;
    const reason = resolved.tokens[t.idx]?.unavailable?.reason;
    if (!reason || NOT_MISSING.includes(reason)) continue;
    out.push(check(doc, "VALUES_MISSING", `A value in this text shows "Not reported": ${REASON_TEXT[reason] ?? "the value isn't available"}.`, { pageId: t.pageId, elementId: t.elementId, fix: t.token.attrs.binding.source === "kpi" ? "open_values" : "open_inputs", details: { reason, token: t.idx } }));
  }

  if (doc.kind === "sustainability" && input.sustainability && !input.sustainability.locked) {
    out.push(check(doc, "YEAR_NOT_LOCKED", `${input.sustainability.periodLabel} isn't locked yet. Lock the year's KPI values before the final.`, { fix: "open_link", details: { link: "/kpi/dashboard" } }));
  }
  return out;
}

/** The page's layout id and name, lower-cased (to find the leadership page). */
function pageLayout(doc: CheckInput["doc"], pageId: string): string {
  const p = doc.pages.find((x) => x.id === pageId);
  if (!p) return "";
  return `${p.id} ${p.kind === "freeform" ? p.layoutId ?? "" : ""} ${p.name}`.toLowerCase();
}
