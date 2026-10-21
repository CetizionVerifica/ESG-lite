/**
 * AT-2 · try another template (docs/design-studio/pro/01-pro-editing-and-ai-templates.md
 * §2B), mounted by src/studio/router.ts behind requireDesignStudio (403
 * DS_STUDIO_OFF, then DS_ROLE for Users). Role R (Admin, Manager, Superadmin).
 * `suggest_layouts` itself runs through the DS-9 route POST /docs/:id/ai
 * (src/studio/ai/runner.ts → ./layouts.ts).
 *
 *   POST /studio/docs/:id/template-swap/preview   R  TemplateSwapBody → TemplateSwapPreview (nothing saved)
 *   POST /studio/docs/:id/template-swap/apply     R  TemplateSwapApplyBody → DocResponse (one new rev)
 *
 * Both load the doc with loadDocRow (company → 404, kind → DS_KIND_OFF, sites → 404).
 * Apply refuses a final (DS_FINAL_IMMUTABLE) and a stale rev or preview (409 DS_VERSION_CONFLICT {rev}).
 */
import { Router } from "express";
import { studioCaller, type StudioRequest } from "../guard";
import { handle, routeId } from "../http";
import { applySwap, previewSwap } from "./service";

const router = Router();
const caller = (req: unknown) => studioCaller(req as StudioRequest);

router.post(
  "/docs/:id/template-swap/preview",
  handle("swap.preview", async (req, res) => {
    res.json(await previewSwap(caller(req), routeId(req.params.id), req.body));
  }),
);

router.post(
  "/docs/:id/template-swap/apply",
  handle("swap.apply", async (req, res) => {
    res.json(await applySwap(caller(req), routeId(req.params.id), req.body));
  }),
);

export default router;
