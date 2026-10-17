/**
 * S3-12 · screening suggestions (pure, unit tested in ci/unit/scope3-screening-rules.test.cjs).
 *
 * The guidance screens all 15 categories with rough data first and ranks them
 * by Table II (L1122-1173), but sets no numeric threshold, so these are
 * suggestions an Admin applies or overrides, never automatic changes:
 *   1. any Table II tick                                   → included
 *   2. no screening input, no rows, no tick                 → not_relevant "No activity in this category in <year>"
 *   3. a size we can't estimate (input without an estimate) → screening (keep looking)
 *   4. inside the categories that make up the top 95 %      → included
 *   5. below 1 % of the screened total                      → excluded "Estimated below 1 % of Scope 3 (≈ x tCO₂e by spend screening, <year>)"
 *   6. anything else (1 % or more, outside the top 95 %)    → included
 */
import type { BoundaryStatus, RelevanceKey } from "../contracts/schemas";

/** Categories that together make up this share of the screened total are suggested for inclusion. */
export const TOP_SHARE_PCT = 95;
/** A category below this share of the screened total, with no tick, is suggested for exclusion. */
export const BELOW_SHARE_PCT = 1;

/** Table II (L1149-1173) criteria (`RELEVANCE_KEYS` in the contracts), with their plain wording. */
export const RELEVANCE_LABELS: Record<RelevanceKey, string> = {
  size: "Size",
  influence: "Influence",
  risk: "Risk",
  stakeholders: "Stakeholders",
  outsourcing: "Outsourcing",
  sector_guidance: "Sector guidance",
  spend_analysis: "Spending or revenue analysis",
  other: "Other",
};

/** Where a category's screening size came from. */
export type SizeBasis = "spend" | "revenue" | "headcount" | "recorded";

const BASIS_WORDS: Record<SizeBasis, string> = {
  spend: "by spend screening",
  revenue: "by revenue screening",
  headcount: "by headcount screening",
  recorded: "from recorded data",
};

export interface RuleInput {
  n: number;
  /** tCO₂e used to rank the category: the larger of recorded and estimated; null when nothing gives a size. */
  size_tco2e: number | null;
  size_basis: SizeBasis | null;
  /** A `scope3_screening_input` row exists for the category and year. */
  has_input: boolean;
  /** Approved or pending emission rows exist for the category and year. */
  has_rows: boolean;
  /** Ticked Table II criteria (keys of `relevance` set to true). */
  ticks: string[];
}

export interface Suggestion {
  status: BoundaryStatus;
  reason: string | null;
}

/** "≈ 1,234 tCO₂e"; one decimal below 10 t, two below 0.1 t. */
export const approxTonnes = (t: number): string => {
  const digits = t < 0.1 ? 2 : t < 10 ? 1 : 0;
  return `≈ ${t.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits })} tCO₂e`;
};

const pct = (p: number): string => `${p.toLocaleString("en-US", { maximumFractionDigits: p < 1 ? 2 : 1 })} %`;

/** Share of the screened total per category, in %, and the set inside the top {@link TOP_SHARE_PCT} %. */
export function shares(rows: Pick<RuleInput, "n" | "size_tco2e">[]): { total: number; share: Map<number, number>; top: Set<number> } {
  const sized = rows.filter((r) => (r.size_tco2e ?? 0) > 0).sort((a, b) => b.size_tco2e! - a.size_tco2e! || a.n - b.n);
  const total = sized.reduce((s, r) => s + r.size_tco2e!, 0);
  const share = new Map<number, number>();
  const top = new Set<number>();
  let before = 0;
  for (const r of sized) {
    const p = (r.size_tco2e! / total) * 100;
    share.set(r.n, p);
    // A category is in the top set when the ones above it haven't reached the threshold yet.
    if (before < TOP_SHARE_PCT - 1e-9) top.add(r.n);
    before += p;
  }
  return { total, share, top };
}

/** One suggestion per category of `rows` (keyed by n). */
export function suggest(rows: RuleInput[], year: number): Map<number, Suggestion> {
  const { share, top } = shares(rows);
  const out = new Map<number, Suggestion>();
  for (const r of rows) {
    const ticks = r.ticks.filter((k): k is RelevanceKey => k in RELEVANCE_LABELS);
    const size = r.size_tco2e;
    const p = share.get(r.n) ?? 0;
    if (ticks.length) {
      out.set(r.n, { status: "included", reason: `Relevant: ${ticks.map((k) => RELEVANCE_LABELS[k].toLowerCase()).join(", ")}` });
    } else if (!r.has_input && !r.has_rows && !(size && size > 0)) {
      out.set(r.n, { status: "not_relevant", reason: `No activity in this category in ${year}` });
    } else if (size === null) {
      out.set(r.n, { status: "screening", reason: "Not enough data to estimate this category yet" });
    } else if (top.has(r.n) && p >= BELOW_SHARE_PCT) {
      out.set(r.n, { status: "included", reason: `Among the categories that make up ${TOP_SHARE_PCT} % of estimated Scope 3 (${approxTonnes(size)}, ${pct(p)})` });
    } else if (p < BELOW_SHARE_PCT) {
      const words = r.size_basis ? ` ${BASIS_WORDS[r.size_basis]}` : "";
      out.set(r.n, { status: "excluded", reason: `Estimated below ${BELOW_SHARE_PCT} % of Scope 3 (${approxTonnes(size)}${words}, ${year})` });
    } else {
      out.set(r.n, { status: "included", reason: `Estimated at ${pct(p)} of Scope 3 (${approxTonnes(size)})` });
    }
  }
  return out;
}
