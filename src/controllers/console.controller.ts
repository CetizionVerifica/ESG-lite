import { Request, Response } from "express";
import { computeConsole } from "../services/console.service";

// P16 Console: one summary across every client for the Superadmin home.
//
// GET /admin/console?limit=20
//   month     the current calendar month (database time zone), "YYYY-MM"
//   totals    clients, active clients, sites, users (not Superadmins),
//             emission factors, entries entered this month, pending entries
//   clients   per company: entries entered this month, of those still
//             pending, and every pending entry
//   activity  newest first: bulk entry uploads, emission factor uploads and
//             client onboarding, at most `limit` (1–100) in all
//
// "This month" counts entries by when they were entered (created_at), not by
// their reporting period, so a manager sees this month's workload.
//
// AS-2: the computation lives in src/services/console.service.ts (moved, unchanged).

export const parseLimit = (raw: unknown): number | null => {
  if (raw === undefined || raw === "") return 20;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
};

export const getConsole = async (req: Request, res: Response) => {
  const limit = parseLimit(req.query.limit);
  if (limit === null) return res.status(400).json({ message: "limit must be a whole number from 1 to 100" });
  try {
    return res.status(200).json(await computeConsole(limit));
  } catch (err) {
    console.error("getConsole", err);
    return res.status(500).json({ message: "Could not load the console" });
  }
};
