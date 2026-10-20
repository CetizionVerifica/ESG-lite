/**
 * AT-1 · template suggestions, the pure parts (no DB, no model):
 *
 *   briefIssues(kind, brief)              purpose ↔ kind and frameworks ↔ kind (DS_VALIDATION issues)
 *   ruleShortlist(templates, input)       hard filters (kind, format, purpose) → one look per family
 *                                         (by tone) → a rule fit 0..100 (purpose, length, frameworks,
 *                                         audience), best first
 *   templateDataUnits(doc, empty)         per data-bound page (and per Scope 3 category of a category
 *                                         flow): has data or not, and which gap it belongs to
 *   scoreReadiness(units, facts, …)       TemplateReadiness: score, level, badges (counts only)
 *   rankCandidates(cands)                 rule fit 60 % + readiness 40 %, stable
 *   readPicks(answer, candidates, nums)   the model's answer, guarded: zod, ids in the shortlist,
 *                                         no literal number except the counts offered, page ids
 *                                         and layout slugs kept only when they exist
 *
 * Readiness reads counts only (approved months, Scope 3 categories with data,
 * KPI coverage %, targets set, base year set) and, per page, whether DS-2
 * resolved anything for it (DS-5 `emptyDataPages`). No figure is computed here
 * and none goes to the model.
 */
import {
  BRIEF_LENGTH_PAGES,
  FRAMEWORKS_BY_KIND,
  TemplateSuggestModelOutputSchema,
  type Binding,
  type DataToken,
  type Look,
  type ReadinessBadge,
  type ReadinessBadgeKey,
  type ReadinessLevel,
  type ReportDoc,
  type ReportKind,
  type ReportTemplate,
  type TemplateBrief,
  type TemplateReadiness,
} from "../contracts";
import { literalNumberIssues } from "../ai/guard";
import { parseJsonObject } from "../ai/client";
import { collectTokens, docBindings } from "../sources/doc";

type Json = Record<string, any>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** How many rule-ranked families the model may choose from (it returns at most TEMPLATE_SHORTLIST_MAX). */
export const AI_CANDIDATES_MAX = 5;

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

/** The kind a purpose belongs to (null = either kind). */
export const PURPOSE_KIND: Record<TemplateBrief["purpose"], ReportKind | null> = {
  sustainability_report: "sustainability",
  ghg_inventory: "ghg",
  board_brief: null,
  site_fact_sheet: null,
};

/** Template purposes (DocPurpose) that fit a brief purpose, best first. */
export const PURPOSE_FIT: Record<TemplateBrief["purpose"], string[]> = {
  sustainability_report: ["report"],
  ghg_inventory: ["report"],
  board_brief: ["deck", "summary"],
  site_fact_sheet: ["summary", "social"],
};

/** Looks a tone prefers, best first (company templates have no look). */
export const TONE_LOOKS: Record<NonNullable<TemplateBrief["tone"]>, Look[]> = {
  formal: ["classic", "light", "night"],
  plain: ["light", "classic", "night"],
  engaging: ["night", "classic", "light"],
};

export function briefIssues(kind: ReportKind, brief: TemplateBrief): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  const pk = PURPOSE_KIND[brief.purpose];
  if (pk && pk !== kind) issues.push({ path: "brief.purpose", message: `${brief.purpose} is a ${pk === "ghg" ? "GHG" : "sustainability"} report` });
  const allowed = FRAMEWORKS_BY_KIND[kind] as readonly string[];
  brief.frameworks.forEach((f, i) => {
    if (!allowed.includes(f)) issues.push({ path: `brief.frameworks.${i}`, message: `${f} isn't a framework of ${kind} reports` });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// Rule shortlist
// ---------------------------------------------------------------------------

export interface RuleTemplate extends ReportTemplate {
  /** The frameworks the template reports on (doc.meta.frameworks, plus index pages and tags). */
  frameworks: string[];
}

export interface RuleInput {
  kind: ReportKind;
  brief: TemplateBrief;
  format?: string;
  /** The frameworks the company has switched on (sustainability); empty = no restriction. */
  enabledFrameworks: string[];
}

export interface RuleEntry {
  template: RuleTemplate;
  /** Rule fit, 0..100. */
  fit: number;
}

const FRAMEWORK_HINTS: Record<string, RegExp> = {
  GRI: /\bgri\b/i,
  BRSR: /\bbrsr\b/i,
  ESRS: /\besrs\b/i,
  GHGP: /ghg protocol|\bghgp\b/i,
  ISO14064: /iso\s?14064/i,
  BRSR_P6: /brsr/i,
  ESRS_E1: /esrs/i,
};

/** The frameworks a template covers: its doc's meta.frameworks, its index flow pages and its tags. */
export function templateFrameworks(kind: ReportKind, doc: Json | null, tags: string[]): string[] {
  const out = new Set<string>();
  const allowed = FRAMEWORKS_BY_KIND[kind] as readonly string[];
  const meta = isObj(doc?.meta) ? doc!.meta : {};
  for (const f of Array.isArray(meta.frameworks) ? meta.frameworks : []) if (allowed.includes(String(f))) out.add(String(f));
  const flows = (Array.isArray(doc?.pages) ? doc!.pages : []).filter((p: Json) => isObj(p) && p.kind === "flow").map((p: Json) => String(p.flowType ?? ""));
  if (flows.includes("gri_index")) out.add("GRI");
  if (flows.includes("brsr_index")) out.add(kind === "ghg" ? "BRSR_P6" : "BRSR");
  if (flows.includes("esrs_index")) out.add(kind === "ghg" ? "ESRS_E1" : "ESRS");
  if (flows.includes("ghgp_index")) out.add("GHGP");
  if (flows.includes("iso_index")) out.add("ISO14064");
  const tagText = tags.join(" | ");
  for (const f of allowed) if (FRAMEWORK_HINTS[f]?.test(tagText)) out.add(f);
  return allowed.filter((f) => out.has(f));
}

const AUDIENCE_HINTS: Record<TemplateBrief["audience"], { purposes: string[]; tags: RegExp }> = {
  verifier: { purposes: ["report"], tags: /verification|iso|inventory|uncertainty|assurance/i },
  board: { purposes: ["deck", "summary"], tags: /board|deck|brief|summary/i },
  investors: { purposes: ["report", "deck"], tags: /annual|investor|esrs|climate|editorial/i },
  public: { purposes: ["report", "summary", "social"], tags: /public|summary|minimal|editorial|photos/i },
};

/** Pure rule fit, 0..100: purpose 40, length 30, frameworks 20, audience 6, the tone's look 4. */
export function ruleFit(t: RuleTemplate, brief: TemplateBrief, wanted: string[]): number {
  const fits = PURPOSE_FIT[brief.purpose];
  const pIdx = fits.indexOf(t.purpose);
  const purpose = pIdx === 0 ? 40 : pIdx > 0 ? 25 : 0;
  const target = BRIEF_LENGTH_PAGES[brief.length];
  const length = 30 * Math.max(0, 1 - Math.abs(t.pageCount - target) / Math.max(target, 8));
  const frameworks = wanted.length ? (20 * wanted.filter((f) => t.frameworks.includes(f)).length) / wanted.length : 20;
  const a = AUDIENCE_HINTS[brief.audience];
  const text = `${t.name} ${t.description} ${t.tags.join(" ")}`;
  const audience = (a.purposes.includes(t.purpose) ? 3 : 0) + (a.tags.test(text) ? 3 : 0);
  // The tone's look, across families too (sustainability families each have one look).
  const lookIdx = t.look && brief.tone ? TONE_LOOKS[brief.tone].indexOf(t.look) : -1;
  const tone = lookIdx === 0 ? 4 : lookIdx === 1 ? 2 : 0;
  return Math.round(purpose + length + frameworks + audience + tone);
}

/** The frameworks the brief asks for, limited to what the company has on (sustainability). */
export function wantedFrameworks(input: Pick<RuleInput, "kind" | "brief" | "enabledFrameworks">): string[] {
  const allowed = FRAMEWORKS_BY_KIND[input.kind] as readonly string[];
  const asked = input.brief.frameworks.filter((f) => allowed.includes(f));
  const on = input.enabledFrameworks.filter((f) => allowed.includes(f));
  if (!asked.length) return on;
  const both = on.length ? asked.filter((f) => on.includes(f)) : asked;
  return both.length ? both : asked;
}

/**
 * Hard filters (kind, format; the purpose when any template has it), then one
 * template per family (the look the tone prefers), ranked by rule fit.
 * `considered` = templates of the kind the rules looked at.
 */
export function ruleShortlist(templates: RuleTemplate[], input: RuleInput): { entries: RuleEntry[]; considered: number } {
  const ofKind = templates.filter((t) => t.kind === input.kind);
  const formatted = input.format ? ofKind.filter((t) => t.format === input.format) : ofKind;
  const fits = PURPOSE_FIT[input.brief.purpose];
  const purposed = formatted.filter((t) => fits.includes(t.purpose));
  const pool = purposed.length ? purposed : formatted;
  const looks = TONE_LOOKS[input.brief.tone ?? "formal"];
  const byFamily = new Map<string, RuleTemplate>();
  const lookRank = (t: RuleTemplate) => (t.look ? looks.indexOf(t.look) : -1); // company templates first
  for (const t of pool) {
    const key = t.companyId === null ? t.family : `company:${t.id}`;
    const cur = byFamily.get(key);
    if (!cur || lookRank(t) < lookRank(cur) || (lookRank(t) === lookRank(cur) && t.id < cur.id)) byFamily.set(key, t);
  }
  const wanted = wantedFrameworks(input);
  const entries = [...byFamily.values()].map((template) => ({ template, fit: ruleFit(template, input.brief, wanted) }));
  entries.sort((a, b) => b.fit - a.fit || a.template.id - b.template.id);
  return { entries, considered: ofKind.length };
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export interface ReadinessFacts {
  kind: ReportKind;
  /** Months of the period with approved Scope 1 or 2 rows (a yearly approved row covers all), of the months so far. */
  scope12Months: { have: number; of: number };
  /** Scope 3 categories with approved data (computeScope3 > 0), and excluded in screening. */
  scope3: { reported: number[]; excluded: number[] };
  /** KPI coverage per framework, percent (sustainability readiness); [] for GHG. */
  kpiCoverage: Array<{ framework: string; pct: number }>;
  /** Company-level KPI targets set. */
  targets: number;
  /** A base year is set (company_base_year). */
  baseYear: boolean;
}

export interface DataUnit {
  pageId: string;
  /** Scope 3 category of a category flow unit. */
  category?: number;
  hasData: boolean;
  gap: ReadinessBadgeKey;
}

const S3_METRICS = new Set(["scope3", "scope3_category"]);

/** Which gap a page's data belongs to (the first that applies). */
function pageGap(bindings: Binding[]): ReadinessBadgeKey {
  const kpi = bindings.filter((b) => b.source === "kpi");
  const ghg = bindings.filter((b) => b.source === "ghg") as Array<Extract<Binding, { source: "ghg" }>>;
  if (kpi.some((b) => (b as Json).compare === "target")) return "targets";
  if (ghg.some((b) => b.compare === "base")) return "base_year";
  if (ghg.length && ghg.every((b) => S3_METRICS.has(b.metric))) return "scope3_categories";
  if (ghg.length) return "scope12_months";
  return "kpi_coverage";
}

/**
 * The template's data units: every free-form page with GHG/KPI bindings or
 * chips (has data = DS-2 resolved something for it, i.e. not in `empty`),
 * and every category of a `scope3_categories` flow page (has data = the
 * category is reported).
 */
export function templateDataUnits(doc: ReportDoc, empty: Set<string>, reportedScope3: number[]): DataUnit[] {
  const units: DataUnit[] = [];
  for (const page of doc.pages as Json[]) {
    if (page.kind === "flow") {
      if (page.flowType !== "scope3_categories") continue;
      const opts = isObj(page.options) ? page.options : {};
      const cats: number[] = Array.isArray(opts.categories) && opts.categories.length ? opts.categories.map(Number).filter((n: number) => n >= 1 && n <= 15) : Array.from({ length: 15 }, (_, i) => i + 1);
      for (const n of cats) units.push({ pageId: String(page.id), category: n, hasData: reportedScope3.includes(n), gap: "scope3_categories" });
      continue;
    }
    const one = { ...doc, pages: [page] } as ReportDoc;
    const bindings: Binding[] = [...docBindings(one), ...collectTokens(one).map((t: DataToken) => t.attrs.binding as Binding)].filter((b) => b.source === "ghg" || b.source === "kpi");
    if (!bindings.length) continue;
    units.push({ pageId: String(page.id), hasData: !empty.has(String(page.id)), gap: pageGap(bindings) });
  }
  return units;
}

const status = (have: number, of: number): ReadinessBadge["status"] => (of > 0 && have >= of ? "ok" : have > 0 ? "partial" : "missing");
const pages = (n: number) => `${n} ${n === 1 ? "page" : "pages"}`;

export const levelFor = (score: number): ReadinessLevel => (score >= 85 ? "ready" : score >= 50 ? "partial" : "low");

/** Pure: the readiness of one template from its data units and the company's counts. */
export function scoreReadiness(units: DataUnit[], facts: ReadinessFacts, frameworks: string[]): TemplateReadiness {
  const missingBy = (k: ReadinessBadgeKey) => new Set(units.filter((u) => u.gap === k && !u.hasData).map((u) => (u.category ? `${u.pageId}#${u.category}` : u.pageId))).size;
  const has = (k: ReadinessBadgeKey) => units.some((u) => u.gap === k);
  const badges: ReadinessBadge[] = [];
  if (has("scope12_months")) {
    const { have, of } = facts.scope12Months;
    const n = missingBy("scope12_months");
    badges.push({
      key: "scope12_months",
      label: `Scope 1 and 2: ${have} of ${of} months approved${n ? ` · ${pages(n)} show “Not reported”` : ""}`,
      have,
      of,
      status: status(have, of),
      notReportedPages: n,
    });
  }
  if (has("scope3_categories")) {
    const have = new Set(facts.scope3.reported.filter((c) => c >= 1 && c <= 15)).size;
    const n = missingBy("scope3_categories");
    badges.push({
      key: "scope3_categories",
      label: `Scope 3: ${have} of 15 categories have data${n ? ` · ${pages(n)} will say “Not reported” or why they are excluded` : ""}`,
      have,
      of: 15,
      status: status(have, 15),
      notReportedPages: n,
    });
  }
  if (has("kpi_coverage") || facts.kind === "sustainability") {
    const n = missingBy("kpi_coverage");
    const cov = facts.kpiCoverage.filter((c) => !frameworks.length || frameworks.includes(c.framework));
    let first = true;
    for (const c of cov) {
      const have = Math.max(0, Math.min(100, Math.round(c.pct)));
      badges.push({ key: "kpi_coverage", label: `${c.framework}: ${have}% of KPI values approved`, have, of: 100, status: status(have, 100), notReportedPages: first ? n : 0, framework: c.framework });
      first = false;
    }
    if (!cov.length && has("kpi_coverage")) badges.push({ key: "kpi_coverage", label: `KPIs: no approved values yet${n ? ` · ${pages(n)} show “Not reported”` : ""}`, have: 0, of: 100, status: "missing", notReportedPages: n });
  }
  if (has("targets")) {
    const n = missingBy("targets");
    const have = Math.min(facts.targets, 1);
    badges.push({ key: "targets", label: have ? "Targets are set in KPI tracking" : "Targets page needs a target set in KPI tracking", have, of: 1, status: have ? "ok" : "missing", notReportedPages: n });
  }
  if (has("base_year")) {
    const n = missingBy("base_year");
    badges.push({ key: "base_year", label: facts.baseYear ? "Base year is set" : "Base-year pages need a base year in Scope 3 settings", have: facts.baseYear ? 1 : 0, of: 1, status: facts.baseYear ? "ok" : "missing", notReportedPages: n });
  }
  const total = units.length;
  const missingUnits = units.filter((u) => !u.hasData).length;
  const score = total ? Math.round((100 * (total - missingUnits)) / total) : 100;
  const notReportedPages = new Set(units.filter((u) => !u.hasData).map((u) => (u.category ? `${u.pageId}#${u.category}` : u.pageId))).size;
  return { score, level: levelFor(score), badges, notReportedPages };
}

// ---------------------------------------------------------------------------
// Ranking and the model's answer
// ---------------------------------------------------------------------------

export interface Candidate {
  template: RuleTemplate;
  fit: number;
  readiness: TemplateReadiness;
  /** Page ids and names of the template's doc. */
  pages: Array<{ id: string; name: string }>;
  /** Layout slugs of the family not already in the template (may be added). */
  addable: string[];
}

export const combinedScore = (c: Pick<Candidate, "fit" | "readiness">) => 0.6 * c.fit + 0.4 * c.readiness.score;

/** Rule order: fit and readiness together; ties by rule fit, then id. */
export function rankCandidates<T extends Pick<Candidate, "fit" | "readiness"> & { template: { id: number } }>(cands: T[]): T[] {
  return [...cands].sort((a, b) => combinedScore(b) - combinedScore(a) || b.fit - a.fit || a.template.id - b.template.id);
}

/** The numbers the model was shown (counts, page counts, scores): the only digits a reason may carry, besides years. */
export function offeredNumbers(cands: Candidate[]): Set<number> {
  const out = new Set<number>([15]);
  for (const c of cands) {
    out.add(c.template.pageCount);
    out.add(c.readiness.score);
    out.add(c.readiness.notReportedPages);
    for (const b of c.readiness.badges) [b.have, b.of, b.notReportedPages].forEach((n) => out.add(n));
  }
  return out;
}

/** Literal numbers in a reason that aren't counts the model was shown. */
export function reasonNumberIssues(text: string, allowed: Set<number>): string[] {
  const masked = text.replace(/\d+(?:[.,]\d+)*/g, (m) => (/^\d+$/.test(m) && allowed.has(Number(m)) ? " ".repeat(m.length) : m));
  return literalNumberIssues(masked).map((i) => i.replace("use a data token from FACTS instead", "only the counts in TEMPLATES may be written"));
}

export interface TemplatePick {
  templateId: number;
  reasons: string[];
  pagesToDrop: string[];
  pagesToAdd: string[];
}

const tidy = (s: string) => s.replace(/<[^>]*>/g, "").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim().slice(0, 200);

/** The model's answer → picks in its order (ids from the candidates only), or the issues for the retry. */
export function readPicks(answer: string, cands: Candidate[], allowed: Set<number>): TemplatePick[] | { issues: string[] } {
  let json: unknown;
  try {
    json = parseJsonObject(answer);
  } catch {
    return { issues: ["The answer wasn't one JSON object"] };
  }
  const r = TemplateSuggestModelOutputSchema.safeParse(json);
  if (!r.success) return { issues: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const issues: string[] = [];
  const out: TemplatePick[] = [];
  const seen = new Set<number>();
  for (const p of r.data.picks) {
    const c = cands.find((x) => x.template.id === p.templateId);
    if (!c) {
      issues.push(`templateId ${p.templateId} isn't in TEMPLATES`);
      continue;
    }
    if (seen.has(c.template.id)) {
      issues.push(`templateId ${p.templateId} is picked twice`);
      continue;
    }
    seen.add(c.template.id);
    const reasons = p.reasons.map(tidy).filter(Boolean);
    for (const reason of reasons) issues.push(...reasonNumberIssues(reason, allowed));
    if (/\{\{|\}\}/.test(reasons.join(" "))) issues.push("Reasons are plain text: no tokens or placeholders");
    const pageIds = new Set(c.pages.map((x) => x.id));
    out.push({
      templateId: c.template.id,
      reasons,
      pagesToDrop: [...new Set(p.pagesToDrop)].filter((id) => pageIds.has(id)),
      pagesToAdd: [...new Set(p.pagesToAdd)].filter((slug) => c.addable.includes(slug)),
    });
  }
  if (issues.length) return { issues };
  return out.length ? out : { issues: ["No usable pick"] };
}
