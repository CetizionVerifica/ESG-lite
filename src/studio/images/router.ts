/**
 * PE-1 · background remover (docs/design-studio/pro/01-pro-editing-and-ai-templates.md,
 * decision E1). PRO-0 stub: 501 DS_NOT_BUILT.
 *
 *   POST /studio/assets/:id/remove-background   R  → 202 ImageJob; 503 DS_BG_UNAVAILABLE without STUDIO_BG_MODEL_PATH
 *   GET  /studio/image-jobs/:id                  R  → ImageJob
 *
 * PE-1 replaces this file; the engine lives in ./bgRemove/ (onnxruntime-node,
 * a stub engine under NODE_ENV=test). The result is a NEW asset with
 * derivedFrom = {assetId, op: 'remove_background'}; the source is kept.
 */
import { Router } from "express";
import { notBuilt } from "../notBuilt";

const router = Router();

router.post("/assets/:id/remove-background", notBuilt("PE-1"));
router.get("/image-jobs/:id", notBuilt("PE-1"));

export default router;
