/**
 * DS-13 · save a design as a company template, a page as a company layout (RS-10 §1–2).
 *
 *   POST   /templates/from-doc   R  {docId, name, description?, tags?, lockLocked?, replaceTemplateId?} → 201 ReportTemplate
 *   POST   /layouts/from-page    R  {docId, pageId, name, lockLocked?} → 201 ReportLayout
 *   DELETE /templates/:id        R  archive a company template (system templates are 404)
 *
 * A company template is a `report_template` row with `company_id` = the caller's company (DS-4
 * lists it beside the system ones; DS-5 builds from it). Its doc is the design as it is now,
 * bindings included (they resolve again for each new design), and every free-form page also
 * becomes a company layout of the template's family ("Add page" offers them).
 *
 * Template locks: with `lockLocked` (default true) elements the author locked (`locked`) become
 * `templateLocked` for everyone who uses the template; the editor won't move or edit them, and
 * with brand controls on an Admin can't unlock them (locks.ts).
 *
 * Re-saving over a template (`replaceTemplateId`) writes version n+1 with the same slug and
 * archives version n, as DS-4's seed loader does, so designs made from n keep their own copy.
 */
import { randomBytes } from "crypto";
import { AppDataSource } from "../../config/data-source";
import { DsError, LayoutFromPageBodySchema, ReportDocSchema, TemplateFromDocBodySchema, dsDocInvalid, type ReportDoc, type ReportLayout, type ReportTemplate } from "../contracts";
import type { StudioCaller } from "../guard";
import { parse } from "../http";
import { loadDocRow } from "../docs/store";
import { getTemplate, listLayouts } from "../library/service";

type Json = Record<string, any>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Pure: locked → templateLocked (when asked), and per-design marks dropped (AI review state, drift hashes). */
export function templatePage<P extends Json>(page: P, lockLocked: boolean): P {
  const p: Json = clone(page);
  if (Array.isArray(p.elements)) {
    p.elements = p.elements.map((e: Json) => {
      const next = { ...e };
      delete next.basedOnHash;
      delete next.reviewed;
      if (lockLocked && next.locked) {
        next.templateLocked = true;
        delete next.locked;
      }
      return next;
    });
  }
  return p as P;
}

/** Pure: the page as a layout page, element ids `<pageId>.<slot>` (DS-4 pageFromLayout strips the prefix). */
export function layoutPage<P extends Json>(page: P, lockLocked: boolean): P {
  const p: Json = templatePage(page, lockLocked);
  const prefix = `${p.id}.`;
  if (Array.isArray(p.elements)) p.elements = p.elements.map((e: Json) => (String(e.id).startsWith(prefix) ? e : { ...e, id: `${prefix}${e.id}` }));
  return p as P;
}

const LAYOUT_KIND_DATA = ["chart", "table", "kpi_tile", "big_number", "progress"];
const pageKindFor = (page: Json, known: Map<string, string>): string => {
  if (page.layoutId && known.has(page.layoutId)) return known.get(page.layoutId) as string;
  return (page.elements ?? []).some((e: Json) => LAYOUT_KIND_DATA.includes(e.type)) ? "data_page" : "blank";
};

const roleFor = (page: Json, i: number) => `${String(i + 1).padStart(2, "0")}-${String(page.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "page"}`;

async function knownLayoutKinds(slugs: string[]): Promise<Map<string, string>> {
  if (!slugs.length) return new Map();
  const rows: Json[] = await AppDataSource.query(`SELECT DISTINCT ON (slug) slug, page_kind FROM report_layout WHERE slug = ANY($1::varchar[]) ORDER BY slug, version DESC`, [slugs]);
  return new Map(rows.map((r) => [String(r.slug), String(r.page_kind)]));
}

const validDoc = (draft: Json): ReportDoc => {
  const r = ReportDocSchema.safeParse(draft);
  if (!r.success) throw dsDocInvalid(r.error.issues);
  return r.data;
};

export async function templateFromDoc(caller: StudioCaller, rawBody: unknown): Promise<ReportTemplate> {
  const b = parse(TemplateFromDocBodySchema, rawBody ?? {});
  const row = await loadDocRow(caller, b.docId);
  const lockLocked = b.lockLocked !== false;
  const source = validDoc(row.draft);
  const doc = clone(source) as unknown as Json;
  doc.pages = doc.pages.map((p: Json) => (p.kind === "freeform" ? templatePage(p, lockLocked) : p));
  delete doc.source; // a resized copy's link to its source doesn't carry into a template
  validDoc(doc);

  let slug = `c${caller.companyId}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  let version = 1;
  if (b.replaceTemplateId) {
    const [old]: Json[] = await AppDataSource.query(`SELECT slug, version, kind FROM report_template WHERE id = $1 AND company_id = $2`, [b.replaceTemplateId, caller.companyId]);
    if (!old) throw new DsError("DS_LAYOUT_NOT_FOUND");
    if (old.kind !== source.kind) throw new DsError("DS_VALIDATION", { issues: [{ path: "replaceTemplateId", message: "That template is for the other report kind" }] });
    slug = String(old.slug);
    const [mx]: Json[] = await AppDataSource.query(`SELECT MAX(version) AS v FROM report_template WHERE slug = $1`, [slug]);
    version = Number(mx?.v ?? 0) + 1;
  }
  const known = await knownLayoutKinds(doc.pages.map((p: Json) => p.layoutId).filter(Boolean));
  const id = await AppDataSource.transaction(async (m) => {
    if (b.replaceTemplateId) {
      await m.query(`UPDATE report_template SET is_active = false, updated_at = now() WHERE slug = $1 AND company_id = $2`, [slug, caller.companyId]);
      await m.query(`UPDATE report_layout SET is_active = false, updated_at = now() WHERE family = $1 AND company_id = $2`, [slug, caller.companyId]);
    }
    const [t]: Json[] = await m.query(
      `INSERT INTO report_template (company_id, slug, family, look, kind, purpose, format, name, description, tags, theme, doc, page_count, version, is_active, created_by)
       VALUES ($1, $2, $2, NULL, $3, $4, $5, $6, $7, $8::text[], $9::jsonb, $10::jsonb, $11, $12, true, $13) RETURNING id`,
      [
        caller.companyId,
        slug,
        source.kind,
        source.purpose,
        source.format,
        b.name,
        b.description ?? "",
        (b.tags ?? []).map((t) => t.toLowerCase()),
        JSON.stringify(source.design?.theme ?? {}),
        JSON.stringify(doc),
        doc.pages.length,
        version,
        caller.userId || null,
      ],
    );
    let sort = 0;
    for (const [i, p] of (doc.pages as Json[]).entries()) {
      if (p.kind !== "freeform") continue;
      const role = roleFor(p, i);
      await m.query(
        `INSERT INTO report_layout (company_id, slug, family, role, page_kind, kind, format, name, page, sort, version, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, true)`,
        [caller.companyId, `${slug}/${role}`, slug, role, pageKindFor(p, known), source.kind, source.format, String(p.name || `Page ${i + 1}`).slice(0, 200), JSON.stringify(layoutPage(p, false)), sort++, version],
      );
    }
    return Number(t.id);
  });
  await audit(caller, "report_template", id, b.replaceTemplateId ? "update" : "create", { name: b.name, docId: row.id, version });
  return getTemplate(caller, id);
}

export async function layoutFromPage(caller: StudioCaller, rawBody: unknown): Promise<ReportLayout> {
  const b = parse(LayoutFromPageBodySchema, rawBody ?? {});
  const row = await loadDocRow(caller, b.docId);
  const doc = validDoc(row.draft);
  const page = doc.pages.find((p) => p.id === b.pageId);
  if (!page) throw new DsError("DS_DOC_NOT_FOUND");
  if (page.kind !== "freeform") throw new DsError("DS_VALIDATION", { issues: [{ path: "pageId", message: "Only a free-form page can be saved as a layout" }] });
  const family = `c${caller.companyId}-layouts`;
  const role = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const known = await knownLayoutKinds(page.layoutId ? [page.layoutId] : []);
  const lp = layoutPage(page as unknown as Json, b.lockLocked !== false);
  const [r]: Json[] = await AppDataSource.query(
    `INSERT INTO report_layout (company_id, slug, family, role, page_kind, kind, format, name, page, sort, version, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 1000, 1, true) RETURNING id`,
    [caller.companyId, `${family}/${role}`, family, role, pageKindFor(page as unknown as Json, known), doc.kind, doc.format, b.name, JSON.stringify(lp)],
  );
  await audit(caller, "report_layout", Number(r.id), "create", { name: b.name, docId: row.id, pageId: page.id });
  const layouts = await listLayouts(caller, { kind: doc.kind, format: doc.format, template: family });
  const made = layouts.find((l) => l.id === Number(r.id));
  if (!made) throw new DsError("DS_LAYOUT_NOT_FOUND");
  return made;
}

export async function archiveTemplate(caller: StudioCaller, id: number): Promise<void> {
  const [t]: Json[] = await AppDataSource.query(`SELECT id, slug, kind FROM report_template WHERE id = $1 AND company_id = $2`, [id, caller.companyId]);
  if (!t) throw new DsError("DS_LAYOUT_NOT_FOUND");
  if (t.kind === "sustainability" && !caller.kpiEnabled) throw new DsError("DS_KIND_OFF");
  await AppDataSource.query(`UPDATE report_template SET is_active = false, updated_at = now() WHERE slug = $1 AND company_id = $2`, [t.slug, caller.companyId]);
  await AppDataSource.query(`UPDATE report_layout SET is_active = false, updated_at = now() WHERE family = $1 AND company_id = $2`, [t.slug, caller.companyId]);
  await audit(caller, "report_template", id, "archive", {});
}

const audit = (caller: StudioCaller, entity: string, id: number, action: string, fields: Json) =>
  AppDataSource.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ($1, $2, $3, $4, NULL, $5)`, [entity, id, action, JSON.stringify(fields), caller.userId || null]);
