/**
 * DS-10 routes, mounted by src/studio/router.ts behind requireDesignStudio
 * (403 DS_STUDIO_OFF, then DS_ROLE for Users). Role R (Admin, Manager,
 * Superadmin). Both load the doc first: company (404), kind (DS_KIND_OFF)
 * and the caller's sites (404).
 *
 *   POST /docs/:id/resize   {format, purpose, pageIds?, title?, ai?} → 201 {id, title, pageCount, dropped, truncated, summarised}
 *                           422 DS_FORMAT_INVALID (a purpose/format pair Resize doesn't make),
 *                           422 DS_RESIZE_UNSUPPORTED (no numbers for a card; a booklet of another shape)
 *   GET  /docs/:id/source   {source: LinkedSource | null}: "Made from …", "Source data changed"
 */
import { Router } from "express";
import { studioCaller, type StudioRequest } from "../guard";
import { handle, routeId } from "../http";
import { linkedSource, resizeDesign } from "./service";

const router = Router();
const caller = (req: unknown) => studioCaller(req as StudioRequest);

router.post(
  "/docs/:id/resize",
  handle("docs.resize", async (req, res) => {
    const r = await resizeDesign(caller(req), routeId(req.params.id), req.body);
    res.status(r.status).json(r.body);
  }),
);

router.get(
  "/docs/:id/source",
  handle("docs.source", async (req, res) => {
    res.json(await linkedSource(caller(req), routeId(req.params.id)));
  }),
);

export default router;
