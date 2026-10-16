import { Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { Scope3Error } from "../contracts/errors";
import { BoundaryError } from "../boundary/errors";
import { companyForRequest } from "../boundary/access";
import { copyLibrary, listCurrencies, listDeflators, listLibrary, rateFor, uploadDeflators } from "./service";

type Handler = (req: AuthRequest, res: Response) => Promise<unknown>;

// Scope3Error / BoundaryError → its status and body; anything else → 500 with ids only in the log.
const handle = (name: string, fn: Handler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof Scope3Error || err instanceof BoundaryError) return res.status(err.status).json(err.toBody());
    console.error(`[scope3] ${name} failed (user ${req.user?.userId}):`, (err as Error)?.name);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const userOf = (req: AuthRequest) => ({ userId: Number(req.user?.userId) || 0, role: String(req.user?.role ?? "") });

/** GET /fx-rates/currencies: any signed-in user. */
export const getCurrencies = handle("list currencies", async (_req, res) => {
  res.json(listCurrencies());
});

/** GET /fx-rates?currency&date[&to&price_year]: any signed-in user (rates are public data). */
export const getFxRate = handle("read fx rate", async (req, res) => {
  res.json(await rateFor(req.query));
});

/** GET /scope3/deflators: any signed-in user. */
export const getDeflators = handle("list deflators", async (req, res) => {
  res.json(await listDeflators(req.query));
});

/** POST /scope3/deflators: Superadmin. */
export const postDeflators = handle("save deflators", async (req, res) => {
  res.status(201).json(await uploadDeflators(userOf(req), req.body));
});

/** GET /scope3/spend/library: any signed-in user (public USEEIO data). */
export const getLibrary = handle("list spend library", async (req, res) => {
  res.json(await listLibrary(req.query));
});

/** POST /scope3/spend/library/copy: Manager and above, own sites; Superadmin passes company_id. */
export const postLibraryCopy = handle("copy spend library", async (req, res) => {
  const companyId = await companyForRequest(req);
  const { company_id: _ignored, ...body } = req.body ?? {};
  res.status(201).json(await copyLibrary(companyId, userOf(req), body));
});
