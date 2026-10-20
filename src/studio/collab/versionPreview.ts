/**
 * DS-13 · the read-only preview of a version (D16 "preview read-only"):
 *
 *   GET /docs/:id/versions/:n/preview.html?mode=paged|sheet   R   sandboxed HTML (CSP), X-Doc-Version
 *
 * The version's own doc (layout, text, bindings) drawn by the one renderer with the same
 * inputs as DS-11's preview.html. Figures resolve against today's approved data (a version
 * keeps only its data hash); a final's figures as printed are in its stored PDF
 * (GET /docs/:id/versions/:n/pdf).
 */
import { DsError, PreviewQuerySchema, ReportDocSchema, dsDocInvalid } from "../contracts";
import type { StudioCaller } from "../guard";
import { parse } from "../http";
import { documentHtml } from "../../reporting/studio/html";
import type { RenderDoc } from "../../reporting/studio/render/types";
import { renderInputs } from "../jobs/inputs";
import { withBridge } from "../jobs/preview";
import { loadVersion } from "../jobs/versions";

export async function versionPreviewHtml(caller: StudioCaller, docId: number, n: number, query: unknown): Promise<{ html: string; n: number }> {
  const { doc: row, row: version } = await loadVersion(caller, docId, n);
  const q = parse(PreviewQuerySchema, query ?? {});
  if (q.mode === "present" || q.mode === "print") throw new DsError("DS_VALIDATION", { issues: [{ path: "mode", message: "A version previews as paged or sheet" }] });
  const parsed = ReportDocSchema.safeParse(version.doc);
  if (!parsed.success) throw dsDocInvalid(parsed.error.issues);
  const doc = parsed.data;
  const inputs = await renderInputs(caller, doc, { docId: row.id });
  const { document } = documentHtml(doc as unknown as RenderDoc, inputs.data, { mode: q.mode, brand: inputs.brand, assets: inputs.assets, inlineFonts: true, cropMarks: false });
  return { html: withBridge(document), n: Number(version.n) };
}
