/**
 * DS-5 · designs: create (auto-build), read, autosave, rename, delete,
 * rebuild and duplicate. Routes are in router.ts; rows in store.ts; the pure
 * build steps in build.ts.
 *
 * Auto-build (POST /docs), in steps saved to `report_doc.build` so the
 * new-design flow can poll GET /docs/:id?build=1:
 *   template  load the template at its current version (or the blank page)
 *   data      resolve every binding and chip through DS-2 (approved data only)
 *   layout    leave out pages whose data is empty unless the template keeps them
 *   inputs    fill {{…}} placeholders from the company, the period and the report inputs
 *   ai        the DS-9 drafting hook when `ai: true` (until then: skipped, template text kept)
 *   save      validate (ReportDocSchema, 2 MB), store rev 1 and an autosave version
 * `?wait=0` answers 202 at once and builds in the background; the default
 * waits and answers 201 with the built doc.
 */
import { AppDataSource } from "../../config/data-source";
import {
  BLANK_TEMPLATE,
  CreateDocBodySchema,
  DsError,
  DuplicateBodySchema,
  MAX_DOC_BYTES,
  PatchDocBodySchema,
  RebuildBodySchema,
  ReportDocSchema,
  docBytes,
  dsDocInvalid,
  type BuildProgress,
  type BuildStep,
  type BuildStepId,
  type CreateDocBody,
  type ReportDoc,
  type ReportInputs,
  type ReportKind,
  type TemplatePageHint,
  type YearType,
} from "../contracts";
import { assertKind, type StudioCaller } from "../guard";
import { parse } from "../http";
import { collectTokens, docBindings } from "../sources/doc";
import { dataHash } from "../sources/hash";
import { applyInputPatch, periodText } from "../sources/inputs";
import { buildContext, checkSites, loadersFor, readableSites, resolveAll } from "../sources/resolve";
import type { ResolvedBinding, ResolveResponse } from "../sources/types";
import { aiDraftHook } from "./aiHook";
import { assembleDoc, defaultTitle, dropEmptyPages, emptyDataPages, fillPlaceholders, mergeRebuild, stampElements, type BuildChoices } from "./build";
import { addVersion, autosaveIfDue, docResponse, docSites, insertDoc, loadDocRow, saveBuild, softDelete, updateDraft, type DocRow } from "./store";
import { blankTemplate, loadTemplate, splitTemplateDoc, type TemplateRow } from "./template";

type Json = Record<string, any>;

const STEP_LABELS: Record<BuildStepId, string> = {
  template: "Loading the template",
  data: "Reading your approved data",
  layout: "Laying out the pages",
  inputs: "Filling in report details",
  ai: "Writing text with AI",
  save: "Saving the design",
};

export function newProgress(ai: boolean): BuildProgress {
  return {
    state: "running",
    steps: (Object.keys(STEP_LABELS) as BuildStepId[]).map((id) => ({ id, label: STEP_LABELS[id], state: id === "ai" && !ai ? "skipped" : "pending" })),
    dropped: [],
    pageCount: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

const setStep = (p: BuildProgress, id: BuildStepId, state: BuildStep["state"], note?: string) => {
  const s = p.steps.find((x) => x.id === id);
  if (s) {
    s.state = state;
    if (note !== undefined) s.note = note;
  }
};

/** Reads one GHG/KPI value per binding even when one page's binding is invalid for the company (that page then counts as empty). */
async function resolveForBuild(caller: StudioCaller, doc: ReportDoc, docId: number | undefined): Promise<ResolveResponse> {
  const L = loadersFor(caller.companyId, doc.meta.yearType);
  const { ctx } = await buildContext(caller, { kind: doc.kind, year: doc.meta.year, yearType: doc.meta.yearType, sites: doc.meta.sites, ...(docId ? { docId } : {}) }, L);
  try {
    return await resolveAll(L, ctx, docBindings(doc), collectTokens(doc));
  } catch (err) {
    if (!(err instanceof DsError) || err.code !== "DS_BINDING_INVALID") throw err;
  }
  const values: ResolvedBinding[] = [];
  const tokens: ResolvedBinding[] = [];
  for (const page of doc.pages) {
    const one = { ...doc, pages: [page] } as ReportDoc;
    const b = docBindings(one);
    const t = collectTokens(one);
    try {
      const r = await resolveAll(L, ctx, b, t);
      values.push(...r.values);
      tokens.push(...r.tokens);
    } catch (err) {
      if (!(err instanceof DsError) || err.code !== "DS_BINDING_INVALID") throw err;
      const none = (source: ResolvedBinding["source"]): ResolvedBinding => ({ source, display: "Not reported", value: null, unit: null, unavailable: { reason: "NO_DATA", detail: "binding not valid for this company" } });
      values.push(...b.map((x) => none(x.source)));
      tokens.push(...t.map((x) => none(x.attrs.binding.source)));
    }
  }
  const unavailable = [
    ...values.flatMap((v, i) => (v.unavailable ? [{ bindingIdx: i, reason: v.unavailable.reason }] : [])),
    ...tokens.flatMap((v, i) => (v.unavailable ? [{ bindingIdx: i, reason: v.unavailable.reason, token: true }] : [])),
  ];
  return { values, tokens, unavailable, dataHash: dataHash({ year: ctx.year, yearType: ctx.yearType, siteIds: ctx.siteIds, values: [...values, ...tokens], inputs: ctx.inputs }) };
}

async function placeholderContext(caller: StudioCaller, doc: ReportDoc, inputs: ReportInputs) {
  const [company]: Json[] = await AppDataSource.query(`SELECT name FROM company WHERE company_id = $1`, [caller.companyId]);
  let sitesText = "All sites";
  if (doc.meta.sites !== "all") {
    const rows: Json[] = await AppDataSource.query(`SELECT name FROM site WHERE site_id = ANY($1::int[]) AND company_id = $2 ORDER BY name`, [doc.meta.sites, caller.companyId]);
    sitesText = rows.map((r) => String(r.name)).join(", ");
  }
  const period = inputs.reporting_period?.value;
  return {
    companyName: String(company?.name ?? ""),
    title: doc.meta.title,
    year: doc.meta.year,
    yearType: doc.meta.yearType,
    ...(doc.meta.compareYear !== undefined ? { compareYear: doc.meta.compareYear } : {}),
    sitesText,
    frameworksText: doc.meta.frameworks.join(", "),
    inputs,
    periodText: typeof period === "string" && period.trim() ? period : periodText(doc.meta.yearType, doc.meta.year),
  };
}

const validated = (doc: Json): ReportDoc => {
  if (docBytes(doc) > MAX_DOC_BYTES) throw new DsError("DS_DOC_TOO_LARGE");
  const r = ReportDocSchema.safeParse(doc);
  if (!r.success) throw dsDocInvalid(r.error.issues);
  return r.data;
};

export interface Composed {
  doc: ReportDoc;
  dataHash: string;
  dropped: BuildProgress["dropped"];
}

/**
 * Template + choices → a built doc (steps data, layout, inputs, ai). `docId`
 * names the stored doc whose inputs the build reads (DS-2 buildContext).
 */
export async function composeDoc(
  caller: StudioCaller,
  template: TemplateRow,
  choices: BuildChoices,
  opts: { docId?: number; ai: boolean; progress?: BuildProgress; onStep?: () => Promise<unknown> },
): Promise<Composed> {
  const p = opts.progress ?? newProgress(opts.ai);
  const step = async (id: BuildStepId, state: BuildStep["state"], note?: string) => {
    setStep(p, id, state, note);
    if (opts.onStep) await opts.onStep();
  };
  const { doc: tdoc, hints } = splitTemplateDoc(template.doc);
  const assembled = assembleDoc(template, tdoc, choices);
  // The template must be a valid doc of its format before data goes in (placeholders are plain text).
  const base = validated(assembled);
  await step("data", "running");
  const resolved = await resolveForBuild(caller, base, opts.docId);
  await step("data", "done", `${resolved.values.length + resolved.tokens.length} figures`);
  await step("layout", "running");
  const working = JSON.parse(JSON.stringify(base)) as Json;
  const dropped = dropEmptyPages(working, hints as Map<string, TemplatePageHint>, emptyDataPages(base, resolved));
  if (!working.pages.length) working.pages = blankTemplate(choices.kind, template.format).doc.pages;
  p.dropped = dropped;
  await step("layout", "done", `${working.pages.length} pages${dropped.length ? ` (${dropped.length} left out: no data)` : ""}`);
  await step("inputs", "running");
  const L = loadersFor(caller.companyId, choices.yearType);
  const { ctx } = await buildContext(caller, { kind: choices.kind, year: choices.year, yearType: choices.yearType, sites: choices.sites, ...(opts.docId ? { docId: opts.docId } : {}) }, L);
  fillPlaceholders(working, await placeholderContext(caller, base, ctx.inputs));
  stampElements(working, resolved.dataHash);
  await step("inputs", "done");
  let doc = validated(working);
  if (opts.ai) {
    const hook = aiDraftHook();
    if (!hook || !opts.docId) {
      await step("ai", "skipped", "AI drafting isn't available yet; the template's text is kept.");
    } else {
      await step("ai", "running");
      try {
        const r = await hook({ caller, docId: opts.docId, doc: doc as unknown as Json, dataHash: resolved.dataHash });
        doc = validated(r.doc);
        await step("ai", "done", r.note);
      } catch (err) {
        console.error(`[studio] ai draft failed (doc ${opts.docId}):`, (err as Error)?.message);
        await step("ai", "failed", "AI wasn't available; the template's text is kept.");
      }
    }
  }
  return { doc, dataHash: resolved.dataHash, dropped };
}

/** Loads the template a request names (or the blank page) and checks it is of the request's kind. */
async function templateFor(caller: StudioCaller, body: Pick<CreateDocBody, "templateId" | "kind" | "format">): Promise<TemplateRow> {
  if (body.templateId === BLANK_TEMPLATE) return blankTemplate(body.kind, body.format ?? "a4");
  const t = await loadTemplate(caller.companyId, body.templateId);
  if (t.kind !== body.kind) throw new DsError("DS_LAYOUT_NOT_FOUND", { templateId: body.templateId, kind: body.kind });
  if (body.format && body.format !== t.format) throw new DsError("DS_FORMAT_INVALID", { templateFormat: t.format });
  return t;
}

const errorBody = (err: unknown) => (err instanceof DsError ? { code: err.code, message: err.message } : { code: "DS_JOB_FAILED", message: "The design couldn't be built." });

async function runBuild(caller: StudioCaller, id: number, template: TemplateRow, choices: BuildChoices, ai: boolean, progress: BuildProgress): Promise<DocRow> {
  const composed = await composeDoc(caller, template, choices, { docId: id, ai, progress, onStep: () => saveBuild(id, progress) });
  setStep(progress, "save", "running");
  progress.pageCount = composed.doc.pages.length;
  const title = composed.doc.meta.title;
  await AppDataSource.query(`UPDATE report_doc SET draft = $1::jsonb, title = $2, data_hash = $3, purpose = $4, format = $5 WHERE id = $6`, [
    JSON.stringify(composed.doc),
    title,
    composed.dataHash,
    composed.doc.purpose,
    composed.doc.format,
    id,
  ]);
  await addVersion(id, "autosave", { doc: composed.doc as unknown as Json, rev: 1, dataHash: composed.dataHash, designVersion: template.version, note: "Built from the template", userId: caller.userId });
  setStep(progress, "save", "done");
  progress.state = "done";
  progress.finishedAt = new Date().toISOString();
  await saveBuild(id, progress);
  return loadDocRow(caller, id);
}

/** POST /docs. `wait` false → 202 `{id, build}` and the build runs in the background. */
export async function createDoc(caller: StudioCaller, rawBody: unknown, wait: boolean) {
  // The kind guard answers before validation (DS_KIND_OFF for a sustainability request with KPI tracking off).
  const rawKind = (rawBody as { kind?: unknown } | null)?.kind;
  if (rawKind === "sustainability") assertKind(caller, rawKind);
  const body = parse(CreateDocBodySchema, rawBody ?? {});
  const kind = assertKind(caller, body.kind) as ReportKind;
  const { readable, all } = await readableSites(caller);
  const siteIds = checkSites(body.sites, readable, all);
  const sites: "all" | number[] = body.sites === "all" ? "all" : siteIds;
  const template = await templateFor(caller, body);
  const inputs = applyInputPatch({}, body.inputs, kind, caller.userId);
  const choices: BuildChoices = {
    kind,
    year: body.year,
    yearType: body.yearType as YearType,
    sites,
    frameworks: body.frameworks,
    ...(body.compareYear !== undefined ? { compareYear: body.compareYear } : {}),
    ...(body.title ? { title: body.title } : {}),
  };
  const progress = newProgress(body.ai);
  setStep(progress, "template", "done", template.name);
  const { doc: tdoc } = splitTemplateDoc(template.doc);
  const draft = assembleDoc(template, tdoc, choices);
  const id = await insertDoc({
    companyId: caller.companyId,
    kind,
    purpose: template.purpose,
    format: template.format,
    title: choices.title ?? defaultTitle(template, choices),
    year: body.year,
    yearType: choices.yearType,
    draft,
    inputs,
    templateId: template.id || null,
    build: progress,
    userId: caller.userId,
  });
  const fail = async (err: unknown) => {
    progress.state = "failed";
    progress.finishedAt = new Date().toISOString();
    progress.error = errorBody(err);
    const running = progress.steps.find((s) => s.state === "running");
    if (running) running.state = "failed";
    await saveBuild(id, progress).catch(() => undefined);
  };
  if (!wait) {
    setImmediate(() => {
      runBuild(caller, id, template, choices, body.ai, progress).catch(async (err) => {
        console.error(`[studio] build failed (doc ${id}):`, (err as Error)?.message);
        await fail(err);
      });
    });
    return { status: 202, body: { id, rev: 1, status: "draft", title: draft.meta.title, build: progress } };
  }
  try {
    const row = await runBuild(caller, id, template, choices, body.ai, progress);
    return { status: 201, body: docResponse(row) };
  } catch (err) {
    // A synchronous build that fails leaves nothing behind.
    await AppDataSource.query(`DELETE FROM report_doc_version WHERE doc_id = $1`, [id]).catch(() => undefined);
    await AppDataSource.query(`DELETE FROM report_doc WHERE id = $1`, [id]).catch(() => undefined);
    throw err;
  }
}

/** GET /docs/:id (`build=1`: the progress only, for polling while the build runs). */
export async function getDoc(caller: StudioCaller, id: number, buildOnly: boolean) {
  const row = await loadDocRow(caller, id);
  if (buildOnly) return { id: row.id, rev: row.rev, status: row.status, title: row.title, build: row.build };
  return docResponse(row);
}

/** PATCH /docs/:id: autosave (`doc`) and/or rename (`title`), optimistic on `rev`. */
export async function patchDoc(caller: StudioCaller, id: number, rawBody: unknown) {
  // The doc first: another company's id answers 404 whatever the body (layer rule 1).
  const row = await loadDocRow(caller, id);
  const body = parse(PatchDocBodySchema, rawBody ?? {});
  if (row.status === "final") throw new DsError("DS_FINAL_IMMUTABLE");
  if (row.build?.state === "running") throw new DsError("DS_VERSION_CONFLICT", { rev: row.rev, building: true });
  if (body.rev !== row.rev) throw new DsError("DS_VERSION_CONFLICT", { rev: row.rev });
  const next: Json = body.doc !== undefined ? (body.doc as Json) : JSON.parse(JSON.stringify(row.draft));
  if (body.title !== undefined && next && typeof next === "object" && next.meta && typeof next.meta === "object") next.meta.title = body.title;
  const doc = validated(next);
  if (doc.kind !== row.kind) throw dsDocInvalid([{ path: ["kind"], message: "A design's kind can't change" }]);
  if (doc.format !== (row.draft.format ?? doc.format)) throw new DsError("DS_FORMAT_INVALID", { format: doc.format, message: "Resize makes a new design in another format" });
  const { readable, all } = await readableSites(caller);
  checkSites(doc.meta.sites, readable, all);
  const rev = await updateDraft(caller, id, body.rev, doc as unknown as Json, { title: doc.meta.title });
  // Version history (D16): an autosave every 10 minutes of editing, with the data hash.
  await autosaveIfDue(id, { doc: doc as unknown as Json, rev, dataHash: row.dataHash, designVersion: doc.design.templateVersion, userId: caller.userId });
  return docResponse(await loadDocRow(caller, id));
}

export async function deleteDoc(caller: StudioCaller, id: number) {
  const row = await loadDocRow(caller, id);
  await softDelete(caller, row);
}

/** POST /docs/:id/rebuild: rebuild pages from the template's current version, keeping people's edits. */
export async function rebuildDoc(caller: StudioCaller, id: number, rawBody: unknown) {
  const row = await loadDocRow(caller, id);
  const body = parse(RebuildBodySchema, rawBody ?? {});
  if (row.status === "final") throw new DsError("DS_FINAL_IMMUTABLE");
  if (!row.templateId) throw new DsError("DS_LAYOUT_NOT_FOUND", { reason: "A blank design has no template to rebuild from" });
  const current = validated(row.draft);
  const template = await loadTemplate(caller.companyId, row.templateId);
  const choices: BuildChoices = {
    kind: current.kind,
    year: current.meta.year,
    yearType: current.meta.yearType,
    sites: current.meta.sites,
    frameworks: current.meta.frameworks,
    title: current.meta.title,
    ...(current.meta.compareYear !== undefined ? { compareYear: current.meta.compareYear } : {}),
  };
  const fresh = await composeDoc(caller, template, choices, { docId: id, ai: false });
  const { doc: merged, rebuilt } = mergeRebuild(current as unknown as Json, fresh.doc as unknown as Json, body.pageIds);
  merged.design = { ...merged.design, templateVersion: template.version };
  const doc = validated(merged);
  const rev = await updateDraft(caller, id, row.rev, doc as unknown as Json, { title: doc.meta.title, dataHash: fresh.dataHash });
  await autosaveIfDue(id, { doc: doc as unknown as Json, rev, dataHash: fresh.dataHash, designVersion: template.version, userId: caller.userId });
  return { ...docResponse(await loadDocRow(caller, id)), rebuilt };
}

/** POST /docs/:id/duplicate: a new draft with the same pages and inputs (not linked; Resize links). */
export async function duplicateDoc(caller: StudioCaller, id: number, rawBody: unknown) {
  const row = await loadDocRow(caller, id);
  const body = parse(DuplicateBodySchema, rawBody ?? {});
  const draft = JSON.parse(JSON.stringify(row.draft)) as Json;
  const title = (body.title ?? `${row.title} (copy)`).slice(0, 200);
  if (draft.meta && typeof draft.meta === "object") draft.meta.title = title;
  const doc = validated(draft);
  const { readable, all } = await readableSites(caller);
  checkSites(docSites(row.draft), readable, all);
  const newId = await insertDoc({
    companyId: caller.companyId,
    kind: row.kind,
    purpose: doc.purpose,
    format: doc.format,
    title,
    year: doc.meta.year,
    yearType: doc.meta.yearType,
    draft: doc as unknown as Json,
    inputs: row.inputs,
    templateId: row.templateId,
    dataHash: row.dataHash,
    userId: caller.userId,
  });
  await addVersion(newId, "autosave", { doc: doc as unknown as Json, rev: 1, dataHash: row.dataHash, designVersion: doc.design.templateVersion, note: `Copy of design ${row.id}`, userId: caller.userId });
  return { id: newId };
}
