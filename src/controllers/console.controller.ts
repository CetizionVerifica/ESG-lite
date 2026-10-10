import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";

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

type ActivityKind = "bulk_upload" | "factor_upload" | "onboarding";

export interface ConsoleActivity {
  kind: ActivityKind;
  at: string;
  company_id: number | null;
  company_name: string | null;
  site_id: number | null;
  site_name: string | null;
  category_name: string | null;
  rows: number | null;
  pending: number | null;
  by: string | null;
  batch_id: string | null;
}

const int = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export const parseLimit = (raw: unknown): number | null => {
  if (raw === undefined || raw === "") return 20;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
};

// Onboarding dates come from company.created_at (migrate:company-created-at).
// Before that script runs the column is missing; the Console then just has no
// onboarding rows.
async function onboardingActivity(limit: number): Promise<ConsoleActivity[]> {
  try {
    const rows = await AppDataSource.query(
      `SELECT company_id, name, created_at FROM company
        WHERE created_at IS NOT NULL ORDER BY created_at DESC, company_id DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r: any) => ({
      kind: "onboarding" as const,
      at: iso(r.created_at),
      company_id: r.company_id,
      company_name: r.name,
      site_id: null,
      site_name: null,
      category_name: null,
      rows: null,
      pending: null,
      by: null,
      batch_id: null,
    }));
  } catch (err: any) {
    if (err?.code === "42703") return []; // undefined_column: migration not run yet
    throw err;
  }
}

async function batchActivity(table: "emission" | "emission_factors", limit: number): Promise<ConsoleActivity[]> {
  const isEntries = table === "emission";
  const rows = await AppDataSource.query(
    `SELECT b.upload_batch_id, b.uploaded_at, b.count, b.pending,
            s.site_id, s.name AS site_name, c.company_id, c.name AS company_name,
            cat.category_name, u.name AS uploaded_by
       FROM (
         SELECT upload_batch_id, site_id, category_id,
                MIN(created_at) AS uploaded_at, COUNT(*)::int AS count,
                ${isEntries ? "SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::int" : "NULL::int"} AS pending,
                ${isEntries ? "MIN(created_by)" : "NULL::int"} AS created_by
           FROM ${table}
          WHERE upload_batch_id IS NOT NULL
          GROUP BY upload_batch_id, site_id, category_id
          ORDER BY MIN(created_at) DESC
          LIMIT $1
       ) b
       LEFT JOIN site s ON s.site_id = b.site_id
       LEFT JOIN company c ON c.company_id = s.company_id
       LEFT JOIN category cat ON cat.category_id = b.category_id
       LEFT JOIN "user" u ON u.user_id = b.created_by
      ORDER BY b.uploaded_at DESC`,
    [limit],
  );
  return rows.map((r: any) => ({
    kind: isEntries ? ("bulk_upload" as const) : ("factor_upload" as const),
    at: iso(r.uploaded_at),
    company_id: r.company_id ?? null,
    company_name: r.company_name ?? null,
    site_id: r.site_id ?? null,
    site_name: r.site_name ?? null,
    category_name: r.category_name ?? null,
    rows: int(r.count),
    pending: r.pending === null ? null : int(r.pending),
    by: r.uploaded_by ?? null,
    batch_id: r.upload_batch_id,
  }));
}

export const getConsole = async (req: Request, res: Response) => {
  const limit = parseLimit(req.query.limit);
  if (limit === null) return res.status(400).json({ message: "limit must be a whole number from 1 to 100" });
  try {
    const [[month], [totals], perClient, bulk, factors, onboarding] = await Promise.all([
      AppDataSource.query(`SELECT to_char(date_trunc('month', LOCALTIMESTAMP), 'YYYY-MM') AS month`),
      AppDataSource.query(
        `SELECT
           (SELECT COUNT(*) FROM company)::int AS clients,
           (SELECT COUNT(*) FROM company WHERE status IS DISTINCT FROM false)::int AS active_clients,
           (SELECT COUNT(*) FROM site)::int AS sites,
           (SELECT COUNT(*) FROM "user" WHERE role <> 'Superadmin')::int AS users,
           (SELECT COUNT(*) FROM emission_factors)::int AS emission_factors,
           (SELECT COUNT(*) FROM emission
             WHERE created_at >= date_trunc('month', LOCALTIMESTAMP))::int AS entries_this_month,
           (SELECT COUNT(*) FROM emission WHERE status = 'pending')::int AS pending_entries`,
      ),
      AppDataSource.query(
        `SELECT s.company_id,
                COUNT(*) FILTER (WHERE e.created_at >= date_trunc('month', LOCALTIMESTAMP))::int AS entries_this_month,
                COUNT(*) FILTER (WHERE e.created_at >= date_trunc('month', LOCALTIMESTAMP)
                                   AND e.status = 'pending')::int AS pending_this_month,
                COUNT(*) FILTER (WHERE e.status = 'pending')::int AS pending
           FROM emission e
           JOIN site s ON s.site_id = e.site_id
          WHERE s.company_id IS NOT NULL
          GROUP BY s.company_id
          ORDER BY s.company_id`,
      ),
      batchActivity("emission", limit),
      batchActivity("emission_factors", limit),
      onboardingActivity(limit),
    ]);

    const activity = [...bulk, ...factors, ...onboarding]
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, limit);

    return res.status(200).json({
      month: month.month,
      totals,
      clients: perClient.map((r: any) => ({
        company_id: r.company_id,
        entries_this_month: int(r.entries_this_month),
        pending_this_month: int(r.pending_this_month),
        pending: int(r.pending),
      })),
      activity,
    });
  } catch (err) {
    console.error("getConsole", err);
    return res.status(500).json({ message: "Could not load the console" });
  }
};
