/**
 * DS-9 routes, mounted by src/studio/router.ts behind requireDesignStudio
 * (403 DS_STUDIO_OFF, then DS_ROLE for Users). Role R (Admin, Manager,
 * Superadmin) for all of them. Handlers that load a doc check the company
 * (404), the kind (DS_KIND_OFF) and the caller's sites (404) through DS-5's
 * loadDocRow. Nothing here writes to the doc.
 *
 *   POST /docs/:id/ai          {action, target?, params?}         → Suggestion
 *   POST /docs/:id/ai/chat     {messages: ChatTurn[], selection?} → {reply, suggestions}
 *   GET  /docs/:id/ai/usage                                       → AiUsage (budget meter)
 *   POST /ai/brief             {kind, brief}                      → {proposals, model} (design from a brief)
 *
 * Errors: DS_AI_UNAVAILABLE (503), DS_AI_BUDGET_EXCEEDED (429 {limit}),
 * DS_AI_OUTPUT_INVALID (502 {issues}), DS_VALIDATION for an action that isn't
 * built or a target that doesn't fit.
 */
import { Router } from "express";
import { AiRequestSchema, DsError, ReportDocSchema, dsDocInvalid, type ReportDoc } from "../contracts";
import { registerAiDraftHook } from "../docs/aiHook";
import { loadDocRow } from "../docs/store";
import { studioCaller, type StudioCaller, type StudioRequest } from "../guard";
import { handle, parse, routeId } from "../http";
import { designFromBrief } from "./brief";
import { usageResponse } from "./budget";
import { chat } from "./chat";
import { draftHook } from "./draft";
import { runAction } from "./runner";

// DS-5's build calls this when a design is created with `ai: true`.
registerAiDraftHook(draftHook);

const router = Router();
const caller = (req: unknown) => studioCaller(req as StudioRequest);
/** The body without `company_id` (a Superadmin names the company there; the guard has read it). */
const bodyOf = (req: { body?: unknown }): Record<string, unknown> => {
  const b = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? { ...(req.body as Record<string, unknown>) } : {};
  delete b.company_id;
  return b;
};

async function loadDoc(c: StudioCaller, idParam: unknown): Promise<{ id: number; doc: ReportDoc }> {
  const row = await loadDocRow(c, routeId(idParam));
  if (row.build?.state === "running") throw new DsError("DS_VERSION_CONFLICT", { rev: row.rev, building: true });
  const r = ReportDocSchema.safeParse(row.draft);
  if (!r.success) throw dsDocInvalid(r.error.issues);
  return { id: row.id, doc: r.data };
}

router.post(
  "/docs/:id/ai",
  handle("ai.action", async (req, res) => {
    const c = caller(req);
    const { id, doc } = await loadDoc(c, req.params.id);
    const body = parse(AiRequestSchema, bodyOf(req));
    res.json(await runAction({ caller: c, docId: id, doc, action: body.action, ...(body.target ? { target: body.target } : {}), ...(body.params ? { params: body.params } : {}) }));
  }),
);

router.post(
  "/docs/:id/ai/chat",
  handle("ai.chat", async (req, res) => {
    const c = caller(req);
    const { id, doc } = await loadDoc(c, req.params.id);
    res.json(await chat({ caller: c, docId: id, doc, body: bodyOf(req) }));
  }),
);

router.get(
  "/docs/:id/ai/usage",
  handle("ai.usage", async (req, res) => {
    const c = caller(req);
    const row = await loadDocRow(c, routeId(req.params.id));
    res.json(await usageResponse(c.companyId, row.id));
  }),
);

router.post(
  "/ai/brief",
  handle("ai.brief", async (req, res) => {
    res.json(await designFromBrief(caller(req), bodyOf(req)));
  }),
);

export default router;
