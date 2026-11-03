/**
 * AS-1 · one help question (docs/assistant/README.md).
 *
 *   POST /assistant/chat  {messages ≤ 12 (last is the person's), page?, form?, attachment?}
 *                         → {reply, answered, sources:[{id, title, path}], followups, call_id, used_work}
 *   GET  /assistant/status → {enabled, configured, files, work}  (any role; answers while off)
 *   POST /assistant/feedback {call_id, helpful} → {ok}
 *
 * Order: who is asking and for which client → switch (403 AS_OFF) → file switch
 * (403 AS_FILES_OFF) → key (503 AS_AI_UNAVAILABLE not_configured) → budget (429
 * AS_BUDGET) → the articles this role may read that fit the question → one
 * model call (one retry when the answer isn't the JSON asked for) → a log row
 * per call. The assistant reads no client data of its own: only the articles,
 * the page and form details the person's screen sends, and a file only when the
 * person attaches one. A file is sent to the model and never stored; the log
 * keeps its kind, not its name or contents. AS-2: a question about the person's
 * own work also gets a summary from their own screens (workload.ts), when their
 * client's data switch is on.
 */
import { z } from "zod";
import type { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../types/type";
import { resolveUserCompanyId } from "../utils/companyScope";
import { budgetVerdict, logCall, saveFeedback, usageFor, type CallRow } from "./budget";
import { assistantConfigured, AssistantCallError, complete } from "./client";
import { AsError, parse } from "./http";
import { AppDataSource } from "../config/data-source";
import { ASSISTANT_ROLES, canRead, loadKb, searchKb, type Article, type AssistantRole, type Kb } from "./kb";
import { buildPrompt, fence, parseReply, parseTranslation, PROMPT_VERSION, TRANSLATE_SYSTEM, UNREAD_REASONS, unknownFigures, type Translation, type Turn } from "./prompt";
import { currentAssistantDataSwitch, currentAssistantFilesSwitch, currentAssistantSwitch } from "./switch";
import { wantsWorkload, workloadFacts } from "./workload";

export const MAX_TURNS = 12;
export const MAX_QUESTION_CHARS = 2000;
export const MAX_ARTICLES = 4;
export const MAX_ANSWER_TOKENS = 900;
export const MAX_FILE_CHARS = 15_000;
export const MAX_FILE_IMAGES = 3;
/** About 1.8 MB of picture: three of them stay under the 10 MB request limit. */
export const MAX_FILE_IMAGE_CHARS = 2_400_000;
export const FILE_TYPES = ["image", "pdf", "spreadsheet", "csv", "word", "slides", "text", "other"] as const;

/** What the bytes say, so a label can't dress up something else as a picture. */
const looksLikeImage = (dataUrl: string): boolean => {
  const start = dataUrl.indexOf(",") + 1;
  const bytes = Buffer.from(dataUrl.slice(start, start + 24), "base64");
  if (dataUrl.startsWith("data:image/jpeg")) return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (dataUrl.startsWith("data:image/png")) return bytes.subarray(0, 4).toString("hex") === "89504e47";
  return bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
};

const AttachmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(FILE_TYPES),
  text: z.string().max(MAX_FILE_CHARS).optional(),
  images: z
    .array(
      z
        .string()
        .max(MAX_FILE_IMAGE_CHARS)
        .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
        .refine(looksLikeImage, "Not a picture"),
    )
    .max(MAX_FILE_IMAGES)
    .optional(),
  truncated: z.boolean().optional(),
  shrunk: z.boolean().optional(),
  unread: z.enum(UNREAD_REASONS).optional(),
});

const TurnSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) });

export const ChatRequestSchema = z.object({
  messages: z
    .array(TurnSchema)
    .min(1)
    .max(MAX_TURNS)
    .refine((m) => m.length > 0 && m[m.length - 1].role === "user", "The last message must be the person's question")
    .refine((m) => m.length > 0 && m[m.length - 1].content.length <= MAX_QUESTION_CHARS, `A question can be at most ${MAX_QUESTION_CHARS} characters`),
  page: z.object({ path: z.string().regex(/^\//).max(200), title: z.string().max(120).optional() }).nullish(),
  form: z
    .object({
      site: z.string().max(120).optional(),
      category: z.string().max(120).optional(),
      fields: z
        .array(z.object({ label: z.string().max(80), help: z.string().max(300).optional(), options: z.array(z.string().max(80)).max(40).optional() }))
        .max(30)
        .optional(),
    })
    .nullish(),
  attachment: AttachmentSchema.nullish(),
});

const FeedbackSchema = z.object({ call_id: z.number().int().positive(), helpful: z.boolean() });

export interface ChatReply {
  reply: string;
  answered: boolean;
  sources: Array<{ id: string; title: string; path: string | null }>;
  /** Questions the person might ask next. */
  followups: string[];
  /** For a thumb up or down on this answer. */
  call_id: number;
  /** True when the answer used a summary of the person's own work. */
  used_work: boolean;
}

interface Caller {
  userId: number;
  role: AssistantRole;
  /** Null for a Superadmin: the switch and the client budget don't apply. */
  companyId: number | null;
}

const isRole = (r: unknown): r is AssistantRole => (ASSISTANT_ROLES as readonly string[]).includes(String(r));

async function callerOf(req: AuthRequest): Promise<{ caller: Caller | null; enabled: boolean }> {
  const userId = Number(req.user?.userId);
  const role = req.user?.role;
  if (!userId || !isRole(role)) return { caller: null, enabled: false };
  if (role === UserRole.SUPERADMIN) return { caller: { userId, role, companyId: null }, enabled: true };
  const companyId = await resolveUserCompanyId(userId);
  if (!companyId) return { caller: null, enabled: false };
  return { caller: { userId, role, companyId }, enabled: (await currentAssistantSwitch(companyId)) === true };
}

/** A Superadmin has no client switch to wait for. */
const filesOn = async (caller: Caller): Promise<boolean> => caller.companyId === null || (await currentAssistantFilesSwitch(caller.companyId)) === true;

const workOn = async (caller: Caller): Promise<boolean> => caller.companyId === null || (await currentAssistantDataSwitch(caller.companyId)) === true;

export async function assistantStatus(req: AuthRequest): Promise<{ enabled: boolean; configured: boolean; files: boolean; work: boolean }> {
  const { caller, enabled } = await callerOf(req);
  const on = !!caller && enabled;
  return { enabled, configured: assistantConfigured(), files: on && (await filesOn(caller)), work: on && (await workOn(caller)) };
}

/** The text a question is searched with: the question and the person's message before it (follow-ups). */
export const searchText = (messages: Turn[]): string =>
  messages
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.content)
    .join("\n");

/** Said instead of an answer whose figures can't be trusted: a file's question still gets a reply. */
const PICTURE_TOO_BIG = "That picture is very large, so its small print comes out too blurred for me to read reliably, and I won't guess at it. Please crop it to the part you need, or send a PDF.";
const NO_SUMS_FROM_FILES = "I can't work that out from the file: I only read what it says, and I don't count or calculate. Open the file to check that figure yourself.";

const OWN_WORDS = /\b(my|our|me|us|i|we)\b/i;

/** "And the due date?" leans on the question before it. */
const FOLLOW_UP = /^\s*(and|also|what about|how about|same for|which (one|ones)|why|when|those|these|that|them)\b/i;

/** What decides whether the work summary goes out: this question, and the one before only for a follow-up, so nothing goes with an unrelated question. */
export const workText = (messages: Turn[]): string => {
  const asked = messages.filter((m) => m.role === "user").map((m) => m.content);
  const last = asked[asked.length - 1] ?? "";
  return FOLLOW_UP.test(last) && last.length <= 80 ? asked.slice(-2).join("\n") : last;
};

const CLIENT_FEATURES: Array<[string, string]> = [
  ["kpi_tracking_enabled", "KPI tracking"],
  ["design_studio_enabled", "Design Studio"],
  ["insights_enabled", "Insights"],
  ["ai_import_enabled", "Smart Excel import"],
];

/** So an answer doesn't walk someone through a screen their company doesn't have. A Superadmin has no client. */
async function clientFeatures(companyId: number | null): Promise<string | null> {
  if (companyId === null) return null;
  const [row] = (await AppDataSource.query(`SELECT ${CLIENT_FEATURES.map(([column]) => column).join(", ")} FROM company WHERE company_id = $1`, [companyId])) as Array<Record<string, boolean>>;
  return row ? CLIENT_FEATURES.map(([column, name]) => `${name}: ${row[column] ? "on" : "off"}`).join("\n") : null;
}

/** Letters outside the Latin script (Hindi, Arabic...). The articles are English, so word search finds nothing. */
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;

/** The articles a file's questions lean on ("where do I upload this?"), whatever the words matched. */
const FILE_ARTICLES = ["add-data-from-bill", "bulk-upload", "smart-excel-import", "evidence-documents"];

const fileArticles = (kb: Kb, role: AssistantRole, found: Article[]): Article[] =>
  FILE_ARTICLES.flatMap((id) => {
    const a = kb.byId.get(id);
    return a && canRead(a, role) && !found.includes(a) ? [a] : [];
  });

export async function rememberFeedback(req: AuthRequest): Promise<{ ok: true }> {
  const body = parse(FeedbackSchema, req.body);
  if (!(await saveFeedback(body.call_id, Number(req.user?.userId), body.helpful))) throw new AsError("AS_VALIDATION");
  return { ok: true };
}

export async function answerQuestion(req: AuthRequest): Promise<ChatReply> {
  const body = parse(ChatRequestSchema, req.body);
  const { caller, enabled } = await callerOf(req);
  if (!caller || !enabled) throw new AsError("AS_OFF");
  const attachment = body.attachment ?? null;
  if (attachment && !(await filesOn(caller))) throw new AsError("AS_FILES_OFF");
  if (!assistantConfigured()) throw new AsError("AS_AI_UNAVAILABLE", { reason: "not_configured" });
  const limit = budgetVerdict(await usageFor(caller.userId, caller.companyId));
  if (limit) throw new AsError("AS_BUDGET", { limit });

  const messages: Turn[] = body.messages;
  const question = messages[messages.length - 1].content;
  const pagePath = body.page?.path.split(/[?#]/)[0] ?? null;
  const kb = loadKb();
  const search = (text: string) => searchKb(kb, text, { role: caller.role, path: pagePath }, MAX_ARTICLES).map((h) => h.article);
  const wording = attachment ? `${searchText(messages)}\n${attachment.name}\n${(attachment.text ?? "").slice(0, 300)}` : searchText(messages);
  let found = search(wording);

  const row = (extra: Partial<CallRow> & Pick<CallRow, "model" | "ok">): CallRow => ({
    companyId: caller.companyId,
    userId: caller.userId,
    role: caller.role,
    pagePath,
    articleIds: found.map((a) => a.id),
    sources: [],
    answered: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    errorCode: null,
    promptVersion: PROMPT_VERSION,
    fileType: attachment?.type ?? null,
    ...extra,
  });

  // The articles are English: a question in Hindi needs its meaning before the word search can
  // find anything, or before it can be told apart from a how-to. Words from an earlier message
  // can find articles for it, so with the work summary on that isn't enough to skip this.
  const workAllowed = await workOn(caller);
  let translated: Translation | null = null;
  if (NON_LATIN_LETTER.test(question) && (!found.length || workAllowed)) {
    try {
      const c = await complete({ system: TRANSLATE_SYSTEM, user: fence("question", question), maxTokens: 120 });
      await logCall(row({ model: c.model, ok: true, tokensIn: c.tokensIn, tokensOut: c.tokensOut, costUsd: c.costUsd, purpose: "translate" }));
      translated = parseTranslation(c.text);
      const hits = translated ? search(translated.english) : [];
      if (hits.length) found = hits;
    } catch (err) {
      // No search words is no worse than before: the answer says it doesn't know.
      if (err instanceof AssistantCallError) await logCall(row({ model: err.model, ok: false, errorCode: err.reason, purpose: "translate" }));
      else throw err;
    }
  }

  const articles = attachment ? [...found, ...fileArticles(kb, caller.role, found)] : found;
  const offered = articles.map((a) => a.id);

  // AS-2: only a question about their own work sends any of it, and a failure here costs only the summary.
  let work: string | null = null;
  // With a file, "how many litres is this?" is about the file: the summary needs them to say it's theirs.
  const mine = !attachment || OWN_WORDS.test(question);
  if (workAllowed && mine && (translated?.ownWork || wantsWorkload(`${workText(messages)}\n${translated?.english ?? ""}`))) {
    try {
      work = await workloadFacts(caller);
    } catch (err) {
      console.error(`[assistant] work summary failed (user ${caller.userId}):`, (err as Error)?.message);
    }
  }

  const prompt = buildPrompt({
    role: caller.role,
    articles,
    history: messages.slice(0, -1).slice(-(MAX_TURNS - 1)),
    question,
    page: body.page ? { path: pagePath as string, title: body.page.title } : null,
    form: body.form ?? null,
    attachment,
    work,
    workOn: workAllowed,
    features: await clientFeatures(caller.companyId),
  });

  let retryNote = "Your last reply wasn't the JSON object asked for. Reply with that JSON object only.";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const user = attempt === 1 ? prompt.user : `${prompt.user}\n\n${retryNote}`;
    let completion;
    try {
      completion = await complete({ system: prompt.system, user, images: prompt.images, maxTokens: MAX_ANSWER_TOKENS });
    } catch (err) {
      if (err instanceof AssistantCallError) await logCall(row({ model: err.model, ok: false, errorCode: err.reason, articleIds: offered }));
      throw err;
    }
    const spent = { model: completion.model, tokensIn: completion.tokensIn, tokensOut: completion.tokensOut, costUsd: completion.costUsd, workUsed: !!work };
    let reply;
    try {
      reply = parseReply(completion.text, offered);
    } catch {
      await logCall(row({ ...spent, ok: false, errorCode: "invalid_output", articleIds: offered }));
      if (attempt === 2) throw new AsError("AS_AI_UNAVAILABLE", { reason: "invalid_output" });
      continue;
    }
    // A1: every figure must come from somewhere. A misread, made-up or worked-out one is never shown.
    // A picture has no text to check against, but one shrunk this far is unreadable, so no figure from it stands.
    const readable = prompt.images.length ? "" : (attachment?.text ?? "");
    if ((attachment?.shrunk || (!prompt.images.length && (attachment?.text || work))) && unknownFigures(reply.answer, [readable, work ?? "", ...messages.map((m) => m.content), ...articles.map((a) => a.body)]).length) {
      const refused = await logCall(row({ ...spent, ok: false, errorCode: "unknown_figures", articleIds: offered }));
      if (attempt === 2) {
        if (!attachment) throw new AsError("AS_AI_UNAVAILABLE", { reason: "unknown_figures" });
        return { reply: attachment.shrunk ? PICTURE_TOO_BIG : NO_SUMS_FROM_FILES, answered: false, followups: [], call_id: refused, used_work: !!work, sources: [] };
      }
      retryNote = attachment?.shrunk
        ? "That picture is too large to read reliably. Reply again without quoting any figure or reference from it."
        : "Your last reply had figures you weren't given. Reply again, copying every figure exactly as written, and don't work out any of your own.";
      continue;
    }
    const callId = await logCall(row({ ...spent, ok: true, sources: reply.sources, answered: reply.answered, articleIds: offered }));
    return {
      reply: reply.answer,
      answered: reply.answered,
      followups: reply.followups,
      call_id: callId,
      used_work: !!work,
      sources: reply.sources.map((id) => {
        const a = kb.byId.get(id)!;
        return { id, title: a.title, path: a.paths[0] ?? null };
      }),
    };
  }
  throw new AsError("AS_AI_UNAVAILABLE", { reason: "invalid_output" });
}
