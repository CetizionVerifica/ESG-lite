import { Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { UserRole } from "../../types/type";
import { Scope3Error } from "../contracts/errors";
import { ImportError } from "../../imports/errors";
import { BoundaryError } from "../boundary/errors";
import { canEditBoundary, companyForRequest } from "../boundary/access";
import { createInvestment, listInvestments, listLeaseSites, planInvestments, updateInvestment, updateSiteLease } from "./service";

type Handler = (req: AuthRequest, res: Response) => Promise<unknown>;

// Scope3Error / BoundaryError / ImportError → its status and body; anything else → 500 with ids only in the log.
const handle = (name: string, fn: Handler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof Scope3Error || err instanceof BoundaryError || err instanceof ImportError) return res.status(err.status).json(err.toBody());
    console.error(`[scope3] ${name} failed (user ${req.user?.userId}):`, (err as Error)?.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const userId = (req: AuthRequest) => Number(req.user?.userId) || 0;

/** Investments are read by Manager and above, changed by Admin and Superadmin (S3-11 spec). */
const READERS = new Set<string>([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN]);
const assertReader = (req: AuthRequest) => {
  if (!READERS.has(req.user?.role)) throw new BoundaryError("SCOPE3_FORBIDDEN");
};
const assertEditor = (req: AuthRequest) => {
  if (!canEditBoundary(req)) throw new BoundaryError("SCOPE3_FORBIDDEN");
};

const yearOf = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1990 || n > 2100) throw new BoundaryError("SCOPE3_VALIDATION", { field: "year" });
  return n;
};

/** GET /scope3/investments?year=: the register. */
export const getInvestments = handle("list investments", async (req, res) => {
  const companyId = await companyForRequest(req);
  assertReader(req);
  res.json({ company_id: companyId, can_edit: canEditBoundary(req), investments: await listInvestments(companyId, yearOf(req.query.year)) });
});

/** POST /scope3/investments */
export const postInvestment = handle("create investment", async (req, res) => {
  const companyId = await companyForRequest(req);
  assertEditor(req);
  const { company_id: _ignored, ...body } = req.body ?? {};
  res.status(201).json(await createInvestment(companyId, body, userId(req)));
});

/** PUT /scope3/investments/:id */
export const putInvestment = handle("update investment", async (req, res) => {
  const companyId = await companyForRequest(req);
  assertEditor(req);
  const { company_id: _ignored, ...body } = req.body ?? {};
  res.json(await updateInvestment(companyId, Number(req.params.id), body, userId(req)));
});

/** POST /scope3/investments/plan `{site_id, year, year_type, threshold_pct?}` → an import plan. */
export const postInvestmentsPlan = handle("plan investments", async (req, res) => {
  const companyId = await companyForRequest(req);
  assertEditor(req);
  const { company_id: _ignored, ...body } = req.body ?? {};
  const result = await planInvestments(companyId, { userId: userId(req), role: req.user?.role }, body);
  res.status(result.plan ? 201 : 200).json(result);
});

/** GET /scope3/assets/sites: lease fields and the boundary note per site, any role with access. */
export const getLeaseSites = handle("list lease sites", async (req, res) => {
  const companyId = await companyForRequest(req);
  res.json({ ...(await listLeaseSites(companyId)), can_edit: canEditBoundary(req) });
});

/** PUT /scope3/assets/sites/:id `{lease_role?, lease_type?, floor_area_m2?}`: Admin and Superadmin. */
export const putLeaseSite = handle("update site lease", async (req, res) => {
  const companyId = await companyForRequest(req);
  assertEditor(req);
  const { company_id: _ignored, ...body } = req.body ?? {};
  res.json(await updateSiteLease(companyId, Number(req.params.id), body, userId(req)));
});
