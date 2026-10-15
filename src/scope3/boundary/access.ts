/**
 * Which company a Scope 3 request is about, and whether the caller may change
 * its boundary (layer rules 2 and 3, D12).
 *   - Superadmin: `company_id` is required (query or body) and must exist.
 *   - Everyone else: their own company. A `company_id` naming a company where
 *     they have no site gives 404, the same as an id that doesn't exist.
 */
import { AppDataSource } from "../../config/data-source";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { UserRole } from "../../types/type";
import { accessibleSiteIds, resolveUserCompanyId } from "../../utils/companyScope";
import { Scope3Error } from "../contracts/errors";

export const BOUNDARY_EDITORS = new Set<string>([UserRole.ADMIN, UserRole.SUPERADMIN]);

export const canEditBoundary = (req: AuthRequest) => BOUNDARY_EDITORS.has(req.user?.role);

const toId = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : NaN;
};

export async function companyForRequest(req: AuthRequest, explicit?: unknown): Promise<number> {
  const requested = toId(explicit ?? (req.query as any)?.company_id ?? req.body?.company_id);
  if (Number.isNaN(requested)) throw new Scope3Error("SCOPE3_NOT_FOUND");
  const role = req.user?.role;

  if (role === UserRole.SUPERADMIN) {
    if (requested === null) throw new Scope3Error("SCOPE3_COMPANY_REQUIRED");
    const rows: any[] = await AppDataSource.query(`SELECT 1 FROM company WHERE company_id = $1`, [requested]);
    if (!rows.length) throw new Scope3Error("SCOPE3_NOT_FOUND");
    return requested as number;
  }

  const userId = Number(req.user?.userId);
  if (requested === null) {
    const own = await resolveUserCompanyId(userId);
    if (!own) throw new Scope3Error("SCOPE3_NOT_FOUND");
    return own;
  }
  // Internal accounts can have sites at several clients: any site of the
  // requested company is enough.
  const sites = await accessibleSiteIds(userId, role);
  const ids = sites ? [...sites] : [];
  const rows: any[] = ids.length
    ? await AppDataSource.query(`SELECT 1 FROM site WHERE company_id = $1 AND site_id = ANY($2::int[]) LIMIT 1`, [requested, ids])
    : [];
  if (!rows.length) throw new Scope3Error("SCOPE3_NOT_FOUND");
  return requested as number;
}
