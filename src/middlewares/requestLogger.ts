import { Request, Response, NextFunction } from "express";
import { log } from "../utils/logger";

/**
 * Logs every HTTP request with method, URL, status, response time, and user ID.
 * Output: [INFO] [HTTP] POST /user/emissions 201 45ms {userId: 5}
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const userId = (req as any).user?.userId;
    const status = res.statusCode;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";

    const meta: Record<string, any> = { duration: `${duration}ms` };
    if (userId) meta.userId = userId;
    if (status >= 400) meta.status = status;

    log[level]("HTTP", `${req.method} ${req.originalUrl} ${status}`, meta);
  });

  next();
};
