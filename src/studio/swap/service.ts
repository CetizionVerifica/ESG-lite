/**
 * AT-2 · "Try another template" (docs/design-studio/pro/01-pro-editing-and-ai-templates.md §2B).
 *
 *   previewSwap(caller, id, body)   the doc restyled with another template; nothing saved
 *   applySwap(caller, id, body)     rebuilds the same preview, checks its hash, saves it as one
 *                                   new rev through DS-5's PATCH path (final, rev, sites, template
 *                                   locks, autosave) and points the doc at the new template
 *
 * The template must be one the company can see (system or its own), of the doc's kind
 * (else DS_LAYOUT_NOT_FOUND, as an unknown id) and of the doc's format (else
 * DS_FORMAT_INVALID: another format is Resize). No model call: the swap is deterministic,
 * so the preview hash is stable until the doc or the template changes.
 */
import { AppDataSource } from "../../config/data-source";
import {
  DsError,
  ReportDocSchema,
  TemplateSwapApplyBodySchema,
  TemplateSwapBodySchema,
  dsDocInvalid,
  type DocResponse,
  type ReportDoc,
  type TemplateSwapPreview,
  type ThemeOverrides,
} from "../contracts";
import { patchDoc } from "../docs/service";
import { docResponse, loadDocRow, type DocRow } from "../docs/store";
import type { StudioCaller } from "../guard";
import { parse } from "../http";
import { listLayouts, templateDoc } from "../library/service";
import { docHash, swapTemplate } from "./compose";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** The body without `company_id` (a Superadmin names the company there; the guard has read it). */
export const bodyOf = (raw: unknown): Json => {
  const b = isObj(raw) ? { ...raw } : {};
  delete b.company_id;
  return b;
};

async function loadSwapDoc(caller: StudioCaller, id: number): Promise<{ row: DocRow; doc: ReportDoc }> {
  const row = await loadDocRow(caller, id);
  if (row.build?.state === "running") throw new DsError("DS_VERSION_CONFLICT", { rev: row.rev, building: true });
  const r = ReportDocSchema.safeParse(row.draft);
  if (!r.success) throw dsDocInvalid(r.error.issues);
  return { row, doc: r.data };
}

async function buildPreview(caller: StudioCaller, row: DocRow, doc: ReportDoc, templateId: number): Promise<TemplateSwapPreview> {
  const { template, doc: tdoc } = await templateDoc(caller, templateId);
  if (template.kind !== doc.kind) throw new DsError("DS_LAYOUT_NOT_FOUND", { templateId, kind: doc.kind });
  if (template.format !== doc.format) throw new DsError("DS_FORMAT_INVALID", { templateFormat: template.format, format: doc.format, message: "Use Resize to move a design to another format" });
  const layouts = await listLayouts(caller, { kind: doc.kind, format: doc.format, template: template.family });
  const theme = (isObj(tdoc?.design) && isObj((tdoc.design as Json).theme) ? (tdoc.design as Json).theme : {}) as ThemeOverrides;
  const result = swapTemplate(doc, { slug: template.slug, version: template.version, theme, layouts: layouts.filter((l) => l.family === template.family) });
  const checked = ReportDocSchema.safeParse(result.doc);
  if (!checked.success) throw dsDocInvalid(checked.error.issues);
  return {
    fromTemplateId: doc.design.templateId,
    templateId: template.id,
    rev: row.rev,
    doc: checked.data,
    pages: result.pages,
    unplaced: result.unplaced,
    previewHash: docHash(checked.data),
  };
}

/** POST /docs/:id/template-swap/preview */
export async function previewSwap(caller: StudioCaller, id: number, raw: unknown): Promise<TemplateSwapPreview> {
  const { row, doc } = await loadSwapDoc(caller, id);
  const body = parse(TemplateSwapBodySchema, bodyOf(raw));
  if (body.rev !== row.rev) throw new DsError("DS_VERSION_CONFLICT", { rev: row.rev });
  return buildPreview(caller, row, doc, body.templateId);
}

/** POST /docs/:id/template-swap/apply */
export async function applySwap(caller: StudioCaller, id: number, raw: unknown): Promise<DocResponse> {
  const { row, doc } = await loadSwapDoc(caller, id);
  const body = parse(TemplateSwapApplyBodySchema, bodyOf(raw));
  if (row.status === "final") throw new DsError("DS_FINAL_IMMUTABLE");
  if (body.rev !== row.rev) throw new DsError("DS_VERSION_CONFLICT", { rev: row.rev });
  const preview = await buildPreview(caller, row, doc, body.templateId);
  if (preview.previewHash !== body.previewHash) throw new DsError("DS_VERSION_CONFLICT", { rev: row.rev, reason: "preview_changed" });
  await patchDoc(caller, id, { rev: row.rev, doc: preview.doc });
  await AppDataSource.query(`UPDATE report_doc SET template_id = $1 WHERE id = $2 AND company_id = $3`, [preview.templateId, id, caller.companyId]);
  return docResponse(await loadDocRow(caller, id));
}
