import { Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { Scope3Error } from "../contracts/errors";
import { ImportError } from "../../imports/errors";
import { BoundaryError } from "../boundary/errors";
import { companyForRequest } from "../boundary/access";
import { listSurveySites, planSurvey } from "./survey";

type Handler = (req: AuthRequest, res: Response) => Promise<unknown>;

// Scope3Error / BoundaryError / ImportError → its status and body; anything else → 500 with ids only in the log.
const handle = (name: string, fn: Handler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof Scope3Error || err instanceof BoundaryError || err instanceof ImportError) return res.status(err.status).json(err.toBody());
    console.error(`[scope3] ${name} failed (user ${req.user?.userId}):`, (err as Error)?.name);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * POST /scope3/commuting/surveys → an import plan (one yearly Category 7 row
 * per mode). Manager and above, on their own sites; Superadmin passes company_id.
 */
export const postCommutingSurvey = handle("plan commuting survey", async (req, res) => {
  const companyId = await companyForRequest(req);
  const { company_id: _ignored, ...body } = req.body ?? {};
  const result = await planSurvey(companyId, { userId: Number(req.user?.userId) || 0, role: req.user?.role }, body);
  res.status(result.plan ? 201 : 200).json(result);
});

/** GET /scope3/commuting/sites: the caller's sites with a Category 7 category. Manager and above. */
export const getCommutingSites = handle("list commuting sites", async (req, res) => {
  const companyId = await companyForRequest(req);
  res.json(await listSurveySites(companyId, { userId: Number(req.user?.userId) || 0, role: req.user?.role }));
});
