import { Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { UserRole } from "../../types/type";
import { Scope3Error } from "../contracts/errors";
import { BoundaryError } from "./errors";
import { canEditBoundary, companyForRequest } from "./access";
import { confirmCategoryMap, getBoundary, getCategoryMap, setConsolidationApproach, updateBoundaryRow } from "./service";

type Handler = (req: AuthRequest, res: Response) => Promise<unknown>;

// Scope3Error / BoundaryError → its status and body; anything else → 500 with ids only in the log.
const handle = (name: string, fn: Handler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof Scope3Error || err instanceof BoundaryError) return res.status(err.status).json(err.toBody());
    console.error(`[scope3] ${name} failed (user ${req.user?.userId}):`, (err as Error)?.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const userId = (req: AuthRequest) => Number(req.user?.userId) || 0;

/** GET /scope3/categories: the 15 rows, any role with access to the company. */
export const listBoundary = handle("list boundary", async (req, res) => {
  const companyId = await companyForRequest(req);
  const body = await getBoundary(companyId);
  res.json({ ...body, can_edit: canEditBoundary(req), can_confirm_map: req.user?.role === UserRole.SUPERADMIN });
});

/** PUT /scope3/categories/:n: Admin and Superadmin (D12). */
export const putBoundary = handle("update boundary", async (req, res) => {
  const companyId = await companyForRequest(req);
  if (!canEditBoundary(req)) throw new BoundaryError("SCOPE3_FORBIDDEN");
  const row = await updateBoundaryRow(companyId, Number(req.params.n), req.body ?? {}, userId(req));
  res.json(row);
});

/** GET /scope3/category-map: proposals and confirmed numbers, any role with access. */
export const listCategoryMap = handle("list category map", async (req, res) => {
  const companyId = await companyForRequest(req);
  res.json(await getCategoryMap(companyId));
});

/**
 * POST /scope3/category-map `{ company_id?, confirm: [{category_id, ghg_category}] }`.
 * Superadmin only (D1): categories are shared by every client, so a
 * confirmed number applies wherever the category is used.
 */
export const postCategoryMap = handle("confirm category map", async (req, res) => {
  const companyId = await companyForRequest(req);
  if (req.user?.role !== UserRole.SUPERADMIN) throw new BoundaryError("SCOPE3_FORBIDDEN");
  res.json(await confirmCategoryMap(companyId, req.body?.confirm, userId(req)));
});

/** PUT /company/:id/consolidation-approach: Admin (own company) and Superadmin. */
export const putConsolidationApproach = handle("set consolidation approach", async (req, res) => {
  const companyId = await companyForRequest(req, req.params.id);
  if (!canEditBoundary(req)) throw new BoundaryError("SCOPE3_FORBIDDEN");
  res.json(await setConsolidationApproach(companyId, req.body?.consolidation_approach, userId(req)));
});
