/**
 * PE-1 · background remover (docs/design-studio/pro/PE-1.md, decision E1),
 * behind requireDesignStudio (R = Admin, Manager, Superadmin; a Superadmin
 * names company_id):
 *
 *   POST /studio/assets/:id/remove-background   R  {} → 202 ImageJob
 *        404 another company's (or no) asset · 415 DS_ASSET_TYPE (SVG) ·
 *        503 DS_BG_UNAVAILABLE without STUDIO_BG_MODEL_PATH · 409 DS_JOB_RUNNING (3 at once)
 *   GET  /studio/image-jobs/:id                  R  → ImageJob (done → resultAssetId)
 *
 * The engine lives in ./bgRemove/ (onnxruntime-node; a stub engine under
 * NODE_ENV=test). The result is a NEW asset with derivedFrom =
 * {assetId, op: 'remove_background'}; the source is kept. Adjustments,
 * filters, duotone and transparency are element props (no route).
 */
import { Router } from "express";
import { studioCaller, type StudioRequest } from "../guard";
import { handle } from "../http";
import { getImageJob, startRemoveBackground, type EngineOverride } from "./jobs";

const router = Router();
const caller = (req: unknown) => studioCaller(req as StudioRequest);

/** Tests only (NODE_ENV=test): `x-studio-test-bg: off | fail` swaps the engine for this request's job. */
const testOverride = (req: { headers: Record<string, unknown> }): EngineOverride => {
  if (process.env.NODE_ENV !== "test") return null;
  const v = req.headers["x-studio-test-bg"];
  return v === "off" || v === "fail" ? v : null;
};

router.post(
  "/assets/:id/remove-background",
  handle("remove background", async (req, res) => {
    res.status(202).json(await startRemoveBackground(caller(req), req.params.id, req.body, testOverride(req)));
  }),
);
router.get("/image-jobs/:id", handle("image job", async (req, res) => res.json(await getImageJob(caller(req), req.params.id))));

export default router;
