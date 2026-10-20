/**
 * DS-0 · the Design Studio switch, roles and the kind guard (layer rules 1–2).
 *
 *   studioCompanyFor(req)  which company a request is about, as the KPI guard
 *                          decides it (kpiCompanyFor): a Superadmin names
 *                          `company_id` (query or body); everyone else gets their
 *                          own company. Another company's id answers 404.
 *   requireDesignStudio    403 DS_STUDIO_OFF while `company.design_studio_enabled`
 *                          is off, then 403 DS_ROLE for Users (only Admins,
 *                          Managers and Superadmins use the studio). Sets
 *                          `req.studio`. Applied to the whole /studio router
 *                          after GET /status.
 *   requireManager         403 DS_ROLE unless Manager or Superadmin (finals,
 *                          approvals, share links: 01-contracts §4 "M").
 *   requireKind(pick)      403 DS_KIND_OFF for a `sustainability` request while
 *                          KPI tracking is off. `pick` reads the kind from the
 *                          request (default: body.kind, then query.kind).
 *   assertKind(caller, k)  the same check for handlers that load a doc by id.
 *   studioStatus           GET /studio/status → {enabled, kinds}; answers when off.
 */
import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware";
import { callerSites, kpiCompanyFor, kpiTrackingEnabled } from "../kpi/guard";
import { KpiError } from "../kpi/contracts/errors";
import { AppDataSource } from "../config/data-source";
import { DsError } from "./contracts/errors";
import { REPORT_KINDS, STUDIO_EDITOR_ROLES, STUDIO_MANAGER_ROLES, type ReportKind, type StudioRoleClass } from "./contracts/enums";
import type { StudioStatus } from "./contracts";
import { handle } from "./http";

export interface StudioCaller {
  companyId: number;
  userId: number;
  role: string;
  /** 'M' for Managers and Superadmins, 'R' for Admins. */
  roleClass: StudioRoleClass;
  /** Site ids the caller may read in the company; null = every site (Superadmin). */
  sites: Set<number> | null;
  /** KPI tracking is on (the sustainability kind is available). */
  kpiEnabled: boolean;
}

export type StudioRequest = AuthRequest & { studio?: StudioCaller };

/** kpiCompanyFor with DS codes: KPI_COMPANY_REQUIRED → DS_COMPANY_REQUIRED, KPI_NOT_FOUND → DS_DOC_NOT_FOUND. */
export async function studioCompanyFor(req: AuthRequest): Promise<number> {
  try {
    return await kpiCompanyFor(req);
  } catch (err) {
    if (err instanceof KpiError) throw new DsError(err.code === "KPI_COMPANY_REQUIRED" ? "DS_COMPANY_REQUIRED" : "DS_DOC_NOT_FOUND");
    throw err;
  }
}

export const designStudioEnabled = async (companyId: number): Promise<boolean> => {
  const rows: Array<{ on: boolean }> = await AppDataSource.query(`SELECT design_studio_enabled AS "on" FROM company WHERE company_id = $1`, [companyId]);
  return rows[0]?.on === true;
};

/** Which kinds a company may use: GHG with the studio on; sustainability also needs KPI tracking (D4). */
export const studioKinds = (studioOn: boolean, kpiOn: boolean): Record<ReportKind, boolean> => ({
  ghg: studioOn,
  sustainability: studioOn && kpiOn,
});

const isEditor = (role: string) => (STUDIO_EDITOR_ROLES as readonly string[]).includes(role);
const isManager = (role: string) => (STUDIO_MANAGER_ROLES as readonly string[]).includes(role);

const fail = (req: AuthRequest, res: Response, err: unknown) => {
  if (err instanceof DsError) return res.status(err.status).json(err.toBody());
  console.error(`[studio] guard failed (user ${req.user?.userId}):`, (err as Error)?.message);
  return res.status(500).json({ message: "Internal server error" });
};

export const requireDesignStudio = async (req: StudioRequest, res: Response, next: NextFunction) => {
  try {
    const companyId = await studioCompanyFor(req);
    if (!(await designStudioEnabled(companyId))) throw new DsError("DS_STUDIO_OFF");
    const role = String(req.user?.role ?? "");
    if (!isEditor(role)) throw new DsError("DS_ROLE");
    const userId = Number(req.user?.userId) || 0;
    req.studio = {
      companyId,
      userId,
      role,
      roleClass: isManager(role) ? "M" : "R",
      sites: await callerSites(userId, role, companyId),
      kpiEnabled: await kpiTrackingEnabled(companyId),
    };
    next();
  } catch (err) {
    return fail(req, res, err);
  }
};

/** The context requireDesignStudio set (routes behind the guard only). */
export const studioCaller = (req: StudioRequest): StudioCaller => {
  if (!req.studio) throw new Error("requireDesignStudio did not run");
  return req.studio;
};

/** Finals, approvals and share links: Manager or Superadmin. */
export const requireManager = (req: StudioRequest, res: Response, next: NextFunction) => {
  if (req.studio?.roleClass !== "M") return res.status(403).json(new DsError("DS_ROLE").toBody());
  next();
};

/** Throws DS_KIND_OFF when the caller's company can't use `kind`; DS_VALIDATION for an unknown kind. */
export const assertKind = (caller: Pick<StudioCaller, "kpiEnabled">, kind: unknown): ReportKind => {
  if (!(REPORT_KINDS as readonly unknown[]).includes(kind)) throw new DsError("DS_VALIDATION", { issues: [{ path: "kind", message: `kind must be ${REPORT_KINDS.join(" or ")}` }] });
  if (kind === "sustainability" && !caller.kpiEnabled) throw new DsError("DS_KIND_OFF");
  return kind as ReportKind;
};

const kindFromRequest = (req: AuthRequest): unknown => req.body?.kind ?? (req.query as Record<string, unknown> | undefined)?.kind;

/** Route middleware: the request's kind (body, then query, or `pick`) must be usable by the company. */
export const requireKind =
  (pick: (req: AuthRequest) => unknown = kindFromRequest) =>
  (req: StudioRequest, res: Response, next: NextFunction) => {
    try {
      assertKind(studioCaller(req), pick(req));
      next();
    } catch (err) {
      return fail(req, res, err);
    }
  };

/** GET /studio/status: any role of the company; answers even when the switch is off. */
export const studioStatus = handle("status", async (req, res) => {
  const companyId = await studioCompanyFor(req);
  const enabled = await designStudioEnabled(companyId);
  const body: StudioStatus = { enabled, kinds: studioKinds(enabled, enabled && (await kpiTrackingEnabled(companyId))) };
  res.json(body);
});
