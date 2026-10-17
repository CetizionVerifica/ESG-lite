// SE-6 · Form templates and copy (src/forms/templates.ts). Superadmin only (admin routes).
import type { Response } from "express";
import { AppDataSource } from "../config/data-source";
import type { AuthRequest } from "../middlewares/auth.middleware";
import { applyToSites, deleteTemplate, listTemplates, previewApply, renameTemplate, saveTemplate, seedFromGlobal, TemplateError } from "../forms/templates";
import { parseCheckYear } from "../forms/versions";

const idOf = (raw: unknown): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Runs a handler, answering a TemplateError with its status and field. */
const handle =
  (what: string, fn: (req: AuthRequest, res: Response) => Promise<unknown>) =>
  async (req: AuthRequest, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof TemplateError) {
        return res.status(err.status).json({ message: err.message, ...(err.field ? { field: err.field } : {}), ...(err.status === 400 ? { code: "FIELD_INVALID" } : {}) });
      }
      console.error(`Form templates: ${what} error:`, err);
      return res.status(500).json({ message: "Internal server error" });
    }
  };

const yearOr400 = (req: AuthRequest, res: Response): number | null => {
  const year = parseCheckYear(req.query.year ?? req.body?.year);
  if (year.ok) return year.year;
  res.status(400).json({ message: year.message, code: "FIELD_INVALID", field: "year" });
  return null;
};

/** GET /admin/form-templates?category_id=&company_id= : a client's own and the global templates. */
export const getFormTemplates = handle("list", async (req, res) => {
  const category_id = req.query.category_id === undefined ? undefined : idOf(req.query.category_id);
  const company_id = req.query.company_id === undefined ? undefined : idOf(req.query.company_id);
  if (category_id === null) return res.status(400).json({ message: "category_id must be a category id.", code: "FIELD_INVALID", field: "category_id" });
  if (company_id === null) return res.status(400).json({ message: "company_id must be a client id.", code: "FIELD_INVALID", field: "company_id" });
  res.json({ templates: await listTemplates(AppDataSource.manager, { category_id, company_id }) });
});

/** POST /admin/form-templates {form_id, name, company_id?}: "Save as template". company_id null = every client. */
export const createFormTemplate = handle("save", async (req, res) => {
  const t = await saveTemplate(AppDataSource.manager, req.body ?? {}, req.user?.userId ?? null);
  res.status(201).json({ message: `Template "${t.name}" saved.`, template: { id: t.id, name: t.name, company_id: t.company_id, category_id: t.category_id, category_name: t.category_name } });
});

/** PUT /admin/form-templates/:id {name}: rename. */
export const renameFormTemplate = handle("rename", async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(404).json({ message: "Template not found" });
  const t = await renameTemplate(AppDataSource.manager, id, req.body?.name);
  res.json({ message: `Template renamed to "${t.name}".`, template: { id: t.id, name: t.name } });
});

/** DELETE /admin/form-templates/:id: forms made from it stay. */
export const deleteFormTemplate = handle("delete", async (req, res) => {
  const id = idOf(req.params.id);
  if (!id || !(await deleteTemplate(AppDataSource.manager, id))) return res.status(404).json({ message: "Template not found" });
  res.json({ message: "Template deleted. Forms made from it stay as they are." });
});

/** POST /admin/form-templates/apply/preview {template_id | form_id, site_ids} ?year: each target's action and SE-4 check. */
export const previewFormTemplateApply = handle("preview", async (req, res) => {
  const year = yearOr400(req, res);
  if (year === null) return;
  res.json(await previewApply(AppDataSource.manager, req.body ?? {}, year));
});

/** POST /admin/form-templates/apply {template_id | form_id, site_ids, note?} ?year: write the targets that pass. */
export const applyFormTemplate = handle("apply", async (req, res) => {
  const year = yearOr400(req, res);
  if (year === null) return;
  const r = await applyToSites(AppDataSource.manager, req.body ?? {}, { year, userId: req.user?.userId ?? null });
  const applied = r.targets.filter((t) => t.status === "applied").length;
  res.json({ ...r, message: `Applied to ${applied} of ${r.targets.length} ${r.targets.length === 1 ? "site" : "sites"}.` });
});

/** POST /admin/form-templates/seed {company_id, dry_run?} ?year: the client's sites get global templates where they have no form. */
export const seedFormTemplates = handle("seed", async (req, res) => {
  const year = yearOr400(req, res);
  if (year === null) return;
  const company_id = idOf(req.body?.company_id);
  if (!company_id) return res.status(400).json({ message: "company_id must be a client id.", code: "FIELD_INVALID", field: "company_id" });
  const targets = await seedFromGlobal(AppDataSource.manager, company_id, { year, userId: req.user?.userId ?? null, dryRun: req.body?.dry_run === true });
  res.json({ targets });
});
