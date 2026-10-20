/**
 * DS-10 · Resize and convert (server side).
 *
 *   resizeDesign(caller, id, body)   POST /docs/:id/resize → a new linked doc, built and autosaved
 *   linkedSource(caller, id)         GET  /docs/:id/source → "Made from …" and "Source data changed"
 *   sourceDataHash(caller, doc, id)  the source's data hash now (resolved through DS-2, approved data only)
 *
 * The copy is made by the pure engine (./engine.ts, shared with the FE
 * preview). Its bindings are the source's, unchanged, so it resolves the same
 * numbers live. `doc.source = {docId, rev, dataHash}` and
 * `report_doc.source_doc_id` link it; the resize report (pages made, elements
 * dropped, text cut or summarised) goes in `report_doc.build.resize`.
 */
import {
  DsError,
  MAX_DOC_BYTES,
  PAGE_FORMAT_SIZES,
  ReportDocSchema,
  ResizeBodySchema,
  TextDocSchema,
  docBytes,
  dsDocInvalid,
  type BuildProgress,
  type LinkedSourceResponse,
  type ReportDoc,
  type ResizeResponse,
} from "../contracts";
import type { StudioCaller } from "../guard";
import { parse } from "../http";
import { stampElements } from "../docs/build";
import { afterBuilt, resolveForBuild } from "../docs/service";
import { addVersion, insertDoc, loadDocRow, saveBuild } from "../docs/store";
import { checkSites, readableSites } from "../sources/resolve";
import { resizeSummaryHook, type ResizeSummaryItem } from "./aiHook";
import { plainText, resizeDocument, textLength, truncateTextDoc, type ResizeReport } from "./engine";

type Json = Record<string, any>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

const validated = (doc: Json): ReportDoc => {
  if (docBytes(doc) > MAX_DOC_BYTES) throw new DsError("DS_DOC_TOO_LARGE");
  const r = ReportDocSchema.safeParse(doc);
  if (!r.success) throw dsDocInvalid(r.error.issues);
  return r.data;
};

/** The source's data hash now: the same resolve as a build (approved data only). */
export async function sourceDataHash(caller: StudioCaller, doc: ReportDoc, docId: number): Promise<string> {
  return (await resolveForBuild(caller, doc, docId)).dataHash;
}

/** The report stored with the copy (`report_doc.build.resize`). */
export interface StoredResizeReport extends Omit<ResizeReport, "truncated"> {
  from: { docId: number; title: string; rev: number };
  truncated: Array<Omit<ResizeReport["truncated"][number], "original">>;
  summarised: string[];
  ai: "off" | "done" | "unavailable" | "failed";
}

const chipKeys = (doc: unknown, out = new Set<string>()): Set<string> => {
  if (!isObj(doc)) return out;
  if (doc.type === "data" && isObj(doc.attrs)) out.add(JSON.stringify(doc.attrs.binding ?? null) + "|" + String(doc.attrs.measure ?? ""));
  if (Array.isArray(doc.content)) doc.content.forEach((c) => chipKeys(c, out));
  return out;
};

/** An AI summary is used only when it is valid TipTap text whose chips all come from the original (no typed numbers either). */
export function acceptSummary(original: Json, summary: unknown, maxChars: number): Json | null {
  const parsed = TextDocSchema.safeParse(summary);
  if (!parsed.success) return null;
  const allowed = chipKeys(original);
  for (const k of chipKeys(parsed.data)) if (!allowed.has(k)) return null;
  const digits = (s: string) => (s.match(/\d/g) ?? []).length;
  if (digits(plainText(parsed.data)) > digits(plainText(original))) return null;
  const doc = parsed.data as Json;
  return textLength(doc) > maxChars ? truncateTextDoc(doc, maxChars).doc : doc;
}

function findElement(doc: Json, id: string): Json | null {
  for (const p of doc.pages as Json[]) for (const e of (p.elements ?? []) as Json[]) if (e.id === id) return e;
  return null;
}

/** POST /docs/:id/resize. */
export async function resizeDesign(caller: StudioCaller, id: number, rawBody: unknown): Promise<{ status: number; body: ResizeResponse }> {
  // The doc first: another company's id answers 404 whatever the body (layer rule 1).
  const row = await loadDocRow(caller, id);
  const body = parse(ResizeBodySchema, rawBody ?? {});
  if (row.build?.state === "running") throw new DsError("DS_VERSION_CONFLICT", { rev: row.rev, building: true });
  const source = validated(row.draft);
  const { readable, all } = await readableSites(caller);
  checkSites(source.meta.sites, readable, all);

  const dataHash = await sourceDataHash(caller, source, id);
  const title = body.title ?? `${source.meta.title} · ${body.purpose === "deck" ? "Board deck" : body.purpose === "summary" ? "Summary" : body.purpose === "social" ? "Social card" : "Booklet"}`.slice(0, 200);
  const result = resizeDocument(source as unknown as Json, {
    purpose: body.purpose,
    format: body.format,
    ...(body.pageIds ? { pageIds: body.pageIds } : {}),
    title,
    sizes: PAGE_FORMAT_SIZES,
    link: { docId: id, rev: row.rev, dataHash },
  });
  if (!result.ok) {
    if (result.error === "FORMAT_INVALID") throw new DsError("DS_FORMAT_INVALID", { format: body.format, purpose: body.purpose, reason: result.detail });
    if (result.error === "UNSUPPORTED") throw new DsError("DS_RESIZE_UNSUPPORTED", { format: body.format, purpose: body.purpose, reason: result.detail });
    throw new DsError("DS_VALIDATION", { issues: [{ path: "pageIds", message: `Unknown pages: ${result.detail}` }] });
  }
  const copy = result.doc;
  const report = result.report;

  // Text: AI summaries (DS-9) when asked and available, else the cut text the engine made.
  const summarised: string[] = [];
  let ai: StoredResizeReport["ai"] = body.ai ? "unavailable" : "off";
  const hook = resizeSummaryHook();
  if (body.ai && hook && report.truncated.length) {
    const action = body.purpose === "social" ? "summarise_for_social" : "summarise_for_deck";
    const items: ResizeSummaryItem[] = report.truncated.map((t) => ({ elementId: t.elementId, action, maxChars: t.maxChars, text: plainText(t.original), doc: t.original }));
    try {
      const out = await hook({ caller, sourceDocId: id, kind: source.kind, items });
      for (const t of report.truncated) {
        const el = findElement(copy, t.elementId);
        const doc = el ? acceptSummary(t.original, out[t.elementId], t.maxChars) : null;
        if (!el || !doc) continue;
        el.props = { ...el.props, doc };
        el.source = "ai";
        delete el.reviewed;
        summarised.push(t.elementId);
      }
      ai = "done";
    } catch (err) {
      console.error(`[studio] resize summaries failed (doc ${id}):`, (err as Error)?.message);
      ai = "failed";
    }
  }

  // Resolve the copy (same bindings, approved data) and stamp what each element was based on.
  const doc = validated(copy);
  const resolved = await resolveForBuild(caller, doc, id);
  const stamped = validated(stampElements(JSON.parse(JSON.stringify(doc)) as Json, resolved.dataHash));

  const now = new Date().toISOString();
  const stored: StoredResizeReport = {
    ...report,
    from: { docId: id, title: source.meta.title, rev: row.rev },
    truncated: report.truncated.filter((t) => !summarised.includes(t.elementId)).map(({ original: _o, ...rest }) => rest),
    summarised,
    ai,
  };
  const textNote = summarised.length
    ? `${summarised.length} text${summarised.length === 1 ? "" : "s"} summarised with AI, marked for your review`
    : stored.truncated.length
      ? `${stored.truncated.length} text${stored.truncated.length === 1 ? "" : "s"} shortened to fit${ai === "unavailable" ? " (AI summaries aren't available yet)" : ai === "failed" ? " (AI wasn't available)" : ""}`
      : "Text fits";
  const build: BuildProgress & { resize: StoredResizeReport } = {
    state: "done",
    steps: [
      { id: "template", label: `Made from ${source.meta.title}`.slice(0, 200), state: "done", note: `${report.profile} · ${body.format}` },
      { id: "data", label: "Reading your approved data", state: "done", note: `${resolved.values.length + resolved.tokens.length} figures` },
      { id: "layout", label: "Laying out the pages", state: "done", note: `${stamped.pages.length} pages${report.dropped.length ? `, ${report.dropped.length} elements left out` : ""}` },
      { id: "inputs", label: "Filling in report details", state: "skipped" },
      { id: "ai", label: "Writing text with AI", state: summarised.length ? "done" : body.ai ? (ai === "failed" ? "failed" : "skipped") : "skipped", note: textNote },
      { id: "save", label: "Saving the design", state: "done" },
    ],
    dropped: [],
    pageCount: stamped.pages.length,
    startedAt: now,
    finishedAt: now,
    resize: stored,
  };
  const newId = await insertDoc({
    companyId: caller.companyId,
    kind: row.kind,
    purpose: stamped.purpose,
    format: stamped.format,
    title: stamped.meta.title,
    year: stamped.meta.year,
    yearType: stamped.meta.yearType,
    draft: stamped as unknown as Json,
    inputs: row.inputs,
    templateId: null,
    sourceDocId: id,
    dataHash: resolved.dataHash,
    build,
    userId: caller.userId,
  });
  await addVersion(newId, "autosave", {
    doc: stamped as unknown as Json,
    rev: 1,
    dataHash: resolved.dataHash,
    designVersion: stamped.design.templateVersion,
    note: `Made from ${source.meta.title}`.slice(0, 500),
    userId: caller.userId,
  });
  await saveBuild(newId, build);
  await afterBuilt(caller, newId, id); // DS-13 drift baselines [Wave 5 integrate]
  return {
    status: 201,
    body: { id: newId, title: stamped.meta.title, pageCount: stamped.pages.length, dropped: report.dropped.length, truncated: stored.truncated.length, summarised: summarised.length },
  };
}

/** GET /docs/:id/source: the copy's source now. Null for a design that isn't a copy. */
export async function linkedSource(caller: StudioCaller, id: number): Promise<LinkedSourceResponse> {
  const row = await loadDocRow(caller, id);
  const link = isObj(row.draft.source) ? row.draft.source : null;
  if (!link) return { source: null };
  const docId = Number(link.docId);
  const base = { docId, rev: Number(link.rev), dataHash: String(link.dataHash ?? "") };
  let src;
  try {
    src = await loadDocRow(caller, docId);
  } catch (err) {
    if (err instanceof DsError && (err.code === "DS_DOC_NOT_FOUND" || err.code === "DS_KIND_OFF")) {
      // Deleted, or no longer readable by this caller: say so without its title.
      return { source: { ...base, exists: false, title: null, currentRev: null, currentDataHash: null, dataChanged: false } };
    }
    throw err;
  }
  const parsed = ReportDocSchema.safeParse(src.draft);
  const currentDataHash = parsed.success ? await sourceDataHash(caller, parsed.data, docId) : null;
  return {
    source: {
      ...base,
      exists: true,
      title: src.title,
      currentRev: src.rev,
      currentDataHash,
      dataChanged: currentDataHash !== null && currentDataHash !== base.dataHash,
    },
  };
}
