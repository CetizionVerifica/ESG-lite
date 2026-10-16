/**
 * S3-6 · /suppliers (01-contracts.md §5), mounted in src/index.ts behind
 * `authenticate`.
 *
 * Reads: any role with access to the company's sites (layer rule 3), so the
 * add-data Supplier field works for contributors too. Changes: Manager,
 * Admin and Superadmin, on their own company (spec §Build.2). A Superadmin
 * names the company with `company_id`; anyone else gets their own, and
 * another company's ids read as 404.
 */
import { Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { UserRole } from "../../types/type";
import { Scope3Error } from "../contracts/errors";
import { BoundaryError } from "../boundary/errors";
import { companyForRequest } from "../boundary/access";
import {
  coverage,
  createFactor,
  createSupplier,
  decideNameMatch,
  getSupplier,
  listFacilityData,
  listFactors,
  listSuppliers,
  nameMatches,
  periodOf,
  updateSupplier,
  upsertFacilityData,
} from "./service";

type Handler = (req: AuthRequest, res: Response) => Promise<unknown>;

// Scope3Error / BoundaryError → its status and body; anything else → 500 with ids only in the log.
const handle = (name: string, fn: Handler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof Scope3Error || err instanceof BoundaryError) return res.status(err.status).json(err.toBody());
    console.error(`[scope3] suppliers: ${name} failed (user ${req.user?.userId}):`, (err as Error)?.name);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const EDITORS = new Set<string>([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN]);
const assertEditor = (req: AuthRequest) => {
  if (!EDITORS.has(req.user?.role)) throw new BoundaryError("SCOPE3_FORBIDDEN");
};
const canEdit = (req: AuthRequest) => EDITORS.has(req.user?.role);
const userId = (req: AuthRequest) => Number(req.user?.userId) || 0;
const idParam = (req: AuthRequest) => Number(req.params.id);
const bodyOf = (req: AuthRequest) => {
  const { company_id: _ignored, ...body } = req.body ?? {};
  return body;
};

const yearOf = (raw: unknown): number => {
  if (raw === undefined || raw === "") return new Date().getUTCFullYear();
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1990 || n > 2100) throw new BoundaryError("SCOPE3_VALIDATION", { field: "year" });
  return n;
};
const yearTypeOf = (raw: unknown): "CY" | "FY" => {
  if (raw === undefined || raw === "" || raw === "CY") return "CY";
  if (raw === "FY") return "FY";
  throw new BoundaryError("SCOPE3_VALIDATION", { field: "year_type" });
};

/** GET /suppliers?year=&year_type= */
export const getSuppliers = handle("list", async (req, res) => {
  const companyId = await companyForRequest(req);
  const list = await listSuppliers(companyId, { year: yearOf(req.query.year), yearType: yearTypeOf(req.query.year_type) });
  res.json({ ...list, can_edit: canEdit(req) });
});

/** POST /suppliers {name, country?, email?} */
export const postSupplier = handle("create", async (req, res) => {
  const companyId = await companyForRequest(req);
  assertEditor(req);
  res.status(201).json(await createSupplier(companyId, userId(req), bodyOf(req)));
});

/** GET /suppliers/:id: figures, facility data and requests. */
export const getSupplierDetail = handle("detail", async (req, res) => {
  const companyId = await companyForRequest(req);
  res.json({ ...(await getSupplier(companyId, idParam(req))), can_edit: canEdit(req) });
});

/** PUT /suppliers/:id {name?, country?, email?} */
export const putSupplier = handle("update", async (req, res) => {
  const companyId = await companyForRequest(req);
  assertEditor(req);
  res.json(await updateSupplier(companyId, userId(req), idParam(req), bodyOf(req)));
});

/** GET /suppliers/:id/factors */
export const getSupplierFactors = handle("list factors", async (req, res) => {
  const companyId = await companyForRequest(req);
  res.json(await listFactors(companyId, idParam(req)));
});

/** POST /suppliers/:id/factors {item, unit, kgco2e_per_unit, reference_year, boundary?, gwp_set?, evidence_document_id?, confirm_boundary?} */
export const postSupplierFactor = handle("create factor", async (req, res) => {
  const companyId = await companyForRequest(req);
  assertEditor(req);
  res.status(201).json(await createFactor(companyId, userId(req), idParam(req), bodyOf(req)));
});

/** GET /suppliers/:id/facility-data */
export const getFacilityData = handle("list facility data", async (req, res) => {
  const companyId = await companyForRequest(req);
  res.json(await listFacilityData(companyId, idParam(req)));
});

/** POST /suppliers/:id/facility-data {year, scope12_tco2e, output_qty, output_unit, allocation_key?} */
export const postFacilityData = handle("save facility data", async (req, res) => {
  const companyId = await companyForRequest(req);
  assertEditor(req);
  const saved = await upsertFacilityData(companyId, userId(req), idParam(req), bodyOf(req));
  res.status(saved.replaced ? 200 : 201).json(saved);
});

/** GET /suppliers/name-matches: the review list (Manager+). */
export const getNameMatches = handle("name matches", async (req, res) => {
  const companyId = await companyForRequest(req);
  assertEditor(req);
  res.json(await nameMatches(companyId));
});

/** POST /suppliers/name-matches: Link / Not the same. */
export const postNameMatch = handle("decide name match", async (req, res) => {
  const companyId = await companyForRequest(req);
  assertEditor(req);
  res.json(await decideNameMatch(companyId, userId(req), bodyOf(req)));
});

/** GET /suppliers/coverage?year=&year_type=&status=approved|all: the S3-13 read model over HTTP. */
export const getCoverage = handle("coverage", async (req, res) => {
  const companyId = await companyForRequest(req);
  const status = req.query.status === "all" ? ["approved", "pending", "draft"] : ["approved"];
  if (req.query.status !== undefined && req.query.status !== "all" && req.query.status !== "approved") {
    throw new BoundaryError("SCOPE3_VALIDATION", { field: "status" });
  }
  res.json(await coverage(companyId, periodOf(yearOf(req.query.year), yearTypeOf(req.query.year_type)), { statuses: status }));
});
