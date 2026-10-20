/**
 * DS-2 routes, mounted by src/studio/router.ts behind requireDesignStudio
 * (403 DS_STUDIO_OFF, then DS_ROLE for Users). Role R (Admin, Manager,
 * Superadmin) for all of them.
 *
 *   POST  /resolve                {kind, year, yearType, sites, bindings, tokens, docId?, inputs?}
 *                                 → {values, tokens, dataHash, unavailable}
 *   GET   /docs/:id/inputs        → {rev, inputs, prefill}
 *   PATCH /docs/:id/inputs        {rev, inputs: {key: {value, source?} | null}} → {rev, inputs, prefill}
 *   GET   /inputs/prefill?kind=&year=&yearType=&sites=   → {keys, prefill} (new-design flow, before a doc exists)
 *   GET   /data?kind=&year=&yearType=&sites=&q=&topic=&framework=   → {groups} (the Data drawer list)
 *   GET   /materiality · PUT /materiality {scores}   → {topics, points} (materiality.ts; sustainability kind)
 */
import { Router } from "express";
import { z } from "zod";
import { DsError, inputKeysFor, ReportKindSchema, YearTypeSchema, type ReportKind } from "../contracts";
import { assertKind, studioCaller, type StudioRequest } from "../guard";
import { handle, parse, routeId } from "../http";
import { ghgCatalog, kpiCatalog } from "./catalog";
import { materialityRouter } from "./materiality";
import { applyInputPatch, loadDocInputs, prefillInputs, saveDocInputs } from "./inputs";
import { assertDocSitesReadable, buildContext, checkSites, loadersFor, readableSites, resolveRequest } from "./resolve";

const router = Router();

/** `sites` in a query: "all" (default) or comma-separated ids. */
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

const ScopeQuery = z
  .object({
    kind: ReportKindSchema,
    year: z.coerce.number().int().min(1990).max(2100),
    yearType: YearTypeSchema.default("CY"),
    sites: SitesQuery,
    q: z.string().max(80).optional(),
    topic: z.string().max(40).optional(),
    framework: z.string().max(20).optional(),
    company_id: z.string().optional(),
  })
  .strict();

const PatchInputs = z.object({ rev: z.number().int().min(0), inputs: z.record(z.string(), z.unknown()), company_id: z.union([z.number(), z.string()]).optional() }).strict();

router.post(
  "/resolve",
  handle("resolve", async (req, res) => {
    res.json(await resolveRequest(studioCaller(req as StudioRequest), req.body));
  }),
);

/** The doc's year and sites (sites the caller can't read any more drop out of the prefill). */
async function docPrefill(req: StudioRequest, docId: number) {
  const caller = studioCaller(req);
  const doc = await loadDocInputs(caller.companyId, docId);
  assertKind(caller, doc.kind);
  const { readable, all } = await readableSites(caller);
  assertDocSitesReadable(doc.sites, readable, all); // [DS review] a site-scoped caller never reads a wider design's inputs
  const siteIds = doc.sites === "all" ? readable : doc.sites.filter((s) => readable.includes(s));
  const L = loadersFor(caller.companyId, doc.yearType);
  const prefill = Number.isFinite(doc.year)
    ? await prefillInputs({ companyId: caller.companyId, kind: doc.kind, year: doc.year, yearType: doc.yearType, siteIds, kpiEnabled: caller.kpiEnabled }, L.ghg, L.kpi)
    : {};
  return { caller, doc, prefill };
}

router.get(
  "/docs/:id/inputs",
  handle("inputs.get", async (req, res) => {
    const { doc, prefill } = await docPrefill(req as StudioRequest, routeId(req.params.id));
    res.json({ rev: doc.rev, inputs: doc.inputs, prefill });
  }),
);

router.patch(
  "/docs/:id/inputs",
  handle("inputs.patch", async (req, res) => {
    const id = routeId(req.params.id);
    const { caller, doc, prefill } = await docPrefill(req as StudioRequest, id);
    const body = parse(PatchInputs, req.body ?? {});
    if (doc.status === "final") throw new DsError("DS_FINAL_IMMUTABLE"); // [DS review] as PATCH /docs/:id
    if (body.rev !== doc.rev) throw new DsError("DS_VERSION_CONFLICT", { rev: doc.rev });
    const next = applyInputPatch(doc.inputs, body.inputs, doc.kind, caller.userId);
    const rev = await saveDocInputs(caller.companyId, id, body.rev, next, caller.userId);
    res.json({ rev, inputs: next, prefill });
  }),
);

router.get(
  "/inputs/prefill",
  handle("inputs.prefill", async (req, res) => {
    const caller = studioCaller(req as StudioRequest);
    const q = parse(ScopeQuery, req.query ?? {});
    const kind = assertKind(caller, q.kind) as ReportKind;
    const { readable, all } = await readableSites(caller);
    const siteIds = checkSites(q.sites, readable, all);
    const L = loadersFor(caller.companyId, q.yearType);
    const prefill = await prefillInputs({ companyId: caller.companyId, kind, year: q.year, yearType: q.yearType, siteIds, kpiEnabled: caller.kpiEnabled }, L.ghg, L.kpi);
    res.json({ keys: inputKeysFor(kind), prefill });
  }),
);

router.get(
  "/data",
  handle("data", async (req, res) => {
    const caller = studioCaller(req as StudioRequest);
    const q = parse(ScopeQuery, req.query ?? {});
    const L = loadersFor(caller.companyId, q.yearType);
    const { ctx } = await buildContext(caller, { kind: q.kind, year: q.year, yearType: q.yearType, sites: q.sites }, L);
    const groups = q.kind === "ghg" ? await ghgCatalog(L, ctx) : await kpiCatalog(L, ctx, { q: q.q, topic: q.topic, framework: q.framework });
    res.json({ kind: q.kind, year: q.year, yearType: q.yearType, siteIds: ctx.siteIds, groups });
  }),
);

router.use(materialityRouter);

export default router;
