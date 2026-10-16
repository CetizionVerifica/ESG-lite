import { Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { Scope3Error } from "../contracts/errors";
import { ImportError } from "../../imports/errors";
import { BoundaryError } from "../boundary/errors";
import { companyForRequest } from "../boundary/access";
import type { TokenUser } from "../../imports/plans/scope";
import { createSales, listSales, planSoldProducts, putUseProfile, updateSale } from "./service";

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

const tokenUser = (req: AuthRequest): TokenUser => ({ userId: Number(req.user?.userId) || 0, role: String(req.user?.role ?? "") });

/** The body without `company_id` (companyForRequest already read it). */
const bodyOf = (req: AuthRequest) => {
  const { company_id: _ignored, ...body } = req.body ?? {};
  return body;
};

/** GET /scope3/product-sales?year=&year_type=&site_id= */
export const getProductSales = handle("list product sales", async (req, res) => {
  const companyId = await companyForRequest(req);
  res.json(await listSales(companyId, tokenUser(req), req.query as Record<string, unknown>));
});

/** POST /scope3/product-sales `{sales: [...]}` or one sale. */
export const postProductSales = handle("create product sales", async (req, res) => {
  const companyId = await companyForRequest(req);
  res.status(201).json(await createSales(companyId, tokenUser(req), bodyOf(req)));
});

/** PUT /scope3/product-sales/:id */
export const putProductSale = handle("update product sale", async (req, res) => {
  const companyId = await companyForRequest(req);
  res.json(await updateSale(companyId, tokenUser(req), Number(req.params.id), bodyOf(req)));
});

/** PUT /scope3/products/:id/use-profile `{lifetime_uses?, eol_mix?, use_profile?}` */
export const putProductUseProfile = handle("update use profile", async (req, res) => {
  const companyId = await companyForRequest(req);
  res.json(await putUseProfile(companyId, tokenUser(req), Number(req.params.id), bodyOf(req)));
});

/** POST /scope3/sold-products/plan `{site_id, year, year_type, ghg_category}` → an import plan. */
export const postSoldProductsPlan = handle("plan sold products", async (req, res) => {
  const companyId = await companyForRequest(req);
  const result = await planSoldProducts(companyId, tokenUser(req), bodyOf(req));
  res.status(result.plan ? 201 : 200).json(result);
});
