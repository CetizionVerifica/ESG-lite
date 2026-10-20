/**
 * DS-12 routes, mounted by src/studio/router.ts behind requireDesignStudio
 * (403 DS_STUDIO_OFF, then DS_ROLE for Users). Role R. The doc is loaded
 * first (another company's id → 404, sustainability without KPI tracking →
 * DS_KIND_OFF, sites the caller can't read → 404).
 *
 *   POST /docs/:id/checks   {rev, measurements?} → {checks, blocking, warnings, layout, rev}
 *
 * Loading this module also registers the checks gate for finals (gate.ts).
 */
import { Router } from "express";
import { registerFinalGate } from "../jobs/gate";
import { studioCaller, type StudioRequest } from "../guard";
import { handle, routeId } from "../http";
import { checksFinalGate } from "./gate";
import { runChecks } from "./service";

registerFinalGate(checksFinalGate);

const router = Router();

router.post(
  "/docs/:id/checks",
  handle("checks", async (req, res) => {
    res.json(await runChecks(studioCaller(req as StudioRequest), routeId(req.params.id), req.body));
  }),
);

export default router;
