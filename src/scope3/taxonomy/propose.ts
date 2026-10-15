/**
 * Proposes a GHG Protocol category number for a client category name (S3-1,
 * D1). Pure: no database. Order of evidence:
 *   1. the name equals a GHG Protocol name (confidence 100, "exact");
 *   2. the name contains a legacy category name (the old id → name map in
 *      src/utils/defaultExtraFields.ts) (confidence 95, "legacy_map");
 *   3. keywords such as "freight" → 4, "travel" → 6, "fera" → 3 ("keyword").
 * Nothing matched gives a null number, confidence 0, "none".
 *
 * Only an "exact" proposal may be written to category.ghg_category without a
 * person confirming it.
 */
import { GHG_CATEGORIES, GhgCategoryNumber } from "../contracts/ghgCategory";

export type ProposalBasis = "exact" | "legacy_map" | "keyword" | "none";

export interface Proposal {
  ghg_category: GhgCategoryNumber | null;
  confidence: number;
  basis: ProposalBasis;
}

/** Lower case, "&" as "and", every run of non-letters/digits as one space. */
export const normaliseName = (name: string): string =>
  String(name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const EXACT = new Map<string, GhgCategoryNumber>(GHG_CATEGORIES.map((c) => [normaliseName(c.name), c.n]));

// Names used by the legacy category ids (src/utils/defaultExtraFields.ts) and
// the seeded categories, with their GHG number. Longest first so that
// "fera purchased electricity" wins over shorter names.
const LEGACY: readonly [string, GhgCategoryNumber][] = (
  [
    ["purchased goods and services", 1],
    ["capital goods", 2],
    ["fera stationary combustion", 3],
    ["fera mobile combustion", 3],
    ["fera purchased electricity", 3],
    ["upstream transportation and distribution", 4],
    ["waste generated in operations", 5],
    ["business travel", 6],
    ["employee commuting", 7],
    ["downstream transportation and distribution", 9],
    ["use of sold products", 11],
    ["end of life treatment of sold products", 12],
  ] as [string, GhgCategoryNumber][]
)
  .map(([name, n]) => [normaliseName(name), n] as [string, GhgCategoryNumber])
  .sort((a, b) => b[0].length - a[0].length);

// Most specific first; the first match wins.
const KEYWORDS: readonly [RegExp, GhgCategoryNumber, number][] = [
  [/\bfera\b|\bwell to tank\b|\bwtt\b|\bt and d\b|\btransmission and distribution loss|\bfuel and energy related/, 3, 85],
  [/\bend of life\b|\bdisposal of sold\b|\bsold products? (waste|disposal)\b/, 12, 85],
  [/\buse of sold\b|\bproduct use\b|\buse phase\b/, 11, 85],
  [/\bprocessing of sold\b/, 10, 85],
  [/\bdownstream (leased|lease)\b|\bleased out\b/, 13, 85],
  [/\bupstream (leased|lease)\b/, 8, 85],
  [/\bfranchis/, 14, 90],
  [/\binvestment|\bfinanced emission|\bportfolio\b/, 15, 85],
  [/\bcommut/, 7, 90],
  [/\btravel|\bflights?\b|\bair ?fare|\bhotel/, 6, 85],
  [/\b(downstream|outbound)\b.*\b(transport|freight|logistics|distribution|shipping)|\bdistribution of sold\b/, 9, 80],
  [/\bfreight\b|\blogistics\b|\bshipping\b|\binbound\b|\bupstream transport/, 4, 75],
  [/\bwaste\b/, 5, 80],
  [/\bleased\b|\blease\b/, 8, 60],
  [/\bcapital\b|\bcapex\b|\bmachinery\b|\bplant and equipment\b/, 2, 70],
  [/\btransport/, 4, 60],
  [/\bpurchased?\b|\bprocurement\b|\braw materials?\b|\bmaterials?\b|\bgoods\b|\bservices\b|\bpackaging\b|\bwater supply\b/, 1, 65],
];

export function proposeGhgCategory(name: string): Proposal {
  const text = normaliseName(name);
  if (!text) return { ghg_category: null, confidence: 0, basis: "none" };

  const exact = EXACT.get(text);
  if (exact) return { ghg_category: exact, confidence: 100, basis: "exact" };

  for (const [legacy, n] of LEGACY) {
    if (text === legacy || ` ${text} `.includes(` ${legacy} `)) return { ghg_category: n, confidence: 95, basis: "legacy_map" };
  }

  for (const [re, n, confidence] of KEYWORDS) {
    if (re.test(text)) return { ghg_category: n, confidence, basis: "keyword" };
  }
  return { ghg_category: null, confidence: 0, basis: "none" };
}
