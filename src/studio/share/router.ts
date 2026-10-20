/**
 * DS-11 view-link routes inside /studio (behind requireDesignStudio). Manager
 * or Superadmin only (01-contracts §4 "M"); an Admin gets DS_ROLE once the
 * doc is found, another company's ids answer 404.
 *
 *   POST   /docs/:id/shares   {versionId | jobId, expiresInDays ≤ 90} → 201 ReportShare + url (shown once)
 *   GET    /docs/:id/shares   ReportShare[]
 *   DELETE /shares/:id        204 (revoked; the link answers 410)
 */
import { Router } from "express";
import { studioCaller, type StudioRequest } from "../guard";
import { handle, routeId } from "../http";
import { createShare, listShares, revokeShare } from "./service";

const router = Router();
const caller = (req: unknown) => studioCaller(req as StudioRequest);

router.post(
  "/docs/:id/shares",
  handle("shares.create", async (req, res) => {
    const origin = `${req.protocol}://${req.get("host")}`;
    res.status(201).json(await createShare(caller(req), routeId(req.params.id), req.body, origin));
  }),
);

router.get(
  "/docs/:id/shares",
  handle("shares.list", async (req, res) => {
    res.json(await listShares(caller(req), routeId(req.params.id)));
  }),
);

router.delete(
  "/shares/:id",
  handle("shares.revoke", async (req, res) => {
    await revokeShare(caller(req), routeId(req.params.id));
    res.status(204).end();
  }),
);

export default router;
