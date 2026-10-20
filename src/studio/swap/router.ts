/**
 * AT-2 · try another template (docs/design-studio/pro/01-pro-editing-and-ai-templates.md
 * §2B). PRO-0 stub: 501 DS_NOT_BUILT. `suggest_layouts` itself runs through the
 * DS-9 route POST /docs/:id/ai (src/studio/ai/).
 *
 *   POST /studio/docs/:id/template-swap/preview   R  TemplateSwapBody → TemplateSwapPreview (nothing saved)
 *   POST /studio/docs/:id/template-swap/apply     R  TemplateSwapApplyBody → DocResponse (one new rev)
 *
 * Both load the doc with loadDocRow + assertDocSitesReadable + assertKind.
 */
import { Router } from "express";
import { notBuilt } from "../notBuilt";

const router = Router();

router.post("/docs/:id/template-swap/preview", notBuilt("AT-2"));
router.post("/docs/:id/template-swap/apply", notBuilt("AT-2"));

export default router;
