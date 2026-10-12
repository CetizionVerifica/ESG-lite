/**
 * IM4 · Server-to-server hook for import batches committed outside the
 * plans API (python_AI_service's bulk upload, until IM11 moves it onto
 * `POST /imports/plans`). Protected by the shared `X-Service-Key`
 * (AI_SERVICE_KEY), not a user token; absent key → the route is off.
 */
import { Router, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { ImportChannelSchema } from "../imports/contracts";
import { notifyBatchCommitted } from "../services/uploadNotify";

const router = Router();

const BatchCommittedBody = z.object({
  upload_batch_id: z.string().min(1).max(100),
  company_id: z.number().int().positive(),
  created_by: z.number().int().positive(),
  channel: ImportChannelSchema.default("bulk_upload"),
  source_name: z.string().max(200).default(""),
  site_ids: z.array(z.number().int().positive()).min(1).max(500),
  rows: z.number().int().nonnegative(),
  tco2e: z.number().nonnegative().default(0),
  months: z.array(z.string().regex(/^\d{4}-\d{2}$/)).max(240).default([]),
});

const keyMatches = (given: unknown): boolean => {
  const expected = process.env.AI_SERVICE_KEY;
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

router.post("/batch-committed", async (req: Request, res: Response) => {
  if (!keyMatches(req.header("x-service-key"))) {
    return res.status(401).json({ code: "UNAUTHORIZED", message: "Service key required" });
  }
  const parsed = BatchCommittedBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "INVALID_BODY", message: "Invalid batch-committed payload" });
  }
  const result = await notifyBatchCommitted(parsed.data);
  return res.status(202).json(result);
});

export default router;
