import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";
import { CLIENT_INACTIVE_CODE, CLIENT_INACTIVE_MESSAGE, isUserClientInactive } from "../services/clientStatus";


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
  return rejectInactiveClient(req, res, next);
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
