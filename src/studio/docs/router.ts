/**
 * DS-5 routes, mounted by src/studio/router.ts behind requireDesignStudio
 * (403 DS_STUDIO_OFF, then DS_ROLE for Users). Role R (Admin, Manager,
 * Superadmin) for all of them. Every handler that loads a doc checks the
 * company (404), the kind (DS_KIND_OFF) and the caller's sites (404).
 *
 *   GET    /readiness?kind=&year=&yearType=&sites=   GhgReadiness | SustainabilityReadiness
 *   GET    /docs?kind=&year=                         DocSummary[]
 *   POST   /docs[?wait=0]                            {kind, templateId|'blank', year, yearType, sites, frameworks, inputs, ai, …}
 *                                                    → 201 DocResponse (built) | 202 {id, build} (background build)
 *   GET    /docs/:id[?build=1]                       DocResponse | {id, rev, status, title, build}
 *   PATCH  /docs/:id                                 {rev, doc?, title?} → DocResponse; 409 DS_VERSION_CONFLICT {rev}
 *   DELETE /docs/:id                                 soft delete → 204; DS_FINAL_IMMUTABLE with a final
 *   POST   /docs/:id/rebuild                         {pageIds?, keepUserEdits: true} → DocResponse + {rebuilt}
 *   POST   /docs/:id/presence                        → {others}
 *   POST   /docs/:id/duplicate                       {title?} → 201 {id}
 */
import { Router } from "express";
import { z } from "zod";
import { ListDocsQuerySchema, ReportKindSchema, YearTypeSchema } from "../contracts";
import { assertKind, studioCaller, type StudioRequest } from "../guard";
import { handle, parse, routeId } from "../http";
import { checkSites, readableSites } from "../sources/resolve";
import { loadGhgReadiness, loadSustainabilityReadiness } from "./readiness";
import { createDoc, deleteDoc, duplicateDoc, getDoc, patchDoc, rebuildDoc } from "./service";
import { listDocs, loadDocRow, presence } from "./store";

const router = Router();

const SitesQuery = z
  .string()
  .optional()
  .transform((v, c) => {
    if (!v || v === "all") return "all" as const;
    const ids = v.split(",").map((s) => Number(s.trim()));
    if (ids.some((n) => !Number.isInteger(n) || n <= 0)) {
      c.addIssue({ code: "custom", message: "sites must be 'all' or comma-separated ids" });
      return z.NEVER;
    }
    return ids;
  });

const ReadinessQuery = z
  .object({
    kind: ReportKindSchema,
    year: z.coerce.number().int().min(1990).max(2100),
    yearType: YearTypeSchema.default("CY"),
    sites: SitesQuery,
    company_id: z.string().optional(),
  })
  .strict();

const caller = (req: unknown) => studioCaller(req as StudioRequest);

router.get(
  "/readiness",
  handle("readiness", async (req, res) => {
    const c = caller(req);
    const q = parse(ReadinessQuery, req.query ?? {});
    const kind = assertKind(c, q.kind);
    const { readable, all } = await readableSites(c);
    const siteIds = checkSites(q.sites, readable, all);
    res.json(kind === "ghg" ? await loadGhgReadiness(c, { year: q.year, yearType: q.yearType, siteIds }) : await loadSustainabilityReadiness(c, q.year));
  }),
);

router.get(
  "/docs",
  handle("docs.list", async (req, res) => {
    const c = caller(req);
    const q = parse(ListDocsQuerySchema, req.query ?? {});
    if (q.kind) assertKind(c, q.kind);
    res.json(await listDocs(c, { kind: q.kind, year: q.year }));
  }),
);

router.post(
  "/docs",
  handle("docs.create", async (req, res) => {
    const wait = String((req.query as Record<string, unknown>)?.wait ?? "1") !== "0";
    const r = await createDoc(caller(req), req.body, wait);
    res.status(r.status).json(r.body);
  }),
);

router.get(
  "/docs/:id",
  handle("docs.get", async (req, res) => {
    const buildOnly = String((req.query as Record<string, unknown>)?.build ?? "") === "1";
    res.json(await getDoc(caller(req), routeId(req.params.id), buildOnly));
  }),
);

router.patch(
  "/docs/:id",
  handle("docs.patch", async (req, res) => {
    res.json(await patchDoc(caller(req), routeId(req.params.id), req.body));
  }),
);

router.delete(
  "/docs/:id",
  handle("docs.delete", async (req, res) => {
    await deleteDoc(caller(req), routeId(req.params.id));
    res.status(204).end();
  }),
);

router.post(
  "/docs/:id/rebuild",
  handle("docs.rebuild", async (req, res) => {
    res.json(await rebuildDoc(caller(req), routeId(req.params.id), req.body));
  }),
);

router.post(
  "/docs/:id/presence",
  handle("docs.presence", async (req, res) => {
    const c = caller(req);
    const row = await loadDocRow(c, routeId(req.params.id));
    res.json({ others: presence(row.id, c.userId) });
  }),
);

router.post(
  "/docs/:id/duplicate",
  handle("docs.duplicate", async (req, res) => {
    res.status(201).json(await duplicateDoc(caller(req), routeId(req.params.id), req.body));
  }),
);

export default router;
