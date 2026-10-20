/**
 * DS-5 · reading a template for the auto-build. The `report_template` table
 * belongs to DS-4 (01-contracts §3: `company_id` (null = system), `kind`,
 * `purpose`, `format`, `name`, `tags`, `theme`, `doc` (a ReportDoc v2 with
 * placeholders), `thumbnail_key`, `version`, `is_active`, `created_by`).
 * DS-5 only reads it, with raw SQL, so this module builds before DS-4 lands;
 * until the table exists every template answers 404 DS_LAYOUT_NOT_FOUND.
 *
 *   loadTemplate(companyId, id)   a system template or one of the company's, active only
 *   splitTemplateDoc(raw)         the doc without build hints, and the hints per page id
 *   blankTemplate(kind, format)   the "Blank" card: one empty free-form page
 */
import { AppDataSource } from "../../config/data-source";
import {
  DOC_PURPOSES,
  DsError,
  PAGE_FORMATS,
  TEMPLATE_PAGE_HINT_KEYS,
  TemplatePageHintSchema,
  type DocPurpose,
  type PageFormat,
  type ReportKind,
  type TemplatePageHint,
} from "../contracts";

type Row = Record<string, any>;
type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

export interface TemplateRow {
  id: number;
  companyId: number | null;
  kind: ReportKind;
  purpose: DocPurpose;
  format: PageFormat;
  name: string;
  version: number;
  theme: Json;
  /** The stored template doc (placeholders and hints included). */
  doc: Json;
}

let templateTable: boolean | null = null;
async function hasTemplateTable(): Promise<boolean> {
  if (templateTable) return true;
  const [r]: Row[] = await AppDataSource.query(`SELECT to_regclass('report_template') IS NOT NULL AS ok`);
  templateTable = r?.ok === true;
  return templateTable;
}

/** Test hook: forget whether the table exists. */
export const resetTemplateTableCache = () => {
  templateTable = null;
};

/** An active system template or one of `companyId`'s (another company's answers 404, as an unknown id). */
export async function loadTemplate(companyId: number, id: number): Promise<TemplateRow> {
  if (!(await hasTemplateTable())) throw new DsError("DS_LAYOUT_NOT_FOUND");
  const [r]: Row[] = await AppDataSource.query(
    `SELECT id, company_id, kind, purpose, format, name, version, theme, doc FROM report_template
      WHERE id = $1 AND (company_id IS NULL OR company_id = $2) AND is_active IS NOT FALSE`,
    [id, companyId],
  );
  if (!r || !isObj(r.doc)) throw new DsError("DS_LAYOUT_NOT_FOUND");
  const format = (PAGE_FORMATS as readonly string[]).includes(r.format) ? (r.format as PageFormat) : null;
  if (!format) throw new DsError("DS_FORMAT_INVALID", { templateId: id });
  return {
    id: Number(r.id),
    companyId: r.company_id === null ? null : Number(r.company_id),
    kind: r.kind as ReportKind,
    purpose: ((DOC_PURPOSES as readonly string[]).includes(r.purpose) ? r.purpose : "report") as DocPurpose,
    format,
    name: String(r.name ?? "Template"),
    version: Math.max(1, Number(r.version) || 1),
    theme: isObj(r.theme) ? r.theme : {},
    doc: r.doc as Json,
  };
}

/**
 * Splits a stored template doc into the ReportDoc part and its build hints
 * (01-contracts docs.ts "Template build contract"): page-level `requires`,
 * `keepEmpty`, `emptyText`, and/or a top-level `build.pages[pageId]` map
 * (the page-level value wins). Malformed hints are ignored.
 */
export function splitTemplateDoc(raw: Json): { doc: Json; hints: Map<string, TemplatePageHint> } {
  const hints = new Map<string, TemplatePageHint>();
  const top = isObj(raw.build) && isObj(raw.build.pages) ? (raw.build.pages as Json) : {};
  for (const [pageId, h] of Object.entries(top)) {
    const parsed = TemplatePageHintSchema.safeParse(h);
    if (parsed.success) hints.set(pageId, parsed.data);
  }
  const pages = Array.isArray(raw.pages)
    ? raw.pages.map((p) => {
        if (!isObj(p)) return p;
        const own: Json = {};
        const rest: Json = {};
        for (const [k, v] of Object.entries(p)) ((TEMPLATE_PAGE_HINT_KEYS as readonly string[]).includes(k) ? own : rest)[k] = v;
        if (Object.keys(own).length && typeof p.id === "string") {
          const parsed = TemplatePageHintSchema.safeParse(own);
          if (parsed.success) hints.set(p.id, { ...(hints.get(p.id) ?? {}), ...parsed.data });
        }
        return rest;
      })
    : [];
  const { build: _build, ...doc } = raw;
  return { doc: { ...doc, pages }, hints };
}

/** The "Blank" design: one empty free-form page in `format`. */
export function blankTemplate(kind: ReportKind, format: PageFormat): TemplateRow {
  const purpose: DocPurpose = format === "slide_16_9" ? "deck" : format === "square" || format === "social_191" ? "social" : "report";
  return {
    id: 0,
    companyId: null,
    kind,
    purpose,
    format,
    name: "Blank design",
    version: 1,
    theme: {},
    doc: {
      schemaVersion: 2,
      kind,
      purpose,
      format,
      meta: {},
      design: { templateId: "blank", templateVersion: 1, theme: {} },
      pages: [{ id: "p1", kind: "freeform", name: "Page 1", background: {}, elements: [] }],
      assets: [],
    },
  };
}
