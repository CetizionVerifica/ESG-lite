/**
 * S3-15 part 2 · route guard: a write to a row in a closed site-month answers
 * 409 PERIOD_LOCKED (docs/scope3/review/CLAUDE.md item 8). Placed after the
 * scope guards, so another company's ids still answer 404/403 first.
 *
 *   "create"  body.site_id + body.date_of_reporting (POST /user/emissions)
 *   "param"   the row :id and its FERA family; with body.date_of_reporting,
 *             also the month the edit moves it to
 *   "ids"     body.ids[] and their families (bulk approve, reject, delete)
 *   "batch"   every row of :batchId (batch approve, reject, delete)
 *
 * With the company switch off nothing is closed (periodLock.ts), so these
 * guards change nothing for clients without the review workflow.
 */
import type { NextFunction, Response } from "express";
import { AppDataSource } from "../../config/data-source";
import type { AuthRequest } from "../../middlewares/auth.middleware";
import { lockedSiteMonths, periodLockedError, siteMonthOf, siteMonthsOfBatch, siteMonthsOfRows, type SiteMonth } from "./periodLock";
import { periodWriteLease } from "./periodLease";
import { sendScope3Error } from "../contracts/errors";

type Source = "create" | "param" | "ids" | "batch";

const toIds = (value: unknown): number[] => {
  if (value === undefined || value === null || value === "") return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list.map((v) => Number(String(v).trim())).filter((n) => Number.isInteger(n) && n > 0);
};

const periodsFor = async (req: AuthRequest, source: Source): Promise<Array<SiteMonth | null>> => {
  const m = AppDataSource.manager;
  const body = (req.body ?? {}) as Record<string, any>;
  switch (source) {
    case "create":
      return body.site_id && body.date_of_reporting ? [siteMonthOf(Number(body.site_id), body.date_of_reporting)] : [];
    case "param": {
      const ids = toIds(req.params.id);
      const items: Array<SiteMonth | null> = await siteMonthsOfRows(m, ids);
      if (ids.length && body.date_of_reporting) {
        const [row]: Array<{ site_id: number }> = await m.query(`SELECT site_id FROM emission WHERE pk_id = $1`, [ids[0]]);
        if (row) items.push(siteMonthOf(Number(row.site_id), body.date_of_reporting));
      }
      return items;
    }
    case "ids":
      return siteMonthsOfRows(m, toIds(body.ids));
    case "batch":
      return siteMonthsOfBatch(m, String(req.params.batchId ?? ""));
  }
};

/**
 * 409 PERIOD_LOCKED when the write touches a closed site-month. The check runs
 * under a write lease (periodLease.ts) held until the response ends, so a month
 * can't be locked between this check and the write committing.
 */
export const guardPeriodOpen = (source: Source) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const items = await periodsFor(req, source);
    const lease = await periodWriteLease(items);
    const release = () => void lease.release();
    res.once("finish", release);
    res.once("close", release);
    const locked = await lockedSiteMonths(AppDataSource.manager, items);
    if (locked.length) return sendScope3Error(res, periodLockedError(locked));
    next();
  } catch (error) {
    console.error("Period lock guard error:", (error as Error).message);
    res.status(500).json({ message: "Internal server error" });
  }
};
