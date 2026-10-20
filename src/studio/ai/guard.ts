/**
 * DS-9 · the token guard (01-contracts §8, RS-8 `guard.ts`). Pure: no DB.
 *
 * The model writes figures only as tokens, which the server turns into data
 * chips (TipTap `data` nodes) bound to approved data:
 *
 *   {{data:METRIC|YEAR|MEASURE}}   a GHG metric (GHG_METRICS); a Scope 3 category is
 *                                  `scope3_category.N` (N = 1–15)
 *   {{kpi:CODE|YEAR|MEASURE}}      a KPI or headline code (sustainability)
 *   {{input:KEY}}                  a report detail (text, e.g. the consolidation approach)
 *
 *   YEAR     current | prior | base | a four-digit year (default current)
 *   MEASURE  value | change_abs | change_pct | share | progress | target | baseline (default value)
 *
 * Order (server side): zod (the caller) → literal numbers → token scope → one
 * retry with the issues listed (runner.ts) → DS_AI_OUTPUT_INVALID.
 *
 * Literal-number rule: after removing tokens and the allowlist, any digit
 * sequence of two or more digits, or any digit next to a unit or currency, is
 * rejected. Allowlist: years 1990–2100 and year ranges (FY 2025–26), framework
 * and disclosure codes (GRI 305-1, ESRS E1-6, ISO 14064-1, BRSR P6, IFRS S2),
 * SDG numbers, "Scope 1/2/3", "Category 1–15", GWP sets (AR5) and gas formulas
 * (CO2, CH4, N2O, SF6, NF3, HFCs).
 */
import {
  GHG_METRICS,
  MEASURES,
  REPORT_INPUT_KEYS,
  type DataToken,
  type GhgMetric,
  type Measure,
  type ReportInputKey,
  type ReportKind,
  type Suggestion,
  type TextDoc,
  type TextNode,
} from "../contracts";

export type SuggestionSource = Suggestion["sources"][number];
type DataTokenAttrs = DataToken["attrs"];

/** What the model may reference: the facts the prompt listed. */
export interface TokenScope {
  kind: ReportKind;
  docYear: number;
  /** GHG keys offered: 'total', 'scope1', 'scope3_category.4', … */
  ghg: Set<string>;
  /** KPI codes offered (sustainability). */
  kpis: Set<string>;
  /** Report details offered as {{input:KEY}}, with the text they stand for. */
  inputs: Map<ReportInputKey, string>;
  /** Chips already in the text being rewritten: token string → the chip's attrs (kept exactly). */
  existing?: Map<string, DataTokenAttrs>;
}

export const TOKEN_RE = /\{\{\s*(data|kpi|input)\s*:\s*([^}|]*?)\s*(?:\|\s*([^}|]*?)\s*)?(?:\|\s*([^}|]*?)\s*)?\}\}/g;

export interface ParsedToken {
  raw: string;
  type: "data" | "kpi" | "input";
  ref: string;
  year: "current" | "prior" | "base" | number;
  measure: Measure;
}

const PCT_MEASURES = new Set<string>(["change_pct", "share", "progress"]);
const isMeasure = (s: string): s is Measure => (MEASURES as readonly string[]).includes(s);

/** Parses one token's parts; returns an issue string when it can't be read. */
export function parseToken(raw: string, type: string, ref: string, year?: string, measure?: string): ParsedToken | string {
  const y = (year ?? "").trim().toLowerCase();
  let yr: ParsedToken["year"] = "current";
  if (y && y !== "current") {
    if (y === "prior" || y === "base") yr = y;
    else if (/^\d{4}$/.test(y) && Number(y) >= 1990 && Number(y) <= 2100) yr = Number(y);
    else return `${raw}: the year must be current, prior, base or a four-digit year`;
  }
  const m = (measure ?? "").trim() || "value";
  if (!isMeasure(m)) return `${raw}: the measure must be one of ${MEASURES.join(", ")}`;
  return { raw, type: type as ParsedToken["type"], ref: ref.trim(), year: yr, measure: m };
}

/** The token text for a chip (the inverse of tokenAttrs), so rewrites keep chips. */
export function chipToken(attrs: DataTokenAttrs, docYear: number): string {
  const b = attrs.binding;
  const year =
    attrs.year !== undefined
      ? String(attrs.year)
      : Array.isArray(b.years) && b.years.length === 1
        ? b.years[0] === docYear
          ? "current"
          : String(b.years[0])
        : "current";
  if (b.source === "kpi") return `{{kpi:${b.kpis[0]}|${year}|${attrs.measure}}}`;
  const ref = b.metric === "scope3_category" && b.scope3Category ? `scope3_category.${b.scope3Category}` : b.metric;
  return `{{data:${ref}|${year}|${attrs.measure}}}`;
}

/** Year of a token as a number (for `sources`). */
const sourceYear = (t: ParsedToken, docYear: number) => (typeof t.year === "number" ? t.year : t.year === "prior" ? docYear - 1 : docYear);

/** The binding years and chip `year` for a token year. */
function yearParts(t: ParsedToken, docYear: number): { years: { last: number } | number[]; year?: DataTokenAttrs["year"]; compare?: "prior" | "base" } {
  if (t.year === "current" || t.year === docYear) return { years: { last: 1 } };
  if (t.year === "prior" || t.year === docYear - 1) return { years: { last: 2 }, year: "prior" };
  if (t.year === "base") return { years: { last: 1 }, year: "base", compare: "base" };
  return { years: [t.year], year: t.year };
}

/** A GHG key → metric and category, or null. */
export function ghgKey(ref: string): { metric: GhgMetric; category?: number } | null {
  const m = /^scope3_category\.(\d{1,2})$/.exec(ref);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 15 ? { metric: "scope3_category", category: n } : null;
  }
  return (GHG_METRICS as readonly string[]).includes(ref) ? { metric: ref as GhgMetric } : null;
}

/** A data token → chip attrs (or an issue). */
export function tokenAttrs(t: ParsedToken, scope: TokenScope): DataTokenAttrs | string {
  const existing = scope.existing?.get(normalizeToken(t));
  if (existing) return existing;
  const yp = yearParts(t, scope.docYear);
  if (t.type === "data") {
    const k = ghgKey(t.ref);
    if (!k) return `${t.raw}: ${t.ref} isn't a GHG figure`;
    if (!scope.ghg.has(t.ref)) return `${t.raw}: ${t.ref} isn't one of the FACTS you were given`;
    const binding: Record<string, unknown> = { source: "ghg", metric: k.metric, years: yp.years, sites: "all" };
    if (k.category) binding.scope3Category = k.category;
    if (yp.compare) binding.compare = yp.compare;
    return { binding, measure: t.measure, ...(yp.year !== undefined ? { year: yp.year } : {}) } as DataTokenAttrs;
  }
  if (t.type === "kpi") {
    if (!scope.kpis.has(t.ref)) return `${t.raw}: ${t.ref} isn't one of the company's selected KPIs in FACTS`;
    const binding: Record<string, unknown> = { source: "kpi", kpis: [t.ref], years: yp.years, sites: "all" };
    if (yp.compare) binding.compare = yp.compare;
    return { binding, measure: t.measure, ...(yp.year !== undefined ? { year: yp.year } : {}) } as DataTokenAttrs;
  }
  return `${t.raw}: report details aren't data chips`;
}

const normalizeToken = (t: ParsedToken) => `${t.type}:${t.ref}|${t.year}|${t.measure}`;

/** The key `existing` maps use (same normalisation as tokens read from model text). */
export function existingKey(tokenText: string): string | null {
  TOKEN_RE.lastIndex = 0;
  const m = TOKEN_RE.exec(tokenText);
  TOKEN_RE.lastIndex = 0;
  if (!m) return null;
  const p = parseToken(m[0], m[1], m[2], m[3], m[4]);
  return typeof p === "string" ? null : normalizeToken(p);
}

// ---------------------------------------------------------------------------
// Literal numbers
// ---------------------------------------------------------------------------

const ALLOWLIST: RegExp[] = [
  // Framework and disclosure codes: GRI 305-1, ESRS E1-6, ISO 14064-1:2018, BRSR P6, IFRS S2, CDP C6.1
  /\b(?:GRI|ESRS|BRSR|ISO|IFRS|SASB|TCFD|CDP|IPCC|PAS|SBTi|GHGP)\s*[A-Z]{0,2}\s?\d+(?:[.\-–:]\d+)*[a-z]?\b/g,
  /\b[ESGP]\d{1,2}(?:-\d{1,2})?\b/g,
  // SDGs
  /\bSDGs?\s*\d{1,2}(?:\s*(?:,|and|&|–|-)\s*\d{1,2})*\b/gi,
  // Scope and category words
  /\bScopes?\s*[123](?:\s*(?:,|and|&|–|-|to|\+)\s*[123])*\b/gi,
  /\bCategor(?:y|ies)\s*\d{1,2}(?:\s*(?:,|and|&|–|-|to)\s*\d{1,2})*\b/gi,
  // GWP sets and gas formulas
  /\bAR[4-6]\b/g,
  /\b(?:t?CO2e?|CH4|N2O|SF6|NF3|(?:HFC|PFC)-?\d+[a-z]?)\b/g,
  // Year ranges and years
  /\bFY\s?'?\d{2}(?:\s*[–\-/]\s*\d{2})?\b/g,
  /\b(?:199\d|20\d\d|2100)\s*[–\-/]\s*(?:\d{2}|199\d|20\d\d|2100)\b/g,
  /\b(?:199\d|20\d\d|2100)\b/g,
];

const UNIT_AFTER = /^\s*(?:%|percent\b|per\s?cent\b|t\b|tonnes?\b|tons?\b|tCO|kt\b|Mt\b|kg\b|kgCO|g\b|kWh\b|MWh\b|GWh\b|GJ\b|TJ\b|km\b|litres?\b|liters?\b|L\b|m3\b|m³|x\b|×|million\b|billion\b|lakh\b|crore\b|thousand\b|k\b)/i;
const CURRENCY_BEFORE = /(?:[$₹€£¥]|\bUSD|\bINR|\bEUR|\bRs\.?)\s*$/i;

/** Literal figures in a text (tokens excluded): one issue per offending number. */
export function literalNumberIssues(text: string): string[] {
  let s = text.replace(TOKEN_RE, " ⟨token⟩ ");
  for (const re of ALLOWLIST) s = s.replace(re, (m) => " ".repeat(m.length));
  const issues: string[] = [];
  const num = /\d+(?:[.,]\d+)*/g;
  let m: RegExpExecArray | null;
  while ((m = num.exec(s))) {
    const digits = m[0].replace(/\D/g, "").length;
    const after = s.slice(m.index + m[0].length);
    const before = s.slice(0, m.index);
    if (digits >= 2 || UNIT_AFTER.test(after) || CURRENCY_BEFORE.test(before)) {
      issues.push(`"${text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 12).trim()}" has a literal number (${m[0]}); use a data token from FACTS instead`);
    }
  }
  return issues;
}

/** Every token in a text, checked against the scope. */
export function tokenIssues(text: string, scope: TokenScope): string[] {
  const issues: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const p = parseToken(m[0], m[1], m[2], m[3], m[4]);
    if (typeof p === "string") {
      issues.push(p);
      continue;
    }
    if (p.type === "input") {
      if (!(REPORT_INPUT_KEYS as readonly string[]).includes(p.ref) || !scope.inputs.has(p.ref as ReportInputKey)) issues.push(`${p.raw}: ${p.ref} isn't one of the REPORT DETAILS you were given`);
      continue;
    }
    if (p.type === "kpi" && scope.kind !== "sustainability") {
      issues.push(`${p.raw}: a GHG report links GHG figures only ({{data:…}})`);
      continue;
    }
    const a = tokenAttrs(p, scope);
    if (typeof a === "string") issues.push(a);
  }
  // A token-like fragment the regex didn't take ("{{data total}}") is an error too.
  const leftover = text.replace(TOKEN_RE, "");
  if (/\{\{|\}\}/.test(leftover)) issues.push("A token is malformed: write tokens exactly as {{data:METRIC|YEAR|MEASURE}}");
  return issues;
}

/** All guard issues for a text (literal numbers + token scope). */
export function guardText(text: string, scope: TokenScope): string[] {
  return [...literalNumberIssues(text), ...tokenIssues(text, scope)];
}

// ---------------------------------------------------------------------------
// Text ↔ TipTap with chips
// ---------------------------------------------------------------------------

/** Tidies model prose: no markdown emphasis, no HTML, single spaces. */
const tidy = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

/** One line of prose → inline nodes (text and chips). */
function inline(line: string, scope: TokenScope, sources: Map<string, SuggestionSource>): Array<TextNode | DataToken> {
  const out: Array<TextNode | DataToken> = [];
  let at = 0;
  const pushText = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1] as TextNode | undefined;
    if (prev && prev.type === "text" && !("attrs" in prev && prev.attrs)) prev.text = (prev.text ?? "") + t;
    else out.push({ type: "text", text: t });
  };
  for (const m of line.matchAll(TOKEN_RE)) {
    pushText(line.slice(at, m.index));
    at = (m.index ?? 0) + m[0].length;
    const p = parseToken(m[0], m[1], m[2], m[3], m[4]);
    if (typeof p === "string") throw new Error(p);
    if (p.type === "input") {
      pushText(scope.inputs.get(p.ref as ReportInputKey) ?? "");
      sources.set(`input:${p.ref}`, { source: "input", key: p.ref as ReportInputKey });
      continue;
    }
    const attrs = tokenAttrs(p, scope);
    if (typeof attrs === "string") throw new Error(attrs);
    out.push({ type: "data", attrs });
    const b = attrs.binding;
    const year = sourceYear(p, scope.docYear);
    if (b.source === "ghg") {
      const src: SuggestionSource = { source: "ghg", metric: b.metric, year, ...(b.scope3Category ? { scope3Category: b.scope3Category } : {}) };
      sources.set(JSON.stringify(src), src);
    } else {
      const src: SuggestionSource = { source: "kpi", kpi: b.kpis[0], year };
      sources.set(JSON.stringify(src), src);
    }
  }
  pushText(line.slice(at));
  // Percent measures print their own % sign: drop a typed one right after the chip.
  for (let i = 0; i < out.length - 1; i++) {
    const n = out[i] as DataToken;
    const next = out[i + 1] as TextNode;
    if (n.type === "data" && PCT_MEASURES.has(n.attrs.measure) && next.type === "text") next.text = (next.text ?? "").replace(/^\s?%/, "");
  }
  // Trim the edges of the line.
  const first = out[0] as TextNode | undefined;
  if (first?.type === "text") first.text = (first.text ?? "").replace(/^\s+/, "");
  const last = out[out.length - 1] as TextNode | undefined;
  if (last?.type === "text") last.text = (last.text ?? "").replace(/\s+$/, "");
  return out.filter((n) => n.type !== "text" || (n as TextNode).text);
}

/**
 * Paragraph strings (already guarded) → a TextDoc. A paragraph whose lines all
 * start with "- " or "• " becomes a bullet list. Returns the sources of every chip.
 */
export function toTextDoc(paragraphs: string[], scope: TokenScope): { doc: TextDoc; sources: SuggestionSource[] } {
  const sources = new Map<string, SuggestionSource>();
  const content: TextNode[] = [];
  for (const raw of paragraphs) {
    const para = String(raw ?? "").trim();
    if (!para) continue;
    const lines = para.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length && lines.every((l) => /^[-•*]\s+/.test(l))) {
      content.push({
        type: "bulletList",
        content: lines.map((l) => ({ type: "listItem", content: [{ type: "paragraph", content: inline(tidy(l.replace(/^[-•*]\s+/, "")), scope, sources) }] })),
      });
    } else {
      const nodes = inline(tidy(lines.join(" ")), scope, sources);
      content.push(nodes.length ? { type: "paragraph", content: nodes } : { type: "paragraph" });
    }
  }
  if (!content.length) content.push({ type: "paragraph" });
  return { doc: { type: "doc", content } as TextDoc, sources: [...sources.values()] };
}

/**
 * A TextDoc → prose with tokens (for rewrites), plus the chips by token so
 * the rewrite keeps each chip's exact binding (sites, format).
 */
export function textDocToTokens(doc: TextDoc | undefined, docYear: number): { text: string; existing: Map<string, DataTokenAttrs> } {
  const existing = new Map<string, DataTokenAttrs>();
  const block = (n: TextNode | DataToken): string => {
    if (n.type === "data") {
      const t = chipToken((n as DataToken).attrs, docYear);
      const key = existingKey(t);
      if (key) existing.set(key, (n as DataToken).attrs);
      return t;
    }
    const node = n as TextNode;
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return " ";
    const inner = (node.content ?? []).map(block);
    if (node.type === "bulletList" || node.type === "orderedList") return inner.map((l) => `- ${l}`).join("\n");
    if (node.type === "listItem") return inner.join(" ");
    return inner.join("");
  };
  const text = (doc?.content ?? []).map(block).filter((s) => s.trim()).join("\n\n");
  return { text, existing };
}

/** Plain text of a TextDoc with chips shown as their token (for page context). */
export const plainText = (doc: TextDoc | undefined, docYear: number): string => textDocToTokens(doc, docYear).text;
