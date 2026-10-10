import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthRequest, rejectInactiveClient } from "./auth.middleware";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

// Report PDFs are opened/downloaded directly in a browser tab, which cannot
// send an Authorization header. So we accept the JWT from the header OR a
// `?token=` query param. Same signing secret as the main auth middleware.
export const authenticateReport = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.split(" ")[1]
    : (req.query.token as string | undefined);

  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
  return rejectInactiveClient(req, res, next);
};
