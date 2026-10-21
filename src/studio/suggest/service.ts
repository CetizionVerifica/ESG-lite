/**
 * AT-1 · POST /studio/templates/suggest (docs/design-studio/pro/
 * 01-pro-editing-and-ai-templates.md §2A).
 *
 *   1. Rules (rules.ts): the templates of the kind (system + own company, DS-4
 *      listTemplates), format, purpose → one look per family, rule fit.
 *   2. Readiness: the company's counts for the period (DS-5 readiness: Scope 3
 *      categories with data; approved Scope 1/2 months; KPI coverage per
 *      framework; targets and base year set) and, per template, which data
 *      pages DS-2 resolves to nothing (DS-5 resolveForBuild + emptyDataPages,
 *      the same rule the build uses to leave a page out). Counts only.
 *   3. The AI re-orders the top of the rule order and writes 2–3 reasons and
 *      pages to drop/add. It sees template names, descriptions, page names,
 *      the counts and the brief (the free-text note fenced, E2); never a
 *      figure, a person or an email. Guard (rules.ts readPicks): zod, ids in
 *      the shortlist, numbers only from the counts, one retry with the
 *      issues. Unavailable, over budget or invalid twice → rule order,
 *      aiUsed false, no reasons. Each model call is a report_ai_call row
 *      (action 'suggest_templates', doc_id null; the company month budget).
 */
import { AppDataSource } from "../../config/data-source";
import { getPeriodRange } from "../../reporting/ghg-data";
import { enabledFrameworks } from "../../kpi/setup/settings";
import {
  DsError,
  TEMPLATE_SHORTLIST_MAX,
  TEMPLATE_SUGGEST_LOG_ACTION,
  TemplateSuggestBodySchema,
  type ReportDoc,
  type ReportTemplate,
  type TemplateSuggestBody,
  type TemplateSuggestResponse,
  type TemplateSuggestion,
} from "../contracts";
import { assertBudget, logCall } from "../ai/budget";
import { AiCallError, complete } from "../ai/client";
import { fence, SAFETY_RULES } from "../ai/prompts/common";
import { assembleDoc, emptyDataPages } from "../docs/build";
import { loadGhgReadiness, loadSustainabilityReadiness, monthsSoFar } from "../docs/readiness";
import { resolveForBuild } from "../docs/service";
import { loadTemplate, splitTemplateDoc } from "../docs/template";
import { assertKind, type StudioCaller } from "../guard";
import { dsValidationError } from "../contracts/errors";
import { parse } from "../http";
import { listTemplates } from "../library/service";
import { checkSites, readableSites } from "../sources/resolve";
import {
  AI_CANDIDATES_MAX,
  briefIssues,
  offeredNumbers,
  rankCandidates,
  readPicks,
  ruleShortlist,
  scoreReadiness,
  scrubPromptText,
  templateDataUnits,
  templateFrameworks,
  wantedFrameworks,
  type Candidate,
  type ReadinessFacts,
  type RuleTemplate,
  type TemplatePick,
} from "./rules";

type Row = Record<string, any>;
type Json = Record<string, any>;

// ---------------------------------------------------------------------------
// Facts (counts only)
// ---------------------------------------------------------------------------

/** Months of the period with approved Scope 1 or 2 rows; an approved yearly row covers every month. */
async function scope12Months(siteIds: number[], year: number, yearType: "CY" | "FY"): Promise<{ have: number; of: number }> {
  const months = monthsSoFar(yearType, year);
  if (!siteIds.length) return { have: 0, of: months.length };
  const range = getPeriodRange(yearType, year, "yearly");
  const rows: Row[] = await AppDataSource.query(
    `SELECT DISTINCT e.reporting_period, to_char(date_trunc('month', e.date_of_reporting), 'YYYY-MM') AS month
       FROM emission e JOIN category c ON c.category_id = e.category_id
      WHERE e.site_id = ANY($1::int[]) AND e.date_of_reporting >= $2 AND e.date_of_reporting <= $3
        AND c.scope IN ('Scope 1', 'Scope 2') AND e.status::text = 'approved'`,
    [siteIds, range.startDate, range.endDate],
  );
  if (rows.some((r) => r.reporting_period === "yearly")) return { have: months.length, of: months.length };
  const have = new Set(rows.map((r) => String(r.month)).filter((m) => months.includes(m))).size;
  return { have, of: months.length };
}

async function loadFacts(caller: StudioCaller, body: TemplateSuggestBody, siteIds: number[]): Promise<ReadinessFacts> {
  const ghg = await loadGhgReadiness(caller, { year: body.year, yearType: body.yearType, siteIds });
  const kpiCoverage = body.kind === "sustainability" ? (await loadSustainabilityReadiness(caller, body.year)).coverage : [];
  const [t]: Row[] = await AppDataSource.query(`SELECT COUNT(*)::int AS n FROM kpi_target WHERE company_id = $1`, [caller.companyId]).catch(() => [{ n: 0 }]);
  const [b]: Row[] = await AppDataSource.query(`SELECT COUNT(*)::int AS n FROM company_base_year WHERE company_id = $1`, [caller.companyId]).catch(() => [{ n: 0 }]);
  return {
    kind: body.kind,
    scope12Months: await scope12Months(siteIds, body.year, body.yearType),
    scope3: { reported: ghg.scope3.reported, excluded: ghg.scope3.excluded },
    kpiCoverage,
    targets: Number(t?.n) || 0,
    baseYear: (Number(b?.n) || 0) > 0,
  };
}

async function companyFrameworks(caller: StudioCaller, kind: TemplateSuggestBody["kind"]): Promise<string[]> {
  if (kind !== "sustainability") return [];
  const rows = await enabledFrameworks(AppDataSource.manager, caller.companyId).catch(() => [] as Row[]);
  return [...new Set(rows.map((r) => String(r.code)))];
}

/** Layout slugs of a family (system or the company's), for pagesToAdd. */
async function familyLayouts(caller: StudioCaller, family: string): Promise<string[]> {
  const rows: Row[] = await AppDataSource.query(`SELECT slug FROM report_layout WHERE family = $1 AND is_active AND (company_id IS NULL OR company_id = $2) ORDER BY sort, id`, [family, caller.companyId]).catch(() => []);
  return rows.map((r) => String(r.slug));
}

/** One template's readiness: its doc assembled for the brief's period, resolved by DS-2, empty pages counted. */
async function candidateFor(caller: StudioCaller, body: TemplateSuggestBody, entry: { template: RuleTemplate; fit: number }, doc: Json, facts: ReadinessFacts): Promise<Candidate> {
  const row = await loadTemplate(caller.companyId, entry.template.id);
  const { doc: tdoc } = splitTemplateDoc(row.doc);
  const assembled = assembleDoc(row, tdoc, { kind: body.kind, year: body.year, yearType: body.yearType, sites: body.sites, frameworks: body.brief.frameworks }) as unknown as ReportDoc;
  const resolved = await resolveForBuild(caller, assembled, undefined);
  const empty = emptyDataPages(assembled, resolved);
  const units = templateDataUnits(assembled, empty, facts.scope3.reported);
  const readiness = scoreReadiness(units, facts, entry.template.frameworks);
  const pages = (Array.isArray(doc.pages) ? doc.pages : []).map((p: Json) => ({ id: String(p.id), name: String(p.name ?? p.id) }));
  const used = new Set((Array.isArray(doc.pages) ? doc.pages : []).map((p: Json) => String(p.layoutId ?? "")).filter(Boolean));
  const addable = (await familyLayouts(caller, entry.template.family)).filter((s) => !used.has(s));
  return { template: entry.template, fit: entry.fit, readiness, pages, addable };
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

const SYSTEM = [
  "You are the template advisor of ESGLite's Design Studio. A company is starting a new report; you help it choose one of the TEMPLATES that the rules already shortlisted.",
  "",
  "RULES",
  `1. Pick up to ${TEMPLATE_SHORTLIST_MAX} templates from TEMPLATES, best fit first. Use only the ids listed.`,
  "2. For each, write 2 or 3 short reasons (one sentence each, at most 25 words) that tie the template to the BRIEF and to its data readiness.",
  "3. pagesToDrop: page ids of that template the company could leave out (pages that would say \"Not reported\", or that the brief doesn't need). pagesToAdd: layout slugs from that template's \"can add\" list only. Both may be empty.",
  "4. You never see the company's figures and must not invent any. The only numbers you may write are the counts shown in TEMPLATES (months, categories, pages, percentages of KPI coverage) and years. Never write an emission, an amount or any other figure.",
  ...SAFETY_RULES.map((r, i) => `${i + 5}. ${r}`),
  "",
  'Answer with ONE JSON object and nothing else: {"picks": [{"templateId": 12, "reasons": ["…", "…"], "pagesToDrop": ["p05-boundary"], "pagesToAdd": []}]}',
].join("\n");

const LABELS: Record<string, string> = {
  sustainability_report: "an annual sustainability report",
  ghg_inventory: "a GHG inventory",
  board_brief: "a board brief",
  site_fact_sheet: "a site fact sheet",
  verifier: "a verifier or regulator",
  board: "the board",
  investors: "investors",
  public: "the public",
  short: "about 2 pages",
  medium: "about 20 pages",
  long: "about 40 pages",
};

/**
 * The user prompt. Company-written text (the note, a company template's name, description and
 * page names) passes scrubPromptText with the company's own names; the note is fenced (E2).
 */
export function suggestPrompt(body: TemplateSuggestBody, cands: Candidate[], periodText: string, names: string[] = []): string {
  const b = body.brief;
  const clean = (s: string) => scrubPromptText(s, names);
  return [
    `KIND: ${body.kind === "ghg" ? "GHG inventory report" : "sustainability report"} · period ${periodText}`,
    "",
    "BRIEF",
    `- For: ${LABELS[b.purpose]}`,
    `- Audience: ${LABELS[b.audience]}`,
    `- Length: ${LABELS[b.length]}`,
    `- Frameworks: ${b.frameworks.length ? b.frameworks.join(", ") : "not chosen"}`,
    `- Tone: ${b.tone ?? "not chosen"}`,
    ...(b.note ? ["- Anything else (the company's words):", fence("brief_note", clean(b.note))] : []),
    "",
    "TEMPLATES (rule order; readiness = share of data pages with approved data)",
    ...cands.map((c) =>
      [
        `- id ${c.template.id}: ${clean(c.template.name)} · ${c.template.format} · ${c.template.purpose} · look ${c.template.look ?? "company"} · ${c.template.pageCount} pages · frameworks ${c.template.frameworks.join(", ") || "none"}`,
        `  description: ${clean(c.template.description || "") || "none"}`,
        `  readiness: ${c.readiness.score}% (${c.readiness.level}); pages that would say "Not reported": ${c.readiness.notReportedPages}`,
        ...c.readiness.badges.map((x) => `  · ${x.label}`),
        `  pages: ${c.pages.map((p) => `${p.id}=${clean(p.name)}`).join(" | ")}`,
        `  can add: ${c.addable.join(" | ") || "none"}`,
      ].join("\n"),
    ),
  ].join("\n");
}

/** The company's own names (company, brand kit), kept out of the prompt. */
async function companyNames(caller: StudioCaller): Promise<string[]> {
  const rows: Row[] = await AppDataSource.query(
    `SELECT name FROM company WHERE company_id = $1 UNION SELECT name FROM brand WHERE company_id = $1`,
    [caller.companyId],
  ).catch(() => []);
  return rows.map((r) => String(r.name ?? "")).filter(Boolean);
}

/** The model's picks, or null (unavailable, over budget, invalid twice). */
async function aiPicks(caller: StudioCaller, body: TemplateSuggestBody, cands: Candidate[]): Promise<{ picks: TemplatePick[]; model: string } | null> {
  const allowed = offeredNumbers(cands);
  for (const y of [body.year, body.year - 1]) allowed.add(y);
  const base = suggestPrompt(body, cands, body.yearType === "CY" ? String(body.year) : `FY ${body.year - 1}–${String(body.year).slice(-2)}`, await companyNames(caller));
  let user = base;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await assertBudget(caller.companyId, null);
    } catch (err) {
      if (err instanceof DsError && err.code === "DS_AI_BUDGET_EXCEEDED") return null;
      throw err;
    }
    let c;
    try {
      c = await complete({ group: "drafting", system: SYSTEM, user, maxTokens: 1200, temperature: 0.3 });
    } catch (err) {
      if (err instanceof AiCallError) {
        await logCall({ companyId: caller.companyId, docId: null, userId: caller.userId, action: TEMPLATE_SUGGEST_LOG_ACTION, model: err.model, tokensIn: 0, tokensOut: 0, costUsd: 0, ok: false, errorCode: "DS_AI_UNAVAILABLE" });
        return null;
      }
      throw err;
    }
    const r = readPicks(c.text, cands, allowed);
    const ok = Array.isArray(r);
    await logCall({ companyId: caller.companyId, docId: null, userId: caller.userId, action: TEMPLATE_SUGGEST_LOG_ACTION, model: c.model, tokensIn: c.tokensIn, tokensOut: c.tokensOut, costUsd: c.costUsd, ok, errorCode: ok ? null : "DS_AI_OUTPUT_INVALID" });
    if (Array.isArray(r)) return { picks: r, model: c.model };
    user = `${base}\n\nYOUR LAST ANSWER COULDN'T BE USED:\n${r.issues.slice(0, 10).map((i) => `- ${i}`).join("\n")}\nAnswer again, fixing every point.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

const publicTemplate = (t: RuleTemplate): ReportTemplate => {
  const { frameworks: _f, ...rest } = t;
  return rest;
};

export async function suggestTemplates(caller: StudioCaller, raw: unknown): Promise<TemplateSuggestResponse> {
  const rawKind = (raw as { kind?: unknown } | null)?.kind;
  if (rawKind === "sustainability") assertKind(caller, rawKind);
  const body = parse(TemplateSuggestBodySchema, raw ?? {});
  assertKind(caller, body.kind);
  const issues = briefIssues(body.kind, body.brief);
  if (issues.length) throw dsValidationError(issues.map((i) => ({ path: i.path.split("."), message: i.message })));
  const { readable, all } = await readableSites(caller);
  const siteIds = checkSites(body.sites, readable, all);

  const listed = await listTemplates(caller, { kind: body.kind, ...(body.format ? { format: body.format } : {}) });
  const docs = new Map<number, Json>();
  if (listed.length) {
    const rows: Row[] = await AppDataSource.query(`SELECT id, doc FROM report_template WHERE id = ANY($1::int[]) AND (company_id IS NULL OR company_id = $2)`, [listed.map((t) => t.id), caller.companyId]);
    for (const r of rows) docs.set(Number(r.id), (r.doc ?? {}) as Json);
  }
  const templates: RuleTemplate[] = listed.map((t) => ({ ...t, frameworks: templateFrameworks(body.kind, docs.get(t.id) ?? null, t.tags) }));
  const enabled = await companyFrameworks(caller, body.kind);
  const { entries, considered } = ruleShortlist(templates, { kind: body.kind, brief: body.brief, format: body.format, enabledFrameworks: enabled });
  if (!entries.length) return { shortlist: [], aiUsed: false, model: null, considered };

  const facts = await loadFacts(caller, body, siteIds);
  const top = entries.slice(0, AI_CANDIDATES_MAX + 1);
  const cands: Candidate[] = [];
  const wanted = wantedFrameworks({ kind: body.kind, brief: body.brief, enabledFrameworks: enabled });
  for (const e of top) {
    const c = await candidateFor(caller, body, e, docs.get(e.template.id) ?? {}, facts);
    // KPI coverage badges name the frameworks the brief asks for, when it asks.
    if (wanted.length) c.readiness.badges = c.readiness.badges.filter((x) => x.key !== "kpi_coverage" || !x.framework || wanted.includes(x.framework));
    cands.push(c);
  }
  const ranked = rankCandidates(cands).slice(0, AI_CANDIDATES_MAX);
  const ai = await aiPicks(caller, body, ranked);

  const order: Array<{ c: Candidate; pick: TemplatePick | null }> = [];
  for (const p of ai?.picks ?? []) {
    const c = ranked.find((x) => x.template.id === p.templateId);
    if (c && order.length < TEMPLATE_SHORTLIST_MAX) order.push({ c, pick: p });
  }
  for (const c of ranked) {
    if (order.length >= TEMPLATE_SHORTLIST_MAX) break;
    if (!order.some((o) => o.c.template.id === c.template.id)) order.push({ c, pick: null });
  }
  const shortlist: TemplateSuggestion[] = order.map(({ c, pick }, i) => ({
    templateId: c.template.id,
    rank: i + 1,
    template: publicTemplate(c.template),
    readiness: c.readiness,
    reasons: pick?.reasons ?? [],
    pagesToDrop: pick?.pagesToDrop ?? [],
    pagesToAdd: pick?.pagesToAdd ?? [],
  }));
  return { shortlist, aiUsed: !!ai, model: ai?.model ?? null, considered };
}
