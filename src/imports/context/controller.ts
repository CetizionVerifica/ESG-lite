import { Response } from "express";
import { AppDataSource } from "../../config/data-source";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { ImportError, importError, isImportError } from "../errors";
import { ActivitiesQuerySchema, ContextQuerySchema, ReadinessQuerySchema } from "../contracts";
import {
  ACTIVITY_LIMIT_DEFAULT,
  ACTIVITY_LIMIT_MAX,
  buildImportContext,
  buildReadiness,
  resolveImportScope,
  searchActivities,
} from "./service";

// IM3 · GET /imports/context, /imports/context/activities, /imports/readiness.

const caller = (req: AuthRequest) => ({ user_id: Number(req.user?.userId), role: String(req.user?.role ?? "") });

const fail = (res: Response, err: unknown, where: string) => {
  if (isImportError(err)) return res.status(err.status).json(err.toBody());
  console.error(`${where}:`, err);
  return res.status(500).json({ code: "INTERNAL", message: "Could not load the import context" });
};

const invalid = (res: Response, issues: unknown) => importError(res, "IMPORT_VALIDATION", issues);

export const getImportContext = async (req: AuthRequest, res: Response) => {
  const parsed = ContextQuerySchema.safeParse(req.query);
  if (!parsed.success) return invalid(res, parsed.error.issues);
  try {
    const scope = await resolveImportScope(caller(req), parsed.data.company_id);
    return res.status(200).json(await buildImportContext(scope));
  } catch (err) {
    return fail(res, err, "getImportContext");
  }
};

export const getImportActivities = async (req: AuthRequest, res: Response) => {
  const parsed = ActivitiesQuerySchema.safeParse(req.query);
  const company = ContextQuerySchema.safeParse(req.query);
  if (!parsed.success) return invalid(res, parsed.error.issues);
  if (!company.success) return invalid(res, company.error.issues);
  const { site_id, category_id, q } = parsed.data;
  const limit = Math.min(parsed.data.limit ?? ACTIVITY_LIMIT_DEFAULT, ACTIVITY_LIMIT_MAX);
  try {
    const who = caller(req);
    // A Superadmin may name the client, or let the site decide.
    const company_id = company.data.company_id ?? (who.role === "Superadmin" ? await companyOfSite(site_id) : undefined);
    const scope = await resolveImportScope(who, company_id);
    return res.status(200).json(await searchActivities(scope, site_id, category_id, q, limit));
  } catch (err) {
    return fail(res, err, "getImportActivities");
  }
};

export const getImportReadiness = async (req: AuthRequest, res: Response) => {
  const parsed = ReadinessQuerySchema.safeParse(req.query);
  if (!parsed.success) return invalid(res, parsed.error.issues);
  try {
    const scope = await resolveImportScope(caller(req), parsed.data.company_id);
    return res.status(200).json(await buildReadiness(scope, parsed.data.year));
  } catch (err) {
    return fail(res, err, "getImportReadiness");
  }
};

async function companyOfSite(site_id: number): Promise<number | undefined> {
  const rows = await AppDataSource.query(`SELECT company_id FROM site WHERE site_id = $1`, [site_id]);
  const id = rows[0]?.company_id;
  return id ? Number(id) : undefined;
}
