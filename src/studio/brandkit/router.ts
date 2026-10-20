/**
 * DS-3 routes, behind requireDesignStudio (01-contracts §4):
 *   GET /studio/brand-kit           R → BrandKit
 *   PUT /studio/brand-kit           M → BrandKit  {fonts?, voice?, palettes?}
 *   GET /studio/styles?kind=        R → StylePreset[]  (kind guard: DS_KIND_OFF)
 * A Superadmin passes company_id (query, or body).
 */
import { Router } from "express";
import { requireManager, studioCaller, type StudioRequest } from "../guard";
import { handle } from "../http";
import { getBrandKit, listStyles, putBrandKit } from "./service";

const router = Router();
const caller = (req: unknown) => studioCaller(req as StudioRequest);

router.get("/brand-kit", handle("brand kit", async (req, res) => res.json(await getBrandKit(caller(req)))));
router.put("/brand-kit", requireManager, handle("save brand kit", async (req, res) => res.json(await putBrandKit(caller(req), req.body))));
router.get("/styles", handle("styles", async (req, res) => res.json(await listStyles(caller(req), req.query as Record<string, unknown>))));

export default router;
