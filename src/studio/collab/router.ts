/**
 * DS-13 routes, mounted by src/studio/router.ts behind requireDesignStudio
 * (403 DS_STUDIO_OFF, then DS_ROLE for Users). Role R unless noted. Every
 * handler loads the design first (another company's id → 404, a
 * sustainability design with KPI tracking off → DS_KIND_OFF, sites the caller
 * can't read → 404).
 *
 *   GET    /docs/:id/people                 StudioPerson[] (mention, assign, reviewer pickers)
 *   GET    /docs/:id/comments               ReportComment[] (?resolved=1, ?tasks=mine|open)
 *   POST   /docs/:id/comments               → 201 ReportComment (mentions and tasks notify)
 *   PATCH  /comments/:id                    {body?} author · {resolved}
 *   DELETE /comments/:id                    author or Manager → 204
 *   POST   /comments/:id/task               {assigneeId|null}
 *   PATCH  /comments/:id/task               {done}
 *   GET    /docs/:id/approvals              ApprovalsResponse
 *   POST   /docs/:id/approvals              {reviewerId, dueAt?, note?, rev} → 201
 *   POST   /approvals/:id/decide            the reviewer (M) {decision, note?}
 *   DELETE /approvals/:id                   the requester → 204
 *   GET    /docs/:id/drift                  DriftResponse
 *   GET    /docs/:id/versions/:n/preview.html   a version, read-only (sandboxed HTML)
 *   GET    /review-settings · PUT           ReviewSettings (requireReview: M; brandControls: Superadmin)
 *   POST   /templates/from-doc              → 201 ReportTemplate
 *   POST   /layouts/from-page               → 201 ReportLayout
 *   DELETE /templates/:id                   archive a company template → 204
 *
 * Loading this module also: wraps the final gate with the approval rule (approvals.ts), adds
 * the DATA_CHANGED / OPEN_TASK checks (checks provider) and the template-lock rule on PATCH.
 */
import { Router } from "express";
import { finalGate, registerFinalGate } from "../jobs/gate";
import { registerCheckProvider } from "../checks/service";
import { registerBuiltHook, registerPatchGuard } from "../docs/service";
import { requireManager, studioCaller, type StudioCaller, type StudioRequest } from "../guard";
import { handle, routeId } from "../http";
import type { ReportDoc } from "../contracts";
import { AppDataSource } from "../../config/data-source";
import { approvalFinalGate, decideApproval, listApprovals, requestApproval, withdrawApproval } from "./approvals";
import { assignTask, createComment, deleteComment, listComments, openTasks, patchComment, people, setTaskDone } from "./comments";
import { collabChecks, computeDrift, getDrift, recordBuiltBaseline } from "./drift";
import { assertTemplateLocks } from "./locks";
import { getReviewSettings, putReviewSettings } from "./settings";
import { archiveTemplate, layoutFromPage, templateFromDoc } from "./templates";
import { versionPreviewHtml } from "./versionPreview";
import { PREVIEW_CSP } from "../jobs/preview";

registerFinalGate(approvalFinalGate(finalGate()));
registerPatchGuard(assertTemplateLocks);
registerBuiltHook(recordBuiltBaseline); // [Wave 5 integrate]
registerCheckProvider(async (caller: StudioCaller, docId: number, doc: ReportDoc) => {
  const [r]: Array<{ data_hash: string | null }> = await AppDataSource.query(`SELECT data_hash FROM report_doc WHERE id = $1`, [docId]);
  const drift = await computeDrift(caller, docId, doc, r?.data_hash ?? null);
  return collabChecks(drift.changed, await openTasks(docId), new Set(doc.pages.map((p) => p.id)));
});

const router = Router();
const caller = (req: unknown) => studioCaller(req as StudioRequest);

router.get("/docs/:id/people", handle("collab.people", async (req, res) => void res.json(await people(caller(req), routeId(req.params.id)))));
router.get("/docs/:id/comments", handle("collab.comments", async (req, res) => void res.json(await listComments(caller(req), routeId(req.params.id), req.query))));
router.post("/docs/:id/comments", handle("collab.comment", async (req, res) => void res.status(201).json(await createComment(caller(req), routeId(req.params.id), req.body))));
router.patch("/comments/:id", handle("collab.comment.patch", async (req, res) => void res.json(await patchComment(caller(req), routeId(req.params.id), req.body))));
router.delete(
  "/comments/:id",
  handle("collab.comment.delete", async (req, res) => {
    await deleteComment(caller(req), routeId(req.params.id));
    res.status(204).end();
  }),
);
router.post("/comments/:id/task", handle("collab.task", async (req, res) => void res.json(await assignTask(caller(req), routeId(req.params.id), req.body))));
router.patch("/comments/:id/task", handle("collab.task.done", async (req, res) => void res.json(await setTaskDone(caller(req), routeId(req.params.id), req.body))));

router.get("/docs/:id/approvals", handle("collab.approvals", async (req, res) => void res.json(await listApprovals(caller(req), routeId(req.params.id)))));
router.post("/docs/:id/approvals", handle("collab.approval", async (req, res) => void res.status(201).json(await requestApproval(caller(req), routeId(req.params.id), req.body))));
router.post("/approvals/:id/decide", requireManager, handle("collab.approval.decide", async (req, res) => void res.json(await decideApproval(caller(req), routeId(req.params.id), req.body))));
router.delete(
  "/approvals/:id",
  handle("collab.approval.withdraw", async (req, res) => {
    await withdrawApproval(caller(req), routeId(req.params.id));
    res.status(204).end();
  }),
);

router.get("/docs/:id/drift", handle("collab.drift", async (req, res) => void res.json(await getDrift(caller(req), routeId(req.params.id)))));

router.get(
  "/docs/:id/versions/:n/preview.html",
  handle("collab.version.preview", async (req, res) => {
    const { html, n } = await versionPreviewHtml(caller(req), routeId(req.params.id), routeId(req.params.n), req.query);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", PREVIEW_CSP);
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Doc-Version", String(n));
    res.send(html);
  }),
);

router.get("/review-settings", handle("collab.settings", async (req, res) => void res.json(await getReviewSettings(caller(req)))));
router.put("/review-settings", handle("collab.settings.put", async (req, res) => void res.json(await putReviewSettings(caller(req), req.body))));

router.post("/templates/from-doc", handle("collab.template", async (req, res) => void res.status(201).json(await templateFromDoc(caller(req), req.body))));
router.post("/layouts/from-page", handle("collab.layout", async (req, res) => void res.status(201).json(await layoutFromPage(caller(req), req.body))));
router.delete(
  "/templates/:id",
  handle("collab.template.archive", async (req, res) => {
    await archiveTemplate(caller(req), routeId(req.params.id));
    res.status(204).end();
  }),
);

export default router;
