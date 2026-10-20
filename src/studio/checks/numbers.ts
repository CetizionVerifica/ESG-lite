/**
 * DS-12 (RS-9 §1) · typed numbers in text against the doc's resolved values.
 *
 *   numberCandidates(input)   every figure the doc resolves: values, series points, totals,
 *                             comparisons (change in % and absolute), targets, shares of a
 *                             breakdown, and numeric report inputs (revenue, employees, …)
 *   numberChecks(input)       NUMBER_MISMATCH (error, fix replace_with_token when a chip can
 *                             say it) and NUMBER_UNBOUND (info) per typed number
 *
 * The matcher itself is render/checks/number.ts (shared with the editor).
 */
import { extractNumbers, matchClaim, type NumberCandidate, type NumberClaim } from "../../reporting/studio/render/checks/number";
import type { Check, GhgBinding, KpiBinding, Measure } from "../contracts";
import type { ResolvedBinding } from "../sources/types";
import { check, type CheckInput } from "./types";

/** At most this many NUMBER_UNBOUND rows per doc (they are for review only). */
export const MAX_UNBOUND = 40;

interface Candidate extends NumberCandidate {
  /** A chip that says this figure: binding + measure (single-value GHG/KPI bindings and tokens only). */
  chip?: { binding: GhgBinding | KpiBinding; measure: Measure };
  display?: string;
}

const push = (out: Candidate[], value: number | null | undefined, unit: string | null, c: Omit<Candidate, "value" | "unit">) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return;
  out.push({ value, unit, ...c });
};

function fromResolved(out: Candidate[], r: ResolvedBinding, label: string, ref: NumberCandidate["ref"], single: GhgBinding | KpiBinding | null, display?: string) {
  const unit = r.unit ?? null;
  push(out, r.value, unit, { label, ref, ...(single ? { chip: { binding: single, measure: "value" as Measure } } : {}), ...(display ? { display } : {}) });
  if (r.compare) {
    push(out, r.compare.value, unit, { label: `${label} (${r.compare.against === "base" ? "base year" : "prior year"})`, ref });
    push(out, r.compare.change_abs, unit, { label: `${label} change`, ref, ...(single ? { chip: { binding: { ...single, compare: r.compare.against === "target" ? undefined : r.compare.against } as GhgBinding | KpiBinding, measure: "change_abs" as Measure } } : {}) });
    push(out, r.compare.change_pct, "%", { label: `${label} change, %`, ref, ...(single ? { chip: { binding: { ...single, compare: r.compare.against === "target" ? undefined : r.compare.against } as GhgBinding | KpiBinding, measure: "change_pct" as Measure } } : {}) });
  }
  if (r.target) {
    push(out, r.target.target_value, unit, { label: `${label} target`, ref });
    push(out, r.target.baseline_value, unit, { label: `${label} baseline`, ref });
    push(out, r.target.progress_pct, "%", { label: `${label} progress`, ref });
  }
  const total = r.total ?? r.value;
  for (const s of [...(r.series ?? []), ...(r.stacks ?? [])]) {
    for (const p of s.values) {
      push(out, p.value, unit, { label: `${label} · ${p.key}`, ref });
      if (total && p.value !== null && (r.series ?? []).includes(s)) push(out, (p.value / total) * 100, "%", { label: `${label} · ${p.key} share`, ref });
    }
  }
}

/** Is a binding a single figure a chip can show (no breakdown)? */
const singleValue = (b: { source: string; breakdown?: unknown }): b is GhgBinding | KpiBinding => (b.source === "ghg" || b.source === "kpi") && !b.breakdown;

export function numberCandidates(input: CheckInput): Candidate[] {
  const out: Candidate[] = [];
  for (const b of input.ix.bindings) {
    const r = input.resolved.values[b.idx];
    if (!r || r.unavailable || b.binding.source === "custom") continue;
    fromResolved(out, r, labelOf(b.binding), { kind: "binding", idx: b.idx }, singleValue(b.binding) ? b.binding : null, r.display);
  }
  for (const t of input.ix.tokens) {
    const r = input.resolved.tokens[t.idx];
    if (!r || r.unavailable) continue;
    push(out, r.value, r.unit ?? null, { label: labelOf(t.token.attrs.binding), ref: { kind: "token", idx: t.idx }, chip: { binding: t.token.attrs.binding, measure: t.token.attrs.measure }, display: r.display });
  }
  for (const [key, entry] of Object.entries(input.inputs)) {
    const v = (entry as { value?: unknown } | undefined)?.value;
    if (typeof v === "number") push(out, v, key === "significance_threshold_pct" ? "%" : null, { label: key.replace(/_/g, " ") });
  }
  return out;
}

function labelOf(b: { source: string; metric?: string; kpis?: string[]; key?: string; scope3Category?: number }): string {
  if (b.source === "ghg") return b.metric === "scope3_category" && b.scope3Category ? `Scope 3 Category ${b.scope3Category}` : String(b.metric ?? "").replace(/_/g, " ");
  if (b.source === "kpi") return (b.kpis ?? []).join(", ");
  return String(b.key ?? b.source);
}

const UNIT_TEXT = (u: string | null | undefined) => (u ? ` ${u}` : "");

/** NUMBER_MISMATCH and NUMBER_UNBOUND for every typed number in the visible text. */
export function numberChecks(input: CheckInput): Check[] {
  const { doc, ix } = input;
  const candidates = numberCandidates(input);
  const out: Check[] = [];
  let unbound = 0;
  for (const block of ix.texts) {
    if (block.hidden) continue;
    block.paragraphs.forEach((para, p) => {
      for (const claim of extractNumbers(para)) {
        const m = matchClaim(claim, candidates);
        const at = { pageId: block.pageId, ...(block.elementId ? { elementId: block.elementId } : {}) };
        const where = { paragraph: p, start: claim.start, end: claim.end, typed: claim.text };
        if (m.status === "mismatch") {
          const c = m.candidate as Candidate;
          const shown = c.display && c.ref?.kind === "token" ? c.display : formatLike(c.value, claim);
          out.push(
            check(doc, "NUMBER_MISMATCH", `"${claim.text}" doesn't match your approved data: ${c.label ? `${c.label} is ` : ""}${shown}${UNIT_TEXT(c.unit)}.`, {
              ...at,
              ...(c.chip ? { fix: "replace_with_token" as const } : {}),
              details: { ...where, expected: c.value, unit: c.unit, label: c.label ?? null, ...(c.chip ? { chip: c.chip } : {}) },
            }),
          );
        } else if (m.status === "unbound" && unbound < MAX_UNBOUND) {
          unbound++;
          out.push(check(doc, "NUMBER_UNBOUND", `"${claim.text}" isn't a figure from your approved data. Check it, or link it to data.`, { ...at, details: where }));
        }
      }
    });
  }
  return out;
}

/** A candidate written at the writer's precision ("48,600" for 48,620 typed as hundreds). */
function formatLike(value: number, claim: NumberClaim): string {
  const step = claim.step > 0 ? claim.step : 1;
  const decimals = step < 1 ? Math.min(6, Math.round(-Math.log10(step))) : 0;
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 2) });
}
