/**
 * DS-4 · the seed loader: data/studio/** → report_template, report_layout,
 * report_element (system rows, company_id null). Run by
 * `npm run migrate:ds-4-library` (and so by migrate:all on every start).
 *
 *   readLibrarySeeds(dir?)        reads and validates every seed file; throws on the first
 *                                 problem (a template doc or layout that fails ReportDocSchema
 *                                 for its format, an element that fails ElementSchema, an
 *                                 unknown licence). Pure apart from reading files.
 *   loadLibrarySeeds(manager)     upserts by (slug, version) for templates and layouts and by
 *                                 slug for elements. Unchanged rows aren't written; a changed row
 *                                 of the same version is updated; a new version is a new row and
 *                                 older versions of that slug turn inactive (docs keep their own
 *                                 copy, so a new version never changes an existing doc). System
 *                                 slugs no longer in the files turn inactive. Idempotent.
 */
import fs from "fs";
import path from "path";
import type { EntityManager } from "typeorm";
import { ElementSchema, LOOKS, ReportDocSchema, type ElementPayload, type FreeformPage, type ReportDoc } from "../contracts";
import { ELEMENT_GROUPS } from "../contracts/library";
import { composeTemplateDoc, layoutSlug, templateSlug, type LayoutFile } from "./compose";
import type { TemplateSeed } from "./seeds/kit";

type Row = Record<string, any>;

export const STUDIO_DATA_DIR = (): string => {
  const candidates = [path.resolve(__dirname, "../../../data/studio"), path.resolve(process.cwd(), "data/studio")];
  const found = candidates.find((d) => fs.existsSync(path.join(d, "templates")));
  if (!found) throw new Error(`data/studio not found (looked in ${candidates.join(", ")})`);
  return found;
};

export interface TemplateRowSeed {
  slug: string;
  family: string;
  look: string;
  kind: string;
  purpose: string;
  format: string;
  name: string;
  description: string;
  tags: string[];
  theme: Record<string, unknown>;
  doc: ReportDoc;
  page_count: number;
  version: number;
}
export interface LayoutRowSeed {
  slug: string;
  family: string;
  role: string;
  page_kind: string;
  kind: string;
  format: string;
  name: string;
  page: FreeformPage;
  sort: number;
  version: number;
}
export interface ElementRowSeed {
  slug: string;
  group: string;
  name: string;
  tags: string[];
  payload: ElementPayload;
  license: string;
  sort: number;
}
export interface LibrarySeeds {
  templates: TemplateRowSeed[];
  layouts: LayoutRowSeed[];
  elements: ElementRowSeed[];
  licenses: string[];
}

const LOOK_NAMES: Record<string, string> = { classic: "Classic", light: "Light", night: "Night" };
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const issuesText = (issues: { path: PropertyKey[]; message: string }[]) =>
  issues
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join(".")}: ${i.message}`)
    .join("; ");

/** Licence ids declared in LICENSES.md as `## <id>` headings followed by a line `Licence id: <id>`. */
export function licenseIds(markdown: string): string[] {
  return [...markdown.matchAll(/^Licence id:\s*`?([a-z0-9-]+)`?\s*$/gim)].map((m) => m[1]);
}

/** A one-page doc around a layout page, so the full schema (frames on the format, unique ids) checks it. */
export function layoutDoc(page: FreeformPage, kind: string, format: string): unknown {
  return {
    schemaVersion: 2,
    kind,
    purpose: "report",
    format,
    meta: { title: "Layout", year: 2025, yearType: "CY", sites: "all", frameworks: [], language: "en" },
    design: { templateId: "layout", templateVersion: 1, theme: {} },
    pages: [page],
    assets: [],
  };
}

export function readLibrarySeeds(dir = STUDIO_DATA_DIR()): LibrarySeeds {
  const licenses = licenseIds(fs.readFileSync(path.join(dir, "LICENSES.md"), "utf8"));
  const templates: TemplateRowSeed[] = [];
  const layouts: LayoutRowSeed[] = [];
  const tdir = path.join(dir, "templates");
  for (const kind of fs.readdirSync(tdir).sort()) {
    if (!fs.statSync(path.join(tdir, kind)).isDirectory()) continue;
    for (const family of fs.readdirSync(path.join(tdir, kind)).sort()) {
      const fdir = path.join(tdir, kind, family);
      if (!fs.statSync(fdir).isDirectory()) continue;
      const t = readJson(path.join(fdir, "template.json")) as TemplateSeed;
      if (t.family !== family || t.kind !== kind) throw new Error(`${kind}/${family}/template.json: family and kind must match its folder`);
      const files = fs
        .readdirSync(path.join(fdir, "layouts"))
        .filter((f) => f.endsWith(".json"))
        .sort();
      const lays = files.map((f) => readJson(path.join(fdir, "layouts", f)) as LayoutFile);
      for (const l of lays) {
        const parsed = ReportDocSchema.safeParse(layoutDoc(l.page, t.kind, t.format));
        if (!parsed.success) throw new Error(`${family}/layouts/${l.role}: ${issuesText(parsed.error.issues)}`);
        layouts.push({ slug: layoutSlug(family, l.role), family, role: l.role, page_kind: l.pageKind, kind: t.kind, format: t.format, name: l.name, page: l.page, sort: l.sort, version: t.version });
      }
      for (const look of t.looks) {
        if (!(LOOKS as readonly string[]).includes(look)) throw new Error(`${family}: unknown look ${look}`);
        const doc = composeTemplateDoc(t, lays, look);
        const parsed = ReportDocSchema.safeParse(doc);
        if (!parsed.success) throw new Error(`${family} (${look}): ${issuesText(parsed.error.issues)}`);
        templates.push({
          slug: templateSlug(t, look),
          family,
          look,
          kind: t.kind,
          purpose: t.purpose,
          format: t.format,
          name: t.looks.length > 1 ? `${t.name} · ${LOOK_NAMES[look]}` : t.name,
          description: t.description,
          tags: [...t.tags, look],
          theme: { look },
          doc,
          page_count: doc.pages.length,
          version: t.version,
        });
      }
    }
  }
  const elements: ElementRowSeed[] = [];
  const edir = path.join(dir, "elements");
  let sort = 0;
  for (const group of ELEMENT_GROUPS) {
    const file = path.join(edir, `${group}.json`);
    if (!fs.existsSync(file)) continue;
    for (const e of readJson(file) as Omit<ElementRowSeed, "sort">[]) {
      if (e.group !== group) throw new Error(`elements/${group}.json: ${e.slug} has group ${e.group}`);
      if (!licenses.includes(e.license)) throw new Error(`elements/${group}.json: ${e.slug} names licence "${e.license}", which LICENSES.md doesn't list`);
      const parts = (e.payload as { type: string }).type === "group" ? (e.payload as { elements: unknown[] }).elements : [e.payload];
      for (const p of parts) {
        const parsed = ElementSchema.safeParse(p);
        if (!parsed.success) throw new Error(`elements/${group}.json: ${e.slug}: ${issuesText(parsed.error.issues)}`);
      }
      elements.push({ ...e, sort: sort++ });
    }
  }
  const seen = new Set<string>();
  for (const s of [...templates.map((t) => `t:${t.slug}`), ...layouts.map((l) => `l:${l.slug}`), ...elements.map((e) => `e:${e.slug}`)]) {
    if (seen.has(s)) throw new Error(`duplicate seed slug ${s}`);
    seen.add(s);
  }
  return { templates, layouts, elements, licenses };
}

/** JSON with sorted keys, so a row read back from jsonb compares equal to its seed. */
export const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, (val as Row)[k]])) : val));

export interface LoadCounts {
  inserted: number;
  updated: number;
  unchanged: number;
  deactivated: number;
}
const counts = (): LoadCounts => ({ inserted: 0, updated: 0, unchanged: 0, deactivated: 0 });

async function upsert<T extends object>(m: EntityManager, table: string, keyCols: string[], seeds: T[], fields: (keyof T & string)[], jsonCols: string[]): Promise<LoadCounts> {
  const c = counts();
  const rows: Row[] = await m.query(`SELECT id, ${[...new Set([...keyCols, ...fields])].map((f) => `"${f}"`).join(", ")}, is_active FROM ${table} WHERE company_id IS NULL`);
  const key = (r: Row) => keyCols.map((k) => String(r[k])).join("|");
  const byKey = new Map(rows.map((r) => [key(r), r]));
  const val = (f: string, v: unknown) => (jsonCols.includes(f) ? JSON.stringify(v) : v);
  for (const s of seeds) {
    const existing = byKey.get(key(s as Row));
    if (!existing) {
      const cols = [...new Set([...keyCols, ...fields])];
      await m.query(`INSERT INTO ${table} (${cols.map((f) => `"${f}"`).join(", ")}, company_id, is_active) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, NULL, true)`, cols.map((f) => val(f, (s as Row)[f])));
      c.inserted++;
      continue;
    }
    const same = existing.is_active === true && fields.every((f) => canon(existing[f]) === canon((s as Row)[f]));
    if (same) {
      c.unchanged++;
      continue;
    }
    await m.query(`UPDATE ${table} SET ${fields.map((f, i) => `"${f}" = $${i + 2}`).join(", ")}, is_active = true, updated_at = now() WHERE id = $1`, [existing.id, ...fields.map((f) => val(f, (s as Row)[f]))]);
    c.updated++;
  }
  // Older versions of a seeded slug, and system slugs no longer seeded, turn inactive.
  const live = new Set(seeds.map((s) => key(s as Row)));
  for (const r of rows) {
    if (r.is_active && !live.has(key(r))) {
      await m.query(`UPDATE ${table} SET is_active = false, updated_at = now() WHERE id = $1`, [r.id]);
      c.deactivated++;
    }
  }
  return c;
}

export async function loadLibrarySeeds(manager: EntityManager, seeds: LibrarySeeds = readLibrarySeeds()): Promise<{ templates: LoadCounts; layouts: LoadCounts; elements: LoadCounts }> {
  return manager.transaction(async (m) => {
    // Two servers starting at once run migrate:all together; one loads, the other waits.
    await m.query(`SELECT pg_advisory_xact_lock(hashtext('ds-4-library-seed'))`);
    const templates = await upsert(m, "report_template", ["slug", "version"], seeds.templates, ["family", "look", "kind", "purpose", "format", "name", "description", "tags", "theme", "doc", "page_count"], ["theme", "doc"]);
    const layouts = await upsert(m, "report_layout", ["slug", "version"], seeds.layouts, ["family", "role", "page_kind", "kind", "format", "name", "page", "sort"], ["page"]);
    const elements = await upsert(m, "report_element", ["slug"], seeds.elements, ["group", "name", "tags", "payload", "license", "sort"], ["payload"]);
    return { templates, layouts, elements };
  });
}
