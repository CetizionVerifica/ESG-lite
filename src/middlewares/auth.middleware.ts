import { Request, Response, NextFunction } from "express";
import { parseCompanyHeader, withPreferredCompany } from "../utils/activeCompany";
import { verifyToken } from "../utils/jwt";
import { CLIENT_INACTIVE_CODE, CLIENT_INACTIVE_MESSAGE, isUserClientInactive } from "../services/clientStatus";
import { sessionProblem } from "../services/sessionCheck";


export interface AuthRequest extends Request {
  user?: any;
}

export const authenticate = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    req.user = verifyToken(token);
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
  // M6: the company chosen in the account menu, honoured only where the user belongs to it.
  return withPreferredCompany(parseCompanyHeader(req.headers["x-company-id"]), () =>
    requireLiveSession(req, res, () => rejectInactiveClient(req, res, next)),
  );
};

export const SESSION_ENDED = { code: "SESSION_ENDED", message: "Your session has ended. Please sign in again." };

/**
 * The token's person must still exist with the token's role and password
 * (services/sessionCheck): a deleted person, a role change or a password
 * change ends the session at once. 401, so the app signs the person out.
 * Unlike the client-status check this fails closed: a session that can't be
 * confirmed isn't trusted.
 */
export const requireLiveSession = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let problem;
  try {
    problem = await sessionProblem(req.user);
  } catch (err) {
    console.error("Could not check the session:", err);
    return res.status(503).json({ message: "Could not check your session. Please try again." });
  }
  if (problem) return res.status(401).json(SESSION_ENDED);
  next();
};

/**
 * Stops people of a deactivated client (see services/clientStatus). 403, not
 * 401: the token is valid, the organisation is switched off. A failed lookup
 * lets the request through rather than locking everyone out.
 */
export const rejectInactiveClient = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  let inactive = false;
  try {
    inactive = await isUserClientInactive(Number(req.user?.userId), req.user?.role);
  } catch (err) {
    console.warn("Could not check the client's status:", err);
  }
  if (inactive) {
    return res.status(403).json({ code: CLIENT_INACTIVE_CODE, message: CLIENT_INACTIVE_MESSAGE });
  }
  next();
};
