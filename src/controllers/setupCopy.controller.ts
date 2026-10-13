import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { BUNDLE_MAX_BYTES, CopyOptions, SetupBundle, SiteTarget, copySetup, readBundle, validateBundle } from "../services/setupCopy";

// Copy client setup (Superadmin): download a client's setup as a .json
// bundle, preview what a copy would create, and apply it. See
// docs/setup-copy.md. Only ids are logged, never bundle contents.

const parseId = (v: unknown): number | null => {
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "client";

/** GET /admin/companies/:id/setup-bundle — the client's setup as a downloadable .json file. */
export const downloadSetupBundle = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid company id" });
    const bundle = await readBundle(id);
    if (!bundle) return res.status(404).json({ message: "Company not found" });
    res.setHeader("Content-Disposition", `attachment; filename="esglite-setup-${slug(bundle.source.company_name)}-${bundle.source.taken_at.slice(0, 10)}.json"`);
    return res.status(200).json(bundle);
  } catch (error) {
    console.error("Setup bundle download error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

type SourceBody = { company_id?: unknown; bundle?: unknown };

/**
 * The bundle a request copies from: `{ source: { company_id } }` reads the
 * client live, `{ source: { bundle } }` takes an uploaded file. Returns the
 * bundle, or the response already sent.
 */
async function resolveSource(req: AuthRequest, res: Response): Promise<SetupBundle | null> {
  const source = (req.body?.source ?? {}) as SourceBody;
  if (source.bundle !== undefined) {
    if (Buffer.byteLength(JSON.stringify(source.bundle)) > BUNDLE_MAX_BYTES) {
      res.status(413).json({ message: "The setup file is too large" });
      return null;
    }
    const problems = validateBundle(source.bundle);
    if (problems.length) {
      res.status(400).json({ message: "The setup file can't be read", problems });
      return null;
    }
    const bundle = source.bundle as SetupBundle;
    // A file carries ids from wherever it was taken; only its names are used here.
    return { ...bundle, source: { ...bundle.source, company_id: null }, material_factors: bundle.material_factors ?? [] };
  }
  const companyId = parseId(source.company_id);
  if (!companyId) {
    res.status(400).json({ message: "source.company_id or source.bundle is required" });
    return null;
  }
  const bundle = await readBundle(companyId);
  if (!bundle) {
    res.status(404).json({ message: "Source company not found" });
    return null;
  }
  return bundle;
}

const parseOptions = (raw: unknown): CopyOptions | string => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: CopyOptions = {};
  if (o.sites !== undefined) {
    if (!Array.isArray(o.sites)) return "options.sites must be a list";
    out.sites = [];
    for (const s of o.sites as Record<string, unknown>[]) {
      const target = s?.target;
      const ok = target === "create" || target === "main" || target === "skip" || (typeof target === "number" && Number.isInteger(target));
      if (typeof s?.key !== "string" || !ok) return "each options.sites item needs a key and a target (create, main, skip or a site id)";
      out.sites.push({ key: s.key, target: target as SiteTarget });
    }
  }
  if (o.include !== undefined) {
    if (!o.include || typeof o.include !== "object") return "options.include must be an object";
    out.include = {};
    for (const [k, v] of Object.entries(o.include as Record<string, unknown>)) {
      if (typeof v !== "boolean") return `options.include.${k} must be true or false`;
      (out.include as Record<string, boolean>)[k] = v;
    }
  }
  if (o.factor_years !== undefined && o.factor_years !== null) {
    if (!Array.isArray(o.factor_years) || !o.factor_years.every((y) => Number.isInteger(y))) return "options.factor_years must be a list of years";
    out.factor_years = o.factor_years as number[];
  }
  if (o.form_conflict !== undefined) {
    if (o.form_conflict !== "skip" && o.form_conflict !== "rename") return "options.form_conflict must be skip or rename";
    out.form_conflict = o.form_conflict;
  }
  return out;
};

/** POST /admin/setup-copy/preview — what a copy would create; nothing is written. */
export const previewSetupCopy = async (req: AuthRequest, res: Response) => {
  try {
    const options = parseOptions(req.body?.options);
    if (typeof options === "string") return res.status(400).json({ message: options });
    const rawTarget = req.body?.target_company_id;
    const targetId = rawTarget === undefined || rawTarget === null ? null : parseId(rawTarget);
    if (rawTarget !== undefined && rawTarget !== null && !targetId) return res.status(400).json({ message: "Invalid target_company_id" });
    const bundle = await resolveSource(req, res);
    if (!bundle) return;
    const outcome = await copySetup(bundle, targetId, options, { dryRun: true, actorUserId: Number(req.user?.userId) || null });
    if (outcome.status === "not_found") return res.status(404).json({ message: "Target company not found" });
    if (outcome.status === "inactive") return res.status(409).json({ message: "The target client is inactive", code: "CLIENT_INACTIVE" });
    return res.status(200).json(outcome.report);
  } catch (error) {
    console.error("Setup copy preview error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /admin/companies/:id/setup-copy — apply the copy to client :id in one transaction. */
export const applySetupCopy = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid company id" });
    const options = parseOptions(req.body?.options);
    if (typeof options === "string") return res.status(400).json({ message: options });
    const bundle = await resolveSource(req, res);
    if (!bundle) return;
    const actor = Number(req.user?.userId) || null;
    const outcome = await copySetup(bundle, id, options, { dryRun: false, actorUserId: actor });
    if (outcome.status === "not_found") return res.status(404).json({ message: "Target company not found" });
    if (outcome.status === "inactive") return res.status(409).json({ message: "The target client is inactive", code: "CLIENT_INACTIVE" });
    if (outcome.report.errors.length) return res.status(400).json({ message: "The copy can't run as asked", report: outcome.report });
    console.log(
      `Setup copy: company ${bundle.source.company_id ?? "(file)"} -> company ${id} by user ${actor}: ${outcome.report.totals.create} created, ${outcome.report.totals.skip} skipped`,
    );
    return res.status(200).json(outcome.report);
  } catch (error) {
    console.error("Setup copy apply error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
