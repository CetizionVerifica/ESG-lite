/**
 * AS-1 · one help question (docs/assistant/README.md).
 *
 *   POST /assistant/chat  {messages ≤ 12 (last is the person's), page?, form?, attachment?}
 *                         → {reply, answered, sources:[{id, title, path}], followups, call_id}
 *   GET  /assistant/status → {enabled, configured, files}  (any role; answers while off)
 *   POST /assistant/feedback {call_id, helpful} → {ok}
 *
 * Order: who is asking and for which client → switch (403 AS_OFF) → file switch
 * (403 AS_FILES_OFF) → key (503 AS_AI_UNAVAILABLE not_configured) → budget (429
 * AS_BUDGET) → the articles this role may read that fit the question → one
 * model call (one retry when the answer isn't the JSON asked for) → a log row
 * per call. The assistant reads no client data of its own: only the articles,
 * the page and form details the person's screen sends, and a file only when the
 * person attaches one. A file is sent to the model and never stored; the log
 * keeps its kind, not its name or contents.
 */
import { z } from "zod";
import type { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../types/type";
import { resolveUserCompanyId } from "../utils/companyScope";
import { budgetVerdict, logCall, saveFeedback, usageFor, type CallRow } from "./budget";
import { assistantConfigured, AssistantCallError, complete } from "./client";
import { AsError, parse } from "./http";
import { ASSISTANT_ROLES, loadKb, searchKb, type Article, type AssistantRole, type Kb } from "./kb";
import { buildPrompt, fence, parseReply, parseTranslation, PROMPT_VERSION, TRANSLATE_SYSTEM, unknownFigures, type Turn } from "./prompt";
import { currentAssistantFilesSwitch, currentAssistantSwitch } from "./switch";

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

export async function assistantStatus(req: AuthRequest): Promise<{ enabled: boolean; configured: boolean; files: boolean }> {
  const { caller, enabled } = await callerOf(req);
  return { enabled, configured: assistantConfigured(), files: !!caller && enabled && (await filesOn(caller)) };
}

/** The text a question is searched with: the question and the person's message before it (follow-ups). */
export const searchText = (messages: Turn[]): string =>
  messages
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.content)
    .join("\n");

/** Letters outside the Latin script (Hindi, Arabic...). The articles are English, so word search finds nothing. */
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;

/** The articles a file's questions lean on ("where do I upload this?"), whatever the words matched. */
const FILE_ARTICLES = ["add-data-from-bill", "bulk-upload", "smart-excel-import", "evidence-documents"];

const fileArticles = (kb: Kb, role: AssistantRole, found: Article[]): Article[] =>
  FILE_ARTICLES.flatMap((id) => {
    const a = kb.byId.get(id);
    return a && a.roles.includes(role) && !found.includes(a) ? [a] : [];
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

  // The articles are English: a question in Hindi needs its meaning before the word search can find anything.
  if (!found.length && NON_LATIN_LETTER.test(question)) {
    try {
      const c = await complete({ system: TRANSLATE_SYSTEM, user: fence("question", question), maxTokens: 120 });
      await logCall(row({ model: c.model, ok: true, tokensIn: c.tokensIn, tokensOut: c.tokensOut, costUsd: c.costUsd, purpose: "translate" }));
      const english = parseTranslation(c.text);
      if (english) found = search(english);
    } catch (err) {
      // No search words is no worse than before: the answer says it doesn't know.
      if (err instanceof AssistantCallError) await logCall(row({ model: err.model, ok: false, errorCode: err.reason, purpose: "translate" }));
      else throw err;
    }
  }

  const articles = attachment ? [...found, ...fileArticles(kb, caller.role, found)] : found;
  const offered = articles.map((a) => a.id);
  const prompt = buildPrompt({
    role: caller.role,
    articles,
    history: messages.slice(0, -1).slice(-(MAX_TURNS - 1)),
    question,
    page: body.page ? { path: pagePath as string, title: body.page.title } : null,
    form: body.form ?? null,
    attachment,
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
    const spent = { model: completion.model, tokensIn: completion.tokensIn, tokensOut: completion.tokensOut, costUsd: completion.costUsd };
    let reply;
    try {
      reply = parseReply(completion.text, offered);
    } catch {
      await logCall(row({ ...spent, ok: false, errorCode: "invalid_output", articleIds: offered }));
      if (attempt === 2) throw new AsError("AS_AI_UNAVAILABLE", { reason: "invalid_output" });
      continue;
    }
    // A1: with a text file, every figure must come from somewhere. A misread, made-up or worked-out one is never shown.
    if (attachment?.text && unknownFigures(reply.answer, [attachment.text, ...messages.map((m) => m.content), ...articles.map((a) => a.body)]).length) {
      await logCall(row({ ...spent, ok: false, errorCode: "unknown_figures", articleIds: offered }));
      if (attempt === 2) throw new AsError("AS_AI_UNAVAILABLE", { reason: "unknown_figures" });
      retryNote = "Your last reply had figures that aren't in the file. Reply again, copying every figure exactly as the file writes it, and don't work out any of your own.";
      continue;
    }
    const callId = await logCall(row({ ...spent, ok: true, sources: reply.sources, answered: reply.answered, articleIds: offered }));
    return {
      reply: reply.answer,
      answered: reply.answered,
      followups: reply.followups,
      call_id: callId,
      sources: reply.sources.map((id) => {
        const a = kb.byId.get(id)!;
        return { id, title: a.title, path: a.paths[0] ?? null };
      }),
    };
  }
  throw new AsError("AS_AI_UNAVAILABLE", { reason: "invalid_output" });
}
