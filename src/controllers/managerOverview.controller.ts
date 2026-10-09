import { Response } from "express";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Emission } from "../entities/Emission";
import { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../types/type";
import { parseSiteIds } from "../utils/parseSiteIds";

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export interface OverviewPeriod {
  key: string;
  type: "all" | "month" | "quarter" | "cy" | "fy";
  start: string | null;
  end: string | null;
}

/**
 * Parses the overview period:
 *   (none)      all time
 *   2025        calendar year
 *   2025-09     month
 *   2025-Q3     quarter
 *   FY2025-26   Indian financial year, Apr 2025 .. Mar 2026
 */
export const parseOverviewPeriod = (raw: unknown): OverviewPeriod | null => {
  if (raw === undefined || raw === "") return { key: "all", type: "all", start: null, end: null };
  const p = String(raw);
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})$/.exec(p))) {
    const y = +m[1];
    return { key: p, type: "cy", start: ymd(y, 1, 1), end: ymd(y, 12, 31) };
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(p)) && +m[2] >= 1 && +m[2] <= 12) {
    const y = +m[1];
    const mo = +m[2];
    return { key: p, type: "month", start: ymd(y, mo, 1), end: ymd(y, mo, lastDay(y, mo)) };
  }
  if ((m = /^(\d{4})-Q([1-4])$/.exec(p))) {
    const y = +m[1];
    const first = (+m[2] - 1) * 3 + 1;
    return { key: p, type: "quarter", start: ymd(y, first, 1), end: ymd(y, first + 2, lastDay(y, first + 2)) };
  }
  if ((m = /^FY(\d{4})-(\d{2})$/.exec(p)) && (+m[1] + 1) % 100 === +m[2]) {
    const y = +m[1];
    return { key: p, type: "fy", start: ymd(y, 4, 1), end: ymd(y + 1, 3, 31) };
  }
  return null;
};

const monthsBetween = (start: string, end: string): string[] => {
  const out: string[] = [];
  let y = +start.slice(0, 4);
  let m = +start.slice(5, 7);
  const endKey = end.slice(0, 7);
  for (;;) {
    const key = `${y}-${pad(m)}`;
    out.push(key);
    if (key >= endKey) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
};

// The month whose submissions the overview reports: the period's month, or for
// longer periods its last month that has already ended (data for month M is
// due in M+1), never later than the previous calendar month.
const submissionMonth = (period: OverviewPeriod): string => {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevKey = `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}`;
  if (period.type === "month") return period.key;
  if (period.end && period.end.slice(0, 7) < prevKey) return period.end.slice(0, 7);
  return prevKey;
};

const num = (v: unknown) => Number(v ?? 0) || 0;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

// A yearly batch counts in the KPIs only for a whole year of its own type
// (CY batch <-> "YYYY", FY batch <-> "FYyyyy-yy") or for all time. For any
// other period it overlaps (month, quarter, the other year type) it appears
// only in yearly_total: the overview does not pro-rate a batch over months.
const kpiYearType = (period: OverviewPeriod): "CY" | "FY" | null =>
  period.type === "cy" ? "CY" : period.type === "fy" ? "FY" : null;

/**
 * GET /manager/overview?period=&siteIds=&categoryId=
 *
 * Server-side version of what pages/ManagerDashboard aggregates in the
 * browser, using the same rules:
 *  - figures use approved entries only; counts cover every status;
 *  - "Scope 1/2/3" make up gross, a null scope (e.g. Renewable Electricity)
 *    is saved, net = gross - saved;
 *  - yearly batches count in the KPIs, by_scope, by_site and by_category only
 *    for a whole year of the same type (or all time); yearly_total holds every
 *    approved yearly batch whose year overlaps the period;
 *  - the monthly series leaves out yearly batches;
 *  - tCO2e figures are rounded to 3 decimals;
 *  - by_category leaves out null-scope categories.
 * siteIds defaults to every site the manager manages; any other site is 403.
 */
export const getManagerOverview = async (req: AuthRequest, res: Response) => {
  try {
    const managerId = req.user?.userId;
    if (!managerId) return res.status(401).json({ message: "Unauthorized" });

    const period = parseOverviewPeriod(req.query.period);
    if (!period) {
      return res.status(400).json({ message: "period must be YYYY, YYYY-MM, YYYY-Qn or FYYYYY-YY (e.g. FY2025-26)" });
    }
    const rawCategory = req.query.categoryId;
    if (rawCategory !== undefined && rawCategory !== "" && !/^[1-9]\d*$/.test(String(rawCategory))) {
      return res.status(400).json({ message: "categoryId must be a positive integer" });
    }
    const categoryId = rawCategory !== undefined && rawCategory !== "" ? parseInt(String(rawCategory), 10) : null;

    const manager = await AppDataSource.getRepository(User).findOne({
      where: { user_id: managerId },
      relations: ["site", "sites"],
    });
    if (!manager) return res.status(404).json({ message: "Manager not found" });

    const managed = new Map<number, string>();
    if (manager.site) managed.set(manager.site.site_id, manager.site.name);
    (manager.sites || []).forEach((s) => managed.set(s.site_id, s.name));

    const requested = parseSiteIds(req.query as { siteIds?: unknown; siteId?: unknown });
    if (requested.some((id) => !managed.has(id))) {
      return res.status(403).json({ message: "You do not manage one or more of the requested sites" });
    }
    const siteIds = (requested.length ? requested : [...managed.keys()]).sort((a, b) => a - b);

    const base = {
      period,
      site_ids: siteIds,
      category_id: categoryId,
    };
    if (siteIds.length === 0) {
      return res.json({
        ...base,
        kpis: emptyKpis(),
        by_scope: [],
        by_site: [],
        by_month: period.start && period.end ? monthsBetween(period.start, period.end).map((month) => ({ month, gross: 0, saved: 0, net: 0 })) : [],
        yearly_total: 0,
        by_category: [],
        submission: { month: submissionMonth(period), submitted: 0, missing: 0, users: [] },
      });
    }

    // Rows in the period: monthly rows dated inside it, yearly rows whose
    // year (CY Jan-Dec, FY Apr-Mar, ending on date_of_reporting) overlaps it.
    const filtered = () => {
      const qb = AppDataSource.getRepository(Emission)
        .createQueryBuilder("e")
        .leftJoin("e.category", "c")
        .where("e.site_id IN (:...siteIds)", { siteIds });
      if (categoryId) qb.andWhere("e.category_id = :categoryId", { categoryId });
      if (period.start && period.end) {
        qb.andWhere(
          `((e.reporting_period IS DISTINCT FROM 'yearly' AND e.date_of_reporting BETWEEN :start AND :end)
            OR (e.reporting_period = 'yearly' AND e.date_of_reporting >= CAST(:start AS date)
                AND (CASE WHEN e.year_type = 'FY'
                          THEN e.date_of_reporting - INTERVAL '1 year' + INTERVAL '1 day'
                          ELSE date_trunc('year', e.date_of_reporting) END) <= CAST(:end AS date)))`,
          { start: period.start, end: period.end },
        );
      }
      return qb;
    };
    // Whether a row counts in the KPIs (see kpiYearType).
    const yt = kpiYearType(period);
    const countedSql =
      period.type === "all"
        ? "(e.pk_id IS NOT NULL)" // always true; a bare TRUE cannot be grouped by
        : yt
          ? "(e.reporting_period IS DISTINCT FROM 'yearly' OR (e.year_type = :kpiYearType AND e.date_of_reporting = CAST(:end AS date)))"
          : "(e.reporting_period IS DISTINCT FROM 'yearly')";
    const countedParams = { kpiYearType: yt, end: period.end };

    // Approved tCO2e by site x category x month x period type; everything
    // else is summed from these rows in JS.
    const approved = await filtered()
      .select("e.site_id", "site_id")
      .addSelect("e.category_id", "category_id")
      .addSelect("c.category_name", "category_name")
      .addSelect("c.scope", "scope")
      .addSelect("to_char(e.date_of_reporting, 'YYYY-MM')", "month")
      .addSelect("(e.reporting_period = 'yearly')", "yearly")
      .addSelect(countedSql, "counted")
      .addSelect("SUM(e.total_emission)", "total")
      .andWhere("e.status = 'approved'")
      .setParameters(countedParams)
      .groupBy("e.site_id")
      .addGroupBy("e.category_id")
      .addGroupBy("c.category_name")
      .addGroupBy("c.scope")
      .addGroupBy("to_char(e.date_of_reporting, 'YYYY-MM')")
      .addGroupBy("(e.reporting_period = 'yearly')")
      .addGroupBy(countedSql)
      .getRawMany();
    const inKpis = approved.filter((r) => r.counted);

    const counts = await filtered()
      .select("e.site_id", "site_id")
      .addSelect("COUNT(*)", "entries")
      .addSelect("COUNT(*) FILTER (WHERE e.status = 'approved')", "approved")
      .addSelect("COUNT(*) FILTER (WHERE e.status = 'pending')", "pending")
      .addSelect("COUNT(*) FILTER (WHERE e.status = 'rejected')", "rejected")
      .addSelect("COALESCE(SUM(e.total_emission) FILTER (WHERE e.status = 'pending'), 0)", "pending_emission")
      .andWhere(countedSql, countedParams)
      .groupBy("e.site_id")
      .getRawMany();

    // KPIs
    const kpis = emptyKpis();
    for (const r of inKpis) {
      const t = num(r.total);
      if (r.scope === "Scope 1") kpis.scope_1 += t;
      else if (r.scope === "Scope 2") kpis.scope_2 += t;
      else if (r.scope === "Scope 3") kpis.scope_3 += t;
      else if (r.scope === null) kpis.saved += t;
    }
    kpis.gross = kpis.scope_1 + kpis.scope_2 + kpis.scope_3;
    kpis.net = kpis.gross - kpis.saved;
    for (const c of counts) {
      kpis.entries += num(c.entries);
      kpis.approved_count += num(c.approved);
      kpis.pending_count += num(c.pending);
      kpis.rejected_count += num(c.rejected);
      kpis.pending_emission += num(c.pending_emission);
    }
    for (const k of ["gross", "net", "saved", "scope_1", "scope_2", "scope_3", "pending_emission"] as const) kpis[k] = r3(kpis[k]);

    const by_scope = [
      { scope: "Scope 1", total: kpis.scope_1 },
      { scope: "Scope 2", total: kpis.scope_2 },
      { scope: "Scope 3", total: kpis.scope_3 },
      { scope: null, total: kpis.saved },
    ];

    // Monthly series (monthly entries only). Any non-null scope is gross here,
    // as in the dashboard's trend chart.
    const monthKeys =
      period.start && period.end
        ? monthsBetween(period.start, period.end)
        : [...new Set(approved.filter((r) => !r.yearly).map((r) => r.month as string))].sort();
    const monthMap = new Map(monthKeys.map((k) => [k, { month: k, gross: 0, saved: 0, net: 0 }]));
    let yearly_total = 0;
    for (const r of approved) {
      if (r.yearly) {
        yearly_total += num(r.total);
        continue;
      }
      const bucket = monthMap.get(r.month);
      if (!bucket) continue;
      if (r.scope === null || r.scope === undefined) bucket.saved += num(r.total);
      else bucket.gross += num(r.total);
    }
    yearly_total = r3(yearly_total);
    const by_month = [...monthMap.values()].map((b) => ({ month: b.month, gross: r3(b.gross), saved: r3(b.saved), net: r3(b.gross - b.saved) }));

    // By site: `total` is every approved entry (as the dashboard's site
    // comparison chart), gross/saved/net split it like the KPIs.
    const by_site = siteIds.map((siteId) => {
      const rows = inKpis.filter((r) => r.site_id === siteId);
      const c = counts.find((x) => x.site_id === siteId);
      const sum = (pred: (r: any) => boolean) => rows.filter(pred).reduce((s, r) => s + num(r.total), 0);
      const gross = sum((r) => r.scope === "Scope 1" || r.scope === "Scope 2" || r.scope === "Scope 3");
      const saved = sum((r) => r.scope === null);
      return {
        site_id: siteId,
        name: managed.get(siteId),
        total: r3(sum(() => true)),
        gross: r3(gross),
        saved: r3(saved),
        net: r3(gross - saved),
        entries: num(c?.entries),
        approved: num(c?.approved),
        pending: num(c?.pending),
        rejected: num(c?.rejected),
      };
    });

    // By category (scoped categories only), largest first.
    const catMap = new Map<number, { category_id: number; category_name: string; scope: string; total: number }>();
    for (const r of inKpis) {
      if (r.scope === null || r.scope === undefined) continue;
      const cur = catMap.get(r.category_id) || { category_id: r.category_id, category_name: r.category_name, scope: r.scope, total: 0 };
      cur.total += num(r.total);
      catMap.set(r.category_id, cur);
    }
    const by_category = [...catMap.values()]
      .map((c) => ({ ...c, total: r3(c.total) }))
      .sort((a, b) => b.total - a.total || a.category_id - b.category_id);

    const submission = await submissionFor(submissionMonth(period), siteIds);

    return res.json({ ...base, kpis, by_scope, by_site, by_month, yearly_total, by_category, submission });
  } catch (error) {
    console.error("Manager overview error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const emptyKpis = () => ({
  gross: 0,
  net: 0,
  saved: 0,
  scope_1: 0,
  scope_2: 0,
  scope_3: 0,
  entries: 0,
  approved_count: 0,
  pending_count: 0,
  rejected_count: 0,
  pending_emission: 0,
});

// Contributors (role User) on the selected sites and whether they filed
// anything for `month`, as GET /manager/submission-status counts it.
const submissionFor = async (month: string, siteIds: number[]) => {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  const rows: { user_id: number; name: string; email: string; site_name: string; submission_count: string }[] =
    await AppDataSource.query(
      `SELECT u.user_id,
              COALESCE(NULLIF(TRIM(COALESCE(u.name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email) AS name,
              u.email,
              (SELECT s.name FROM site s
                WHERE s.site_id = COALESCE(u.site_id,
                  (SELECT us2.site_id FROM user_sites us2 WHERE us2.user_id = u.user_id ORDER BY us2.site_id LIMIT 1))) AS site_name,
              (SELECT COUNT(*) FROM emission e
                WHERE e.created_by = u.user_id
                  AND e.date_of_reporting BETWEEN $2::date AND $3::date) AS submission_count
         FROM "user" u
        WHERE u.role = $4
          AND (u.site_id = ANY($1) OR EXISTS (SELECT 1 FROM user_sites us WHERE us.user_id = u.user_id AND us.site_id = ANY($1)))
        ORDER BY u.user_id`,
      [siteIds, ymd(y, m, 1), ymd(y, m, lastDay(y, m)), UserRole.USER],
    );
  const users = rows
    .map((r) => {
      const count = num(r.submission_count);
      return {
        user_id: r.user_id,
        name: r.name,
        email: r.email,
        site_name: r.site_name || "N/A",
        submission_count: count,
        status: (count > 0 ? "submitted" : "missing") as "submitted" | "missing",
      };
    })
    .sort((a, b) => (a.status !== b.status ? (a.status === "missing" ? -1 : 1) : a.name.localeCompare(b.name)));
  return {
    month,
    submitted: users.filter((u) => u.status === "submitted").length,
    missing: users.filter((u) => u.status === "missing").length,
    users,
  };
};
