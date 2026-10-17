/**
 * How /kpi authenticates (mounted in src/index.ts): the bearer token, as every
 * route; and for the framework report downloads (GET /kpi/reports/…) also
 * `?token=`, as the GHG report does (authenticateReport), so a browser tab or
 * link can fetch the file. Everything else under /kpi still needs the header.
 */
import type { NextFunction, Response } from "express";
import { authenticate, type AuthRequest } from "../middlewares/auth.middleware";
import { authenticateReport } from "../middlewares/reportAuth.middleware";

export const kpiAuthenticate = (req: AuthRequest, res: Response, next: NextFunction) =>
  req.method === "GET" && req.path.startsWith("/reports/") ? authenticateReport(req, res, next) : authenticate(req, res, next);
