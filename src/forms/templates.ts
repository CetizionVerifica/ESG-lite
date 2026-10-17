/**
 * SE-6 · Form templates and copy (ESG-lite_FE docs/simple-entry, SE-6 spec).
 *
 *   saveTemplate      a form, as SE-4 stores a version, plus its site's unit names
 *   previewApply      a template or a form on each target site: create or update, and the SE-4 check there
 *   applyToSites      writes the targets that pass (each published as a new version); the others are refused with their check
 *   seedFromGlobal    a client's sites get the global template for each category they have no form for
 *
 * A client's template (and a form) is applied to that client's sites only; a global template anywhere.
 * Choice ids and factor-match rules keep their names; a target with no matching factor shows the
 * check's error, never a silent skip.
 */
import { In, type EntityManager } from "typeorm";
import { ColumnConfig } from "../entities/ColumnConfig";
import { ColumnEntity } from "../entities/Column";
import { FormTemplate } from "../entities/FormTemplate";
import type { CheckInput } from "./check";
import { type FormCheck, publishForm, runCheck, snapshotOf, VERSIONED_KEYS } from "./versions";

export class TemplateError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

type FormColumn = { pk_id: number; column_name: string; column_type: string };
/** What is copied: the version snapshot and the unit names of the site it came from. */
type Source = { kind: "template" | "form"; id: number; name: string; company_id: number | null; category_id: number; config: Record<string, unknown>; units: string[]; site_id?: number };

const cleanName = (raw: unknown): string => {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 120) throw new TemplateError(400, "Give the template a name (up to 120 characters).", "name");
  return name;
};

const unitsOf = async (m: EntityManager, site_id: number, category_id: number): Promise<string[]> =>
  ((await m.query(`SELECT DISTINCT unit_name FROM unit WHERE site_id = $1 AND category_id = $2 ORDER BY unit_name`, [site_id, category_id])) as Array<{ unit_name: string }>).map((u) => u.unit_name);

async function companyOfSite(m: EntityManager, site_id: number): Promise<number | null> {
  const [row] = await m.query(`SELECT company_id FROM site WHERE site_id = $1`, [site_id]);
  return row ? (row.company_id ?? null) : null;
}

async function assertUnique(m: EntityManager, name: string, company_id: number | null, category_id: number, except?: number) {
  const [dup] = await m.query(
    `SELECT id FROM form_template WHERE lower(name) = lower($1) AND category_id = $2 AND company_id IS NOT DISTINCT FROM $3 AND id <> $4 LIMIT 1`,
    [name, category_id, company_id, except ?? 0],
  );
  if (dup) throw new TemplateError(409, `There is already a template called "${name}" for this category${company_id ? " and client" : ""}.`, "name");
}

/** Save a form as a template; `company_id` undefined keeps the form's client, null makes it global. */
export async function saveTemplate(m: EntityManager, input: { form_id: unknown; name: unknown; company_id?: unknown }, userId: number | null): Promise<FormTemplate> {
  const formId = Number(input.form_id);
  if (!Number.isInteger(formId) || formId <= 0) throw new TemplateError(400, "form_id must be a form id.", "form_id");
  const config = await m.getRepository(ColumnConfig).findOne({ where: { pk_id: formId }, relations: ["site", "category", "columns"] });
  if (!config) throw new TemplateError(404, "Column config not found");
  const name = cleanName(input.name);
  let company_id: number | null;
  if (input.company_id === undefined) company_id = await companyOfSite(m, config.site.site_id);
  else if (input.company_id === null) company_id = null;
  else {
    company_id = Number(input.company_id);
    const [c] = Number.isInteger(company_id) ? await m.query(`SELECT company_id FROM company WHERE company_id = $1`, [company_id]) : [];
    if (!c) throw new TemplateError(400, "company_id must be a client, or null for every client.", "company_id");
  }
  await assertUnique(m, name, company_id, config.category.category_id);
  const repo = m.getRepository(FormTemplate);
  return repo.save(
    repo.create({
      name,
      company_id,
      category_id: config.category.category_id,
      category_name: config.category.category_name,
      // `unit_names`: the site's unit list; `units` is the form's own setting (SE-2 fixed unit).
      config: { ...snapshotOf(config), unit_names: await unitsOf(m, config.site.site_id, config.category.category_id) },
      created_by: userId,
    }),
  );
}

export interface TemplateView {
  id: number;
  name: string;
  company_id: number | null;
  company_name: string | null;
  category_id: number;
  category_name: string;
  fields: number;
  created_by: { user_id: number; name: string } | null;
  created_at: Date;
}

export async function listTemplates(m: EntityManager, filter: { category_id?: number; company_id?: number } = {}): Promise<TemplateView[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.category_id) {
    params.push(filter.category_id);
    where.push(`t.category_id = $${params.length}`);
  }
  if (filter.company_id) {
    // A client sees its own templates and the global ones.
    params.push(filter.company_id);
    where.push(`(t.company_id = $${params.length} OR t.company_id IS NULL)`);
  }
  const rows: Array<Record<string, any>> = await m.query(
    `SELECT t.id, t.name, t.company_id, c.name AS company_name, t.category_id, t.category_name, jsonb_array_length(COALESCE(t.config->'columns', '[]'::jsonb)) AS fields,
            t.created_by, u.name AS first, u.last_name AS last, t.created_at
       FROM form_template t LEFT JOIN company c ON c.company_id = t.company_id LEFT JOIN "user" u ON u.user_id = t.created_by
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.category_name, lower(t.name)`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    company_id: r.company_id,
    company_name: r.company_name ?? null,
    category_id: r.category_id,
    category_name: r.category_name,
    fields: Number(r.fields) || 0,
    created_by: r.created_by ? { user_id: r.created_by, name: [r.first, r.last].filter(Boolean).join(" ") } : null,
    created_at: r.created_at,
  }));
}

export async function renameTemplate(m: EntityManager, id: number, rawName: unknown): Promise<FormTemplate> {
  const repo = m.getRepository(FormTemplate);
  const t = await repo.findOne({ where: { id } });
  if (!t) throw new TemplateError(404, "Template not found");
  const name = cleanName(rawName);
  await assertUnique(m, name, t.company_id, t.category_id, id);
  t.name = name;
  return repo.save(t);
}

/** Forms made from the template stay as they are. */
export async function deleteTemplate(m: EntityManager, id: number): Promise<boolean> {
  // data-loss-reviewed: removes one template row after the Superadmin confirms by name; forms made from it are separate rows and stay
  const result: unknown[] = await m.query(`DELETE FROM form_template WHERE id = $1 RETURNING id`, [id]);
  // A DELETE comes back as [rows, count].
  const rows = Array.isArray(result[0]) ? (result[0] as unknown[]) : result;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Apply to sites
// ---------------------------------------------------------------------------

async function loadSource(m: EntityManager, input: { template_id?: unknown; form_id?: unknown }): Promise<Source> {
  if (input.template_id != null) {
    const id = Number(input.template_id);
    const t = Number.isInteger(id) ? await m.getRepository(FormTemplate).findOne({ where: { id } }) : null;
    if (!t) throw new TemplateError(404, "Template not found");
    return { kind: "template", id: t.id, name: t.name, company_id: t.company_id, category_id: t.category_id, config: t.config, units: Array.isArray(t.config.unit_names) ? (t.config.unit_names as string[]) : [] };
  }
  const id = Number(input.form_id);
  const f = Number.isInteger(id) ? await m.getRepository(ColumnConfig).findOne({ where: { pk_id: id }, relations: ["site", "category", "columns"] }) : null;
  if (!f) throw new TemplateError(404, input.form_id == null ? "Give a template_id or a form_id." : "Column config not found");
  return {
    kind: "form",
    id: f.pk_id,
    name: f.config_name,
    company_id: await companyOfSite(m, f.site.site_id),
    category_id: f.category.category_id,
    config: snapshotOf(f),
    units: await unitsOf(m, f.site.site_id, f.category.category_id),
    site_id: f.site.site_id,
  };
}

export interface TargetResult {
  site_id: number;
  site_name: string;
  /** create: the site has no form for the category; update: its form takes the source's settings. */
  action: "create" | "update" | null;
  form_id: number | null;
  /** Rows already saved for the site × category: an update keeps their values. */
  saved_rows: number;
  check: FormCheck | null;
  /** Why the site can't take it at all (another client, category not set up, the form's own site). */
  refused?: string;
  status?: "applied" | "refused";
  version?: number;
}

/** The source as a form the check reads, with its library columns as they are now. */
async function sourceForm(m: EntityManager, src: Source): Promise<{ form: CheckInput["form"]; columns: ColumnEntity[] }> {
  const wanted = (Array.isArray(src.config.columns) ? (src.config.columns as FormColumn[]) : []).map((c) => c.pk_id);
  const columns = wanted.length ? await m.getRepository(ColumnEntity).find({ where: { pk_id: In(wanted) } }) : [];
  if (columns.length !== new Set(wanted).size) throw new TemplateError(400, "A field of this template was removed from the column library; save the template again from a form.", "template_id");
  const form: Record<string, unknown> = { columns: columns.map((c) => ({ pk_id: c.pk_id, column_name: c.column_name, column_type: c.column_type })) };
  for (const k of VERSIONED_KEYS) form[k] = src.config[k] ?? null;
  return { form: form as CheckInput["form"], columns };
}

/** Each target: what would happen and the SE-4 check there. Nothing is written. */
export async function previewApply(m: EntityManager, input: { template_id?: unknown; form_id?: unknown; site_ids?: unknown }, year: number): Promise<{ source: { kind: Source["kind"]; id: number; name: string }; targets: TargetResult[] }> {
  const src = await loadSource(m, input);
  const ids = Array.isArray(input.site_ids) ? [...new Set(input.site_ids.map(Number))] : [];
  if (!ids.length || ids.some((x) => !Number.isInteger(x) || x <= 0)) throw new TemplateError(400, "site_ids must list the sites to apply it to.", "site_ids");
  const { form } = await sourceForm(m, src);
  const sites: Array<{ site_id: number; name: string; company_id: number | null; has_category: boolean }> = await m.query(
    `SELECT s.site_id, s.name, s.company_id, EXISTS (SELECT 1 FROM site_categories sc WHERE sc.site_id = s.site_id AND sc.category_id = $2) AS has_category
       FROM site s WHERE s.site_id = ANY($1::int[])`,
    [ids, src.category_id],
  );
  const targets: TargetResult[] = [];
  for (const site_id of ids) {
    const site = sites.find((s) => s.site_id === site_id);
    if (!site) throw new TemplateError(400, `Site ${site_id} doesn't exist.`, "site_ids");
    const base = { site_id, site_name: site.name, action: null, form_id: null, saved_rows: 0, check: null } as TargetResult;
    // A client's template or form stays with that client.
    if (src.company_id !== null && site.company_id !== src.company_id) {
      targets.push({ ...base, refused: src.kind === "form" ? "This site belongs to another client: copy a form within its client, or save it as a template for every client." : "This site belongs to another client: a client's template is applied to its own sites only." });
      continue;
    }
    if (src.kind === "form" && src.site_id === site_id) {
      targets.push({ ...base, refused: "This is the form's own site." });
      continue;
    }
    if (!site.has_category) {
      targets.push({ ...base, refused: "This category isn't set up for this site." });
      continue;
    }
    const [existing] = await m.query(`SELECT pk_id FROM column_config WHERE site_id = $1 AND category_id = $2 ORDER BY config_name ASC LIMIT 1`, [site_id, src.category_id]);
    const result = await runCheck(m, form, site_id, src.category_id, year);
    const [{ n }] = await m.query(`SELECT count(*)::int AS n FROM emission WHERE site_id = $1 AND category_id = $2`, [site_id, src.category_id]);
    targets.push({ ...base, action: existing ? "update" : "create", form_id: existing?.pk_id ?? null, saved_rows: n, check: { ...result, form_id: existing?.pk_id ?? null, year, version: null } });
  }
  return { source: { kind: src.kind, id: src.id, name: src.name }, targets };
}

/**
 * Write the targets that pass the check: a new form, or the site's form taking the source's settings
 * (its name kept); missing unit names are added; each is published as a new version. A target with
 * errors, or one the site can't take, is refused and reported with its reason.
 */
export async function applyToSites(
  m: EntityManager,
  input: { template_id?: unknown; form_id?: unknown; site_ids?: unknown; note?: unknown },
  opts: { year: number; userId: number | null },
): Promise<{ source: { kind: Source["kind"]; id: number; name: string }; targets: TargetResult[] }> {
  const preview = await previewApply(m, input, opts.year);
  const src = await loadSource(m, input);
  const { columns } = await sourceForm(m, src);
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : src.kind === "template" ? `From template "${src.name}"` : `Copied from form ${src.id}`;
  for (const t of preview.targets) {
    if (t.refused || !t.check?.ok) {
      t.status = "refused";
      continue;
    }
    const formId = await m.transaction(async (tx) => {
      const repo = tx.getRepository(ColumnConfig);
      const config = t.form_id
        ? (await repo.findOne({ where: { pk_id: t.form_id }, relations: ["columns"] }))!
        : repo.create({ config_name: String(src.config.config_name ?? src.name), site: { site_id: t.site_id } as never, category: { category_id: src.category_id } as never });
      for (const k of VERSIONED_KEYS) {
        if (k === "config_name") continue; // a site's form keeps its name
        (config as unknown as Record<string, unknown>)[k] = src.config[k] ?? (k === "field_settings" ? {} : null);
      }
      config.columns = columns;
      await repo.save(config);
      const have = new Set((await unitsOf(tx, t.site_id, src.category_id)).map((u) => u.toLowerCase()));
      for (const unit of src.units) {
        if (have.has(unit.toLowerCase())) continue;
        await tx.query(`INSERT INTO unit (unit_name, site_id, category_id) VALUES ($1, $2, $3)`, [unit, t.site_id, src.category_id]);
        have.add(unit.toLowerCase());
      }
      return config.pk_id;
    });
    const published = await publishForm(m, formId, { year: opts.year, note, userId: opts.userId });
    t.form_id = formId;
    t.status = "applied";
    if (published.ok) t.version = published.version.version;
  }
  return preview;
}

/**
 * A client's sites get, for each category they report with no form yet, the newest global template
 * for it. A site whose rows were saved without a form is reported, not changed: a form would change
 * how those rows are edited and re-imported (the S3-9 standard forms leave such sites alone too).
 */
export async function seedFromGlobal(m: EntityManager, companyId: number, opts: { year: number; userId: number | null; dryRun?: boolean }): Promise<Array<{ template_id: number; template_name: string } & TargetResult>> {
  const gaps: Array<{ site_id: number; site_name: string; category_id: number; template_id: number; template_name: string; rows: number }> = await m.query(
    `SELECT DISTINCT ON (s.site_id, sc.category_id) s.site_id, s.name AS site_name, sc.category_id, t.id AS template_id, t.name AS template_name,
            (SELECT count(*)::int FROM emission e WHERE e.site_id = s.site_id AND e.category_id = sc.category_id) AS rows
       FROM site s JOIN site_categories sc ON sc.site_id = s.site_id
       JOIN form_template t ON t.category_id = sc.category_id AND t.company_id IS NULL
      WHERE s.company_id = $1 AND NOT EXISTS (SELECT 1 FROM column_config cc WHERE cc.site_id = s.site_id AND cc.category_id = sc.category_id)
      ORDER BY s.site_id, sc.category_id, t.created_at DESC, t.id DESC`,
    [companyId],
  );
  const out: Array<{ template_id: number; template_name: string } & TargetResult> = [];
  for (const g of gaps) {
    if (g.rows > 0) {
      out.push({
        template_id: g.template_id,
        template_name: g.template_name,
        site_id: g.site_id,
        site_name: g.site_name,
        action: null,
        form_id: null,
        saved_rows: g.rows,
        check: null,
        status: "refused",
        refused: `${g.rows} ${g.rows === 1 ? "row was" : "rows were"} saved here without a form; apply a template by hand once you've checked them.`,
      });
      continue;
    }
    const input = { template_id: g.template_id, site_ids: [g.site_id], note: `Seeded from global template "${g.template_name}"` };
    const r = opts.dryRun ? await previewApply(m, input, opts.year) : await applyToSites(m, input, opts);
    out.push(...r.targets.map((t) => ({ template_id: g.template_id, template_name: g.template_name, ...t })));
  }
  return out;
}
