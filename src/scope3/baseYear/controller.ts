import { Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { Scope3Error } from "../contracts/errors";
import { BoundaryError } from "../boundary/errors";
import { canEditBoundary, companyForRequest } from "../boundary/access";
import { approveRecalculation, dismissRecalculation, getBaseYear, listRecalculations, previewBaseYear, putBaseYear } from "./service";

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

/** GET /scope3/base-year: any role with access to the company. */
export const getBaseYearHandler = handle("get base year", async (req, res) => {
  const companyId = await companyForRequest(req);
  res.json({ ...(await getBaseYear(companyId)), can_edit: canEditBoundary(req) });
});

/** GET /scope3/base-year/preview: the per-category totals a freeze would store (any role with access). */
export const previewBaseYearHandler = handle("preview base year", async (req, res) => {
  const companyId = await companyForRequest(req);
  res.json(await previewBaseYear(companyId, req.query));
});

/** PUT /scope3/base-year: Admin and Superadmin (D12). */
export const putBaseYearHandler = handle("set base year", async (req, res) => {
  const companyId = await companyForRequest(req);
  if (!canEditBoundary(req)) throw new BoundaryError("SCOPE3_FORBIDDEN");
  res.json(await putBaseYear(companyId, req.body ?? {}, userId(req)));
});

/** GET /scope3/recalculations?status=: any role with access to the company; only Admin and Superadmin re-check first. */
export const listRecalculationsHandler = handle("list recalculations", async (req, res) => {
  const companyId = await companyForRequest(req);
  const canEdit = canEditBoundary(req);
  res.json({ ...(await listRecalculations(companyId, req.query?.status, canEdit)), can_edit: canEdit });
});

/** POST /scope3/recalculations `{reason, note?}`: Admin and Superadmin. */
export const approveRecalculationHandler = handle("approve recalculation", async (req, res) => {
  const companyId = await companyForRequest(req);
  if (!canEditBoundary(req)) throw new BoundaryError("SCOPE3_FORBIDDEN");
  res.json(await approveRecalculation(companyId, req.body ?? {}, userId(req)));
});

/** POST /scope3/recalculations/:id/dismiss `{note?}`: Admin and Superadmin. */
export const dismissRecalculationHandler = handle("dismiss recalculation", async (req, res) => {
  const companyId = await companyForRequest(req);
  if (!canEditBoundary(req)) throw new BoundaryError("SCOPE3_FORBIDDEN");
  res.json(await dismissRecalculation(companyId, Number(req.params.id), req.body ?? {}, userId(req)));
});
