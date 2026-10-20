/**
 * DS-9 · design from a brief (POST /studio/ai/brief, 05-ux S4): "A 12-page GHG
 * summary for our board, dark look, focus on Scope 3 suppliers" → 2–3
 * proposals `{templateId, look, chapters, styleId, title, reason}` from the
 * company's template library and styles. Accept is the FE calling DS-5's
 * POST /docs with the proposal's template (the build runs as usual).
 *
 * The model gets the brief (fenced, untrusted), the templates of the kind
 * (name, format, purpose, look, description, page names) and the style ids;
 * it gets no figures, so the number guard doesn't apply. The server keeps only
 * proposals whose template and style exist for the company; chapters are kept
 * only when they name pages of that template. Budget: the company's month
 * (there is no doc yet); logged with doc_id null.
 */
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import { BriefRequestSchema, DsError, type BriefProposal, type BriefReply, type ReportTemplate, type StylePreset } from "../contracts";
import { listStyles } from "../brandkit/service";
import { assertKind, type StudioCaller } from "../guard";
import { parse } from "../http";
import { listTemplates } from "../library/service";
import { assertBudget, logCall } from "./budget";
import { AiCallError, complete, parseJsonObject } from "./client";
import { brandVoice } from "./context";
import { fence, SAFETY_RULES } from "./prompts/common";

type Row = Record<string, any>;

const ProposalsOut = z
  .object({
    proposals: z
      .array(
        z
          .object({
            templateId: z.coerce.number().int(),
            styleId: z.string().max(120).nullable().optional(),
            title: z.string().trim().min(1).max(200),
            chapters: z.array(z.string().max(200)).max(60).default([]),
            reason: z.string().trim().min(1).max(600),
          })
          .passthrough(),
      )
      .min(1)
      .max(5),
  })
  .passthrough();

export interface BriefCatalog {
  templates: Array<ReportTemplate & { chapters: string[] }>;
  styles: Pick<StylePreset, "id" | "name">[];
}

/** The model's answer → checked proposals (at most 3), or the issues. */
export function readProposals(answer: string, cat: BriefCatalog): BriefProposal[] | { issues: string[] } {
  let json: unknown;
  try {
    json = parseJsonObject(answer);
  } catch {
    return { issues: ["The answer wasn't one JSON object"] };
  }
  const r = ProposalsOut.safeParse(json);
  if (!r.success) return { issues: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const issues: string[] = [];
  const out: BriefProposal[] = [];
  const seen = new Set<number>();
  for (const p of r.data.proposals) {
    const t = cat.templates.find((x) => x.id === p.templateId);
    if (!t) {
      issues.push(`templateId ${p.templateId} isn't in TEMPLATES`);
      continue;
    }
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const byName = new Map(t.chapters.map((c) => [c.toLowerCase(), c]));
    const chapters = p.chapters.map((c) => byName.get(c.trim().toLowerCase())).filter((c): c is string => !!c);
    const style = p.styleId ? cat.styles.find((s) => s.id === p.styleId) : undefined;
    out.push({
      templateId: t.id,
      look: t.look,
      templateName: t.name,
      format: t.format,
      purpose: t.purpose,
      chapters: chapters.length ? chapters : t.chapters,
      styleId: style ? style.id : null,
      title: p.title.replace(/<[^>]*>/g, "").slice(0, 200),
      reason: p.reason.replace(/<[^>]*>/g, "").slice(0, 600),
    });
    if (out.length === 3) break;
  }
  return out.length ? out : { issues: issues.length ? issues : ["No usable proposal"] };
}

async function catalog(caller: StudioCaller, kind: "ghg" | "sustainability"): Promise<BriefCatalog> {
  const templates = await listTemplates(caller, { kind });
  const ids = templates.map((t) => t.id);
  const rows: Row[] = ids.length ? await AppDataSource.query(`SELECT id, jsonb_path_query_array(doc, '$.pages[*].name') AS chapters FROM report_template WHERE id = ANY($1::int[])`, [ids]) : [];
  const chapters = new Map(rows.map((r) => [Number(r.id), (Array.isArray(r.chapters) ? r.chapters : []).map(String).filter(Boolean)]));
  const styles = (await listStyles(caller, { kind }).catch(() => [] as StylePreset[])).map((s) => ({ id: s.id, name: s.name }));
  return { templates: templates.map((t) => ({ ...t, chapters: chapters.get(t.id) ?? [] })), styles };
}

const SYSTEM = [
  "You are the design assistant of ESGLite's Design Studio. From a short brief, you propose report designs from the company's own template library.",
  "",
  "RULES",
  "1. Propose 2 or 3 different designs. Use only template ids from TEMPLATES and style ids from STYLES (or null).",
  "2. Pick the format and look the brief asks for (a board deck is a 16:9 template; dark means the night look; a one-page summary is the one-page template).",
  "3. chapters: the page names from that template to keep, in order, matching the brief's focus.",
  "4. title: a working title for the design; reason: one sentence on why it fits the brief.",
  ...SAFETY_RULES.map((r, i) => `${i + 5}. ${r}`),
  "",
  'Answer with ONE JSON object and nothing else: {"proposals": [{"templateId": 12, "styleId": "brand-classic", "title": "…", "chapters": ["Cover", "…"], "reason": "…"}]}',
].join("\n");

export async function designFromBrief(caller: StudioCaller, body: unknown): Promise<BriefReply> {
  const rawKind = (body as { kind?: unknown } | null)?.kind;
  if (rawKind === "sustainability") assertKind(caller, rawKind);
  const req = parse(BriefRequestSchema, body ?? {});
  assertKind(caller, req.kind);
  const cat = await catalog(caller, req.kind);
  if (!cat.templates.length) throw new DsError("DS_LAYOUT_NOT_FOUND", { reason: "No templates for this kind" });
  const [company]: Row[] = await AppDataSource.query(`SELECT name, industry FROM company WHERE company_id = $1`, [caller.companyId]);
  const base = [
    `COMPANY: ${company?.name ?? "the company"}${company?.industry ? ` (${company.industry})` : ""}`,
    `KIND: ${req.kind === "ghg" ? "GHG inventory report" : "sustainability report"}`,
    "",
    "TEMPLATES",
    ...cat.templates.map((t) => `- id ${t.id}: ${t.name} · ${t.format} · ${t.purpose} · look ${t.look ?? "company"} · ${t.pageCount} pages · ${t.description}\n  pages: ${t.chapters.join(" | ")}`),
    "",
    "STYLES",
    ...(cat.styles.length ? cat.styles.map((s) => `- ${s.id}: ${s.name}`) : ["- none"]),
    "",
    "BRAND VOICE (for the titles)",
    fence("brand_voice", await brandVoice(caller.companyId)),
    "",
    "BRIEF",
    fence("brief", req.brief),
  ].join("\n");
  let user = base;
  let issues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    await assertBudget(caller.companyId, null);
    let c;
    try {
      c = await complete({ group: "drafting", system: SYSTEM, user, maxTokens: 1500 });
    } catch (err) {
      if (err instanceof AiCallError) await logCall({ companyId: caller.companyId, docId: null, userId: caller.userId, action: "design_from_brief", model: err.model, tokensIn: 0, tokensOut: 0, costUsd: 0, ok: false, errorCode: "DS_AI_UNAVAILABLE" });
      throw err;
    }
    const r = readProposals(c.text, cat);
    const ok = Array.isArray(r);
    await logCall({ companyId: caller.companyId, docId: null, userId: caller.userId, action: "design_from_brief", model: c.model, tokensIn: c.tokensIn, tokensOut: c.tokensOut, costUsd: c.costUsd, ok, errorCode: ok ? null : "DS_AI_OUTPUT_INVALID" });
    if (Array.isArray(r)) return { proposals: r, model: c.model };
    issues = r.issues;
    user = `${base}\n\nYOUR LAST ANSWER COULDN'T BE USED:\n${issues.slice(0, 10).map((i) => `- ${i}`).join("\n")}\nAnswer again, fixing every point.`;
  }
  throw new DsError("DS_AI_OUTPUT_INVALID", { issues: issues.slice(0, 12) });
}
