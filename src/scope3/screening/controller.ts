import { Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { Scope3Error } from "../contracts/errors";
import { BoundaryError } from "../boundary/errors";
import { canEditBoundary, companyForRequest } from "../boundary/access";
import { getScreening, putInputs } from "./service";
import { EXTRAPOLATE_ROLES, extrapolate } from "./extrapolate";
import { suggestSectors } from "./sectors";
import { ScreeningError } from "./errors";

type Handler = (req: AuthRequest, res: Response) => Promise<unknown>;

// Scope3Error / BoundaryError / ScreeningError → its status and body; anything else → 500 with ids only in the log.
const handle = (name: string, fn: Handler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof Scope3Error || err instanceof BoundaryError || err instanceof ScreeningError) return res.status(err.status).json(err.toBody());
    console.error(`[scope3] ${name} failed (user ${req.user?.userId}):`, (err as Error)?.name, (err as { code?: string })?.code ?? "");
    return res.status(500).json({ message: "Internal server error" });
  }
};

const caller = (req: AuthRequest) => ({ userId: Number(req.user?.userId) || 0, role: String(req.user?.role ?? "") });
const withoutCompany = (body: unknown) => {
  const { company_id: _c, ...rest } = (body ?? {}) as Record<string, unknown>;
  return rest;
};

/** GET /scope3/screening?year=&year_type=: any role with access to the company. */
export const getScreeningHandler = handle("get screening", async (req, res) => {
  const companyId = await companyForRequest(req);
  const body = await getScreening(companyId, req.query, caller(req));
  res.json({ ...body, can_edit: canEditBoundary(req), can_extrapolate: EXTRAPOLATE_ROLES.has(caller(req).role) });
});

/** PUT /scope3/screening/inputs: Admin and Superadmin (D12, like the boundary). */
export const putInputsHandler = handle("save screening inputs", async (req, res) => {
  const companyId = await companyForRequest(req);
  if (!canEditBoundary(req)) throw new BoundaryError("SCOPE3_FORBIDDEN");
  res.json(await putInputs(companyId, withoutCompany(req.body), caller(req).userId));
});

/** POST /scope3/screening/sector-suggestions: up to 3 USEEIO sectors for a line (AI service). Admin and Superadmin. */
export const postSectorSuggestionsHandler = handle("suggest sectors", async (req, res) => {
  await companyForRequest(req);
  if (!canEditBoundary(req)) throw new BoundaryError("SCOPE3_FORBIDDEN");
  res.json(await suggestSectors(withoutCompany(req.body)));
});

/** POST /scope3/extrapolate (`?dry_run=1` previews without saving): Manager and above, own sites. */
export const postExtrapolateHandler = handle("extrapolate", async (req, res) => {
  const companyId = await companyForRequest(req);
  const dryRun = /^(1|true)$/i.test(String(req.query?.dry_run ?? ""));
  const result = await extrapolate(companyId, caller(req), withoutCompany(req.body), { dryRun });
  res.status(dryRun ? 200 : 201).json(result);
});
