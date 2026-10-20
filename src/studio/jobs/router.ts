/**
 * DS-11 routes, mounted by src/studio/router.ts behind requireDesignStudio
 * (403 DS_STUDIO_OFF, then DS_ROLE for Users). Role R unless noted; every
 * handler loads the doc first (company 404, kind DS_KIND_OFF, sites 404).
 *
 *   GET  /docs/:id/preview.html?mode=&pageId=&rev=   sandboxed HTML (CSP), X-Doc-Rev
 *   POST /docs/:id/jobs                              {kind, rev, options?, note?, acknowledgedWarnings?} → 202 ReportJob (final: M)
 *   GET  /docs/:id/jobs?kind=                        ReportJob[] (newest 20)
 *   GET  /jobs/:id                                   ReportJob
 *   GET  /jobs/:id/file                              the stored file (PDF, ZIP, PNG), attachment unless ?inline=1
 *   GET  /docs/:id/versions?kind=                    ReportVersion[]
 *   POST /docs/:id/versions                          {note} → 201 ReportVersion (snapshot)
 *   POST /docs/:id/versions/:n/restore               {rev} → DocResponse
 *   GET  /docs/:id/versions/:n/pdf                   the stored PDF of a version
 */
import { Router, type Response } from "express";
import { JobKindSchema } from "../contracts";
import { studioCaller, type StudioRequest } from "../guard";
import { handle, parse, routeId } from "../http";
import { PREVIEW_CSP, previewHtml } from "./preview";
import { createJob, getJob, jobFile, listJobs } from "./service";
import { createSnapshot, listVersions, restoreVersion, versionPdf } from "./versions";
import { z } from "zod";

const router = Router();
const caller = (req: unknown) => studioCaller(req as StudioRequest);

const ListJobsQuery = z.object({ kind: JobKindSchema.optional(), company_id: z.string().optional() }).strict();

/** Sends stored bytes: never a URL or a storage key. */
export function sendFile(res: Response, bytes: Buffer, contentType: string, fileName: string, inline: boolean) {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(bytes.length));
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${fileName.replace(/[^\w.-]/g, "_")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(bytes);
}

router.get(
  "/docs/:id/preview.html",
  handle("preview", async (req, res) => {
    const { html, rev } = await previewHtml(caller(req), routeId(req.params.id), req.query);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", PREVIEW_CSP);
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Doc-Rev", String(rev));
    res.send(html);
  }),
);

router.post(
  "/docs/:id/jobs",
  handle("jobs.create", async (req, res) => {
    res.status(202).json(await createJob(caller(req), routeId(req.params.id), req.body));
  }),
);

router.get(
  "/docs/:id/jobs",
  handle("jobs.list", async (req, res) => {
    const c = caller(req);
    const id = routeId(req.params.id);
    const q = parse(ListJobsQuery, req.query ?? {});
    res.json(await listJobs(c, id, q.kind));
  }),
);

router.get(
  "/jobs/:id",
  handle("jobs.get", async (req, res) => {
    res.json(await getJob(caller(req), routeId(req.params.id)));
  }),
);

router.get(
  "/jobs/:id/file",
  handle("jobs.file", async (req, res) => {
    const f = await jobFile(caller(req), routeId(req.params.id));
    sendFile(res, f.bytes, f.contentType, f.fileName, String((req.query as Record<string, unknown>)?.inline ?? "") === "1");
  }),
);

router.get(
  "/docs/:id/versions",
  handle("versions.list", async (req, res) => {
    res.json(await listVersions(caller(req), routeId(req.params.id), req.query));
  }),
);

router.post(
  "/docs/:id/versions",
  handle("versions.create", async (req, res) => {
    res.status(201).json(await createSnapshot(caller(req), routeId(req.params.id), req.body));
  }),
);

router.post(
  "/docs/:id/versions/:n/restore",
  handle("versions.restore", async (req, res) => {
    res.json(await restoreVersion(caller(req), routeId(req.params.id), routeId(req.params.n), req.body));
  }),
);

router.get(
  "/docs/:id/versions/:n/pdf",
  handle("versions.pdf", async (req, res) => {
    const f = await versionPdf(caller(req), routeId(req.params.id), routeId(req.params.n));
    sendFile(res, f.bytes, "application/pdf", f.fileName, String((req.query as Record<string, unknown>)?.inline ?? "") === "1");
  }),
);

export default router;
