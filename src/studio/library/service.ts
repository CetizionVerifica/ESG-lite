/**
 * DS-4 · the library reads (01-contracts §4):
 *
 *   GET /studio/templates?kind=&format=&look=&q=&tag=   R → ReportTemplate[]
 *   GET /studio/templates/:id                           R → ReportTemplateDetail (doc included)
 *   GET /studio/layouts?kind=&format=&pageKind=&template=&q=   R → ReportLayout[]
 *   GET /studio/elements?group=&q=                      R → ElementTemplate[]
 *
 * Visible: system rows (company_id null) and the caller's company's rows,
 * active only. `q` matches the name, the description and the tags
 * (case-insensitive). The sustainability kind needs KPI tracking: asking for
 * it answers DS_KIND_OFF, and without a `kind` filter those rows are left out.
 * Another company's template id answers 404.
 * Thumbnails: `thumbnail_key` is set by DS-11 thumbnail jobs; until then null.
 */
import { AppDataSource } from "../../config/data-source";
import { r2Enabled, r2PublicUrl } from "../../config/r2";
import {
  DsError,
  ElementsQuerySchema,
  LayoutsQuerySchema,
  TemplatesQuerySchema,
  type ElementTemplate,
  type ReportDoc,
  type ReportKind,
  type ReportLayout,
  type ReportTemplate,
  type ReportTemplateDetail,
} from "../contracts";
import { ELEMENT_GROUPS } from "../contracts/library";
import { assertKind, type StudioCaller } from "../guard";
import { parse, routeId } from "../http";

type Row = Record<string, any>;

const thumb = (key: string | null) => (key && r2Enabled() ? r2PublicUrl(key) : null);
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Kinds the caller may see: a kind filter is checked (DS_KIND_OFF); without one, sustainability needs KPI tracking. */
function kindsFor(caller: StudioCaller, kind: ReportKind | undefined): ReportKind[] {
  if (kind) return [assertKind(caller, kind)];
  return caller.kpiEnabled ? ["ghg", "sustainability"] : ["ghg"];
}

const LOOK_ORDER = `CASE look WHEN 'classic' THEN 1 WHEN 'light' THEN 2 WHEN 'night' THEN 3 ELSE 4 END`;

const toTemplate = (r: Row): ReportTemplate => ({
  id: Number(r.id),
  companyId: r.company_id === null ? null : Number(r.company_id),
  kind: r.kind,
  purpose: r.purpose,
  format: r.format,
  name: r.name,
  tags: r.tags ?? [],
  version: Number(r.version),
  thumbnailUrl: thumb(r.thumbnail_key),
  pageCount: Number(r.page_count),
  slug: r.slug,
  family: r.family,
  look: r.look ?? null,
  description: r.description ?? "",
});

const T_COLS = `id, company_id, slug, family, look, kind, purpose, format, name, description, tags, version, thumbnail_key, page_count`;

export async function listTemplates(caller: StudioCaller, query: unknown): Promise<ReportTemplate[]> {
  const q = parse(TemplatesQuerySchema, query ?? {});
  const params: unknown[] = [caller.companyId, kindsFor(caller, q.kind)];
  const where = [`(company_id IS NULL OR company_id = $1)`, `is_active`, `kind = ANY($2)`];
  if (q.format) where.push(`format = $${params.push(q.format)}`);
  if (q.look) where.push(`look = $${params.push(q.look)}`);
  if (q.tag) where.push(`$${params.push(q.tag.toLowerCase())} = ANY(tags)`);
  if (q.q) {
    const n = params.push(like(q.q));
    where.push(`(name ILIKE $${n} OR description ILIKE $${n} OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE $${n}))`);
  }
  const rows: Row[] = await AppDataSource.query(
    `SELECT ${T_COLS} FROM report_template WHERE ${where.join(" AND ")} ORDER BY kind, company_id NULLS FIRST, family, ${LOOK_ORDER}, id`,
    params,
  );
  return rows.map(toTemplate);
}

export async function getTemplate(caller: StudioCaller, idParam: unknown): Promise<ReportTemplateDetail> {
  const id = routeId(idParam);
  const [row]: Row[] = await AppDataSource.query(`SELECT ${T_COLS}, doc FROM report_template WHERE id = $1 AND (company_id IS NULL OR company_id = $2)`, [id, caller.companyId]);
  if (!row) throw new DsError("DS_LAYOUT_NOT_FOUND");
  assertKind(caller, row.kind);
  return { ...toTemplate(row), doc: row.doc as ReportDoc };
}

/** The doc of a template by slug or id (DS-5 builds from it). */
export async function templateDoc(caller: StudioCaller, ref: number | string): Promise<{ template: ReportTemplate; doc: ReportDoc }> {
  const byId = typeof ref === "number" || /^\d+$/.test(String(ref));
  const [row]: Row[] = await AppDataSource.query(
    `SELECT ${T_COLS}, doc FROM report_template WHERE ${byId ? "id = $1" : "slug = $1 AND is_active"} AND (company_id IS NULL OR company_id = $2) ORDER BY version DESC LIMIT 1`,
    [byId ? Number(ref) : String(ref), caller.companyId],
  );
  if (!row) throw new DsError("DS_LAYOUT_NOT_FOUND");
  assertKind(caller, row.kind);
  return { template: toTemplate(row), doc: row.doc as ReportDoc };
}

const toLayout = (r: Row): ReportLayout => ({
  id: Number(r.id),
  companyId: r.company_id === null ? null : Number(r.company_id),
  kind: r.kind,
  format: r.format,
  pageKind: r.page_kind,
  name: r.name,
  thumbnailUrl: thumb(r.thumbnail_key),
  page: r.page,
  slug: r.slug,
  family: r.family,
  role: r.role,
  sort: Number(r.sort),
});

export async function listLayouts(caller: StudioCaller, query: unknown): Promise<ReportLayout[]> {
  const q = parse(LayoutsQuerySchema, query ?? {});
  const params: unknown[] = [caller.companyId, kindsFor(caller, q.kind)];
  const where = [`(company_id IS NULL OR company_id = $1)`, `is_active`, `kind = ANY($2)`];
  if (q.format) where.push(`format = $${params.push(q.format)}`);
  if (q.pageKind) where.push(`page_kind = $${params.push(q.pageKind)}`);
  if (q.template) {
    // A template slug (`ghg-inventory-night`) names its family.
    const n = params.push(q.template);
    where.push(`(family = $${n} OR family = (SELECT family FROM report_template WHERE slug = $${n} AND (company_id IS NULL OR company_id = $1) ORDER BY version DESC LIMIT 1))`);
  }
  if (q.q) {
    const n = params.push(like(q.q));
    where.push(`(name ILIKE $${n} OR role ILIKE $${n} OR page_kind ILIKE $${n})`);
  }
  const rows: Row[] = await AppDataSource.query(
    `SELECT id, company_id, slug, family, role, page_kind, kind, format, name, page, thumbnail_key, sort FROM report_layout WHERE ${where.join(" AND ")} ORDER BY kind, family, sort, id`,
    params,
  );
  return rows.map(toLayout);
}

const GROUP_ORDER = `array_position(ARRAY[${ELEMENT_GROUPS.map((g) => `'${g}'`).join(",")}]::varchar[], "group")`;

export async function listElements(caller: StudioCaller, query: unknown): Promise<ElementTemplate[]> {
  const q = parse(ElementsQuerySchema, query ?? {});
  const params: unknown[] = [caller.companyId];
  const where = [`(company_id IS NULL OR company_id = $1)`, `is_active`];
  if (q.group) where.push(`"group" = $${params.push(q.group)}`);
  if (q.q) {
    const n = params.push(like(q.q));
    where.push(`(name ILIKE $${n} OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE $${n}))`);
  }
  const rows: Row[] = await AppDataSource.query(`SELECT id, company_id, "group", name, tags, payload, license FROM report_element WHERE ${where.join(" AND ")} ORDER BY ${GROUP_ORDER}, sort, id`, params);
  return rows.map((r) => ({ id: Number(r.id), companyId: r.company_id === null ? null : Number(r.company_id), group: r.group, name: r.name, tags: r.tags ?? [], payload: r.payload, license: r.license }));
}
