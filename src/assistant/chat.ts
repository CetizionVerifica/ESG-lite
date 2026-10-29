/**
 * AS-1 · one help question (docs/assistant/README.md).
 *
 *   POST /assistant/chat  {messages ≤ 12 (last is the person's), page?, form?}
 *                         → {reply, answered, sources:[{id, title, path}]}
 *   GET  /assistant/status → {enabled, configured}  (any role; answers while off)
 *
 * Order: who is asking and for which client → switch (403 AS_OFF) → key
 * (503 AS_AI_UNAVAILABLE not_configured) → budget (429 AS_BUDGET) → the
 * articles this role may read that fit the question → one model call (one
 * retry when the answer isn't the JSON asked for) → a log row per call.
 * The assistant reads no client data in AS-1: only the articles, and the page
 * and form details the person's screen sends.
 */
import { z } from "zod";
import type { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../types/type";
import { resolveUserCompanyId } from "../utils/companyScope";
import { budgetVerdict, logCall, usageFor, type CallRow } from "./budget";
import { assistantConfigured, AssistantCallError, complete } from "./client";
import { AsError, parse } from "./http";
import { ASSISTANT_ROLES, loadKb, searchKb, type AssistantRole } from "./kb";
import { buildPrompt, parseReply, PROMPT_VERSION, type Turn } from "./prompt";
import { currentAssistantSwitch } from "./switch";

export const MAX_TURNS = 12;
export const MAX_QUESTION_CHARS = 2000;
export const MAX_ARTICLES = 4;
export const MAX_ANSWER_TOKENS = 900;

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
});

export interface ChatReply {
  reply: string;
  answered: boolean;
  sources: Array<{ id: string; title: string; path: string | null }>;
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

export async function assistantStatus(req: AuthRequest): Promise<{ enabled: boolean; configured: boolean }> {
  const { enabled } = await callerOf(req);
  return { enabled, configured: assistantConfigured() };
}

/** The text a question is searched with: the question and the person's message before it (follow-ups). */
export const searchText = (messages: Turn[]): string =>
  messages
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.content)
    .join("\n");

export async function answerQuestion(req: AuthRequest): Promise<ChatReply> {
  const body = parse(ChatRequestSchema, req.body);
  const { caller, enabled } = await callerOf(req);
  if (!caller || !enabled) throw new AsError("AS_OFF");
  if (!assistantConfigured()) throw new AsError("AS_AI_UNAVAILABLE", { reason: "not_configured" });
  const limit = budgetVerdict(await usageFor(caller.userId, caller.companyId));
  if (limit) throw new AsError("AS_BUDGET", { limit });

  const messages: Turn[] = body.messages;
  const question = messages[messages.length - 1].content;
  const pagePath = body.page?.path.split(/[?#]/)[0] ?? null;
  const kb = loadKb();
  const articles = searchKb(kb, searchText(messages), { role: caller.role, path: pagePath }, MAX_ARTICLES).map((h) => h.article);
  const offered = articles.map((a) => a.id);
  const prompt = buildPrompt({
    role: caller.role,
    articles,
    history: messages.slice(0, -1).slice(-(MAX_TURNS - 1)),
    question,
    page: body.page ? { path: pagePath as string, title: body.page.title } : null,
    form: body.form ?? null,
  });

  const row = (extra: Partial<CallRow> & Pick<CallRow, "model" | "ok">): CallRow => ({
    companyId: caller.companyId,
    userId: caller.userId,
    role: caller.role,
    pagePath,
    articleIds: offered,
    sources: [],
    answered: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    errorCode: null,
    promptVersion: PROMPT_VERSION,
    ...extra,
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    const user = attempt === 1 ? prompt.user : `${prompt.user}\n\nYour last reply wasn't the JSON object asked for. Reply with that JSON object only.`;
    let completion;
    try {
      completion = await complete({ system: prompt.system, user, maxTokens: MAX_ANSWER_TOKENS });
    } catch (err) {
      if (err instanceof AssistantCallError) await logCall(row({ model: err.model, ok: false, errorCode: err.reason }));
      throw err;
    }
    const spent = { model: completion.model, tokensIn: completion.tokensIn, tokensOut: completion.tokensOut, costUsd: completion.costUsd };
    let reply;
    try {
      reply = parseReply(completion.text, offered);
    } catch {
      await logCall(row({ ...spent, ok: false, errorCode: "invalid_output" }));
      if (attempt === 2) throw new AsError("AS_AI_UNAVAILABLE", { reason: "invalid_output" });
      continue;
    }
    await logCall(row({ ...spent, ok: true, sources: reply.sources, answered: reply.answered }));
    return {
      reply: reply.answer,
      answered: reply.answered,
      sources: reply.sources.map((id) => {
        const a = kb.byId.get(id)!;
        return { id, title: a.title, path: a.paths[0] ?? null };
      }),
    };
  }
  throw new AsError("AS_AI_UNAVAILABLE", { reason: "invalid_output" });
}
