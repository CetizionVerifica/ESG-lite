/**
 * AT-1 · template suggestions for a new report (docs/design-studio/pro/
 * 01-pro-editing-and-ai-templates.md §2A), mounted by src/studio/router.ts
 * behind requireDesignStudio (DS_STUDIO_OFF, then DS_ROLE for Users).
 *
 *   POST /studio/templates/suggest   R  TemplateSuggestBody → TemplateSuggestResponse
 *
 * Rule shortlist (kind, frameworks, format, purpose) → data readiness from
 * approved data (counts only) → the AI re-orders and explains (fenced brief,
 * guard, one retry) → else rule order with aiUsed=false. service.ts.
 * Errors: DS_VALIDATION, DS_KIND_OFF, DS_SITES_SCOPE / DS_DOC_NOT_FOUND (sites).
 */
import { Router } from "express";
import { studioCaller, type StudioRequest } from "../guard";
import { handle } from "../http";
import { suggestTemplates } from "./service";

const router = Router();

router.post(
  "/templates/suggest",
  handle("templates.suggest", async (req, res) => {
    const c = studioCaller(req as StudioRequest);
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? { ...(req.body as Record<string, unknown>) } : {};
    delete body.company_id; // a Superadmin names the company there; the guard has read it
    res.json(await suggestTemplates(c, body));
  }),
);

export default router;
