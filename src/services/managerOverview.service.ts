/**
 * The GET /manager/overview computation (IN-1 extraction, refactor only):
 * moved here from controllers/managerOverview.controller.ts unchanged so
 * src/insights can read the same figures. The controller validates the
 * request and calls computeManagerOverview; behaviour and tests are unchanged.
 */
import { AppDataSource } from "../config/data-source";
import { Emission } from "../entities/Emission";
import { UserRole } from "../types/type";
import { approvedEntryCountSql, pendingReviewCountSql } from "../utils/feraFold";
import { addKg, kgToTonnes, sumKg, sumKgSql } from "../reporting/kgTotals";

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

// The same period one year earlier, for the "vs last year" figures; null for
// all time.
export const lastYearPeriod = (period: OverviewPeriod): OverviewPeriod | null => {
  const k = period.key;
  switch (period.type) {
    case "cy":
      return parseOverviewPeriod(String(+k - 1).padStart(4, "0"));
    case "month":
    case "quarter":
      return parseOverviewPeriod(`${String(+k.slice(0, 4) - 1).padStart(4, "0")}${k.slice(4)}`);
    case "fy": {
      const y = +k.slice(2, 6) - 1;
      return parseOverviewPeriod(`FY${String(y).padStart(4, "0")}-${pad((y + 1) % 100)}`);
    }
    default:
      return null;
  }
};

// Last day whose data is due: the end of the previous calendar month (data
// for month M is filed in M+1).
const dueThrough = (): string => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

export type LastYearStatus = "complete" | "year_to_date" | "not_due";

// What the period is compared with: the same period last year, cut to the
// same months when the period is still running, so a part-filed year is not
// set against a whole one.
//   complete      the period has ended; last year's whole period
//   year_to_date  the period is running; last year up to the same due month
//   not_due       no month of the period is due yet; no % change is given
export const lastYearComparison = (
  period: OverviewPeriod,
  due: string = dueThrough(),
): { period: OverviewPeriod; status: LastYearStatus } | null => {
  const ly = lastYearPeriod(period);
  if (!ly || !period.start || !period.end || !ly.end) return null;
  if (period.end <= due) return { period: ly, status: "complete" };
  if (period.start > due) return { period: ly, status: "not_due" };
  const y = +due.slice(0, 4) - 1;
  const m = +due.slice(5, 7);
  return { period: { ...ly, end: ymd(y, m, lastDay(y, m)) }, status: "year_to_date" };
};

const addMonths = (month: string, n: number): string => {
  const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

// Months the trend chart shows: a whole year's 12 months for CY and FY, else
// the 6 months ending with the period's last month (for all time, with the
// latest month that has approved monthly data).
const TREND_MONTHS = 6;
const trendMonths = (period: OverviewPeriod, latestMonth: string | null): string[] => {
  if ((period.type === "cy" || period.type === "fy") && period.start && period.end) return monthsBetween(period.start, period.end);
  const last = period.end ? period.end.slice(0, 7) : latestMonth;
  if (!last) return [];
  return Array.from({ length: TREND_MONTHS }, (_, i) => addMonths(last, i - TREND_MONTHS + 1));
};

// Percent change of `now` against `before`, 1 decimal; null when there is
// nothing to compare against.
const pctChange = (now: number, before: number | null | undefined): number | null =>
  before === null || before === undefined || before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 1000) / 10;

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
// D14: every figure below adds the rows' exact kgCO₂e (addKg) and rounds once
// to tCO₂e at the end (kgToTonnes), as the GHG report does.
const t3 = kgToTonnes;

// A yearly batch counts in the KPIs only for a whole year of its own type
// (CY batch <-> "YYYY", FY batch <-> "FYyyyy-yy") or for all time. For any
// other period it overlaps (month, quarter, the other year type) it appears
// only in yearly_total: the overview does not pro-rate a batch over months.
const kpiYearType = (period: OverviewPeriod): "CY" | "FY" | null =>
  period.type === "cy" ? "CY" : period.type === "fy" ? "FY" : null;

/** The body of GET /manager/overview (rules in the controller's doc comment). */
export interface OverviewInput {
  period: OverviewPeriod;
  /** Sites to read, sorted. */
  siteIds: number[];
  /** Site id → name (by_site[].name). */
  managed: Map<number, string>;
  categoryIds: number[];
}

export async function computeManagerOverview({ period, siteIds, managed, categoryIds }: OverviewInput) {
  const base = {
    period,
    site_ids: siteIds,
    // One category keeps the older single field; several are in category_ids.
    category_id: categoryIds.length === 1 ? categoryIds[0] : null,
    category_ids: categoryIds,
  };
  if (siteIds.length === 0) {
    return {
      ...base,
      kpis: emptyKpis(),
      by_scope: [],
      by_site: [],
      by_month: period.start && period.end ? monthsBetween(period.start, period.end).map((month) => ({ month, gross: 0, saved: 0, net: 0 })) : [],
      yearly_total: 0,
      by_category: [],
      submission: { month: submissionMonth(period), submitted: 0, missing: 0, users: [] },
      trend: trendMonths(period, null).map((month) => ({ month, gross: 0, saved: 0, net: 0 })),
      last_year: lastYear(period, []),
    };
  }

  // Rows in the period: monthly rows dated inside it, yearly rows whose
  // year (CY Jan-Dec, FY Apr-Mar, ending on date_of_reporting) overlaps it.
  const filtered = (p: OverviewPeriod = period) => {
    const qb = AppDataSource.getRepository(Emission)
      .createQueryBuilder("e")
      .leftJoin("e.category", "c")
      .where("e.site_id IN (:...siteIds)", { siteIds });
    if (categoryIds.length) qb.andWhere("e.category_id IN (:...categoryIds)", { categoryIds });
    if (p.start && p.end) {
      qb.andWhere(
        `((e.reporting_period IS DISTINCT FROM 'yearly' AND e.date_of_reporting BETWEEN :start AND :end)
          OR (e.reporting_period = 'yearly' AND e.date_of_reporting >= CAST(:start AS date)
              AND (CASE WHEN e.year_type = 'FY'
                        THEN e.date_of_reporting - INTERVAL '1 year' + INTERVAL '1 day'
                        ELSE date_trunc('year', e.date_of_reporting) END) <= CAST(:end AS date)))`,
        { start: p.start, end: p.end },
      );
    }
    return qb;
  };
  // Whether a row counts in the KPIs (see kpiYearType).
  const countedFor = (p: OverviewPeriod) => {
    const yt = kpiYearType(p);
    const sql =
      p.type === "all"
        ? "(e.pk_id IS NOT NULL)" // always true; a bare TRUE cannot be grouped by
        : yt
          ? "(e.reporting_period IS DISTINCT FROM 'yearly' OR (e.year_type = :kpiYearType AND e.date_of_reporting = CAST(:end AS date)))"
          : "(e.reporting_period IS DISTINCT FROM 'yearly')";
    return { sql, params: { kpiYearType: yt, end: p.end } };
  };
  const { sql: countedSql, params: countedParams } = countedFor(period);

  // Approved kgCO2e by site x category x month x period type; everything
  // else is summed from these rows in JS, in kg, and rounded once (D14).
  const approvedRows = (p: OverviewPeriod) => {
    const counted = countedFor(p);
    return filtered(p)
    .select("e.site_id", "site_id")
    .addSelect("e.category_id", "category_id")
    .addSelect("c.category_name", "category_name")
    .addSelect("c.scope", "scope")
    .addSelect("to_char(e.date_of_reporting, 'YYYY-MM')", "month")
    .addSelect("(e.reporting_period = 'yearly')", "yearly")
    .addSelect(counted.sql, "counted")
    .addSelect(sumKgSql("e"), "kg")
    .andWhere("e.status = 'approved'")
    .setParameters(counted.params)
    .groupBy("e.site_id")
    .addGroupBy("e.category_id")
    .addGroupBy("c.category_name")
    .addGroupBy("c.scope")
    .addGroupBy("to_char(e.date_of_reporting, 'YYYY-MM')")
    .addGroupBy("(e.reporting_period = 'yearly')")
    .addGroupBy(counted.sql)
    .getRawMany();
  };
  const approved = await approvedRows(period);
  const inKpis = approved.filter((r) => r.counted);

  const counts = await filtered()
    .select("e.site_id", "site_id")
    .addSelect("COUNT(*)", "entries")
    .addSelect("COUNT(*) FILTER (WHERE e.status = 'approved')", "approved")
    .addSelect(approvedEntryCountSql("e", "c"), "approved_entries")
    .addSelect("COUNT(*) FILTER (WHERE e.status = 'pending')", "pending")
    .addSelect(pendingReviewCountSql("e", "c"), "pending_review")
    .addSelect("COUNT(*) FILTER (WHERE e.status = 'rejected')", "rejected")
    .addSelect(sumKgSql("e", "e.status = 'pending'"), "pending_kg")
    .andWhere(countedSql, countedParams)
    // S3-15 part 2: a Draft isn't submitted yet, so it is no entry for the manager.
    .andWhere("e.status::text <> 'draft'")
    .groupBy("e.site_id")
    .getRawMany();

  // KPIs (kg until rounded once below)
  const kpis = emptyKpis();
  for (const r of inKpis) {
    const kg = num(r.kg);
    if (r.scope === "Scope 1") kpis.scope_1 = addKg(kpis.scope_1, kg);
    else if (r.scope === "Scope 2") kpis.scope_2 = addKg(kpis.scope_2, kg);
    else if (r.scope === "Scope 3") kpis.scope_3 = addKg(kpis.scope_3, kg);
    else if (r.scope === null) kpis.saved = addKg(kpis.saved, kg);
  }
  kpis.gross = addKg(kpis.scope_1, kpis.scope_2, kpis.scope_3);
  kpis.net = addKg(kpis.gross, -kpis.saved);
  for (const c of counts) {
    kpis.entries += num(c.entries);
    kpis.approved_count += num(c.approved);
    kpis.approved_entry_count += num(c.approved_entries);
    kpis.pending_count += num(c.pending);
    kpis.pending_review_count += num(c.pending_review);
    kpis.rejected_count += num(c.rejected);
    kpis.pending_emission = addKg(kpis.pending_emission, c.pending_kg);
  }
  for (const k of ["gross", "net", "saved", "scope_1", "scope_2", "scope_3", "pending_emission"] as const) kpis[k] = t3(kpis[k]);

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
      yearly_total = addKg(yearly_total, r.kg);
      continue;
    }
    const bucket = monthMap.get(r.month);
    if (!bucket) continue;
    if (r.scope === null || r.scope === undefined) bucket.saved = addKg(bucket.saved, r.kg);
    else bucket.gross = addKg(bucket.gross, r.kg);
  }
  yearly_total = t3(yearly_total);
  const by_month = [...monthMap.values()].map((b) => ({ month: b.month, gross: t3(b.gross), saved: t3(b.saved), net: t3(addKg(b.gross, -b.saved)) }));

  // By site: `total` is every approved entry (as the dashboard's site
  // comparison chart), gross/saved/net split it like the KPIs.
  const by_site = siteIds.map((siteId) => {
    const rows = inKpis.filter((r) => r.site_id === siteId);
    const c = counts.find((x) => x.site_id === siteId);
    const sum = (pred: (r: any) => boolean) => sumKg(rows.filter(pred).map((r) => r.kg));
    const gross = sum((r) => r.scope === "Scope 1" || r.scope === "Scope 2" || r.scope === "Scope 3");
    const saved = sum((r) => r.scope === null);
    return {
      site_id: siteId,
      name: managed.get(siteId),
      total: t3(sum(() => true)),
      gross: t3(gross),
      saved: t3(saved),
      net: t3(addKg(gross, -saved)),
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
    cur.total = addKg(cur.total, r.kg); // kg until rounded below
    catMap.set(r.category_id, cur);
  }
  const by_category = [...catMap.values()]
    .map((c) => ({ ...c, total: t3(c.total) }))
    .sort((a, b) => b.total - a.total || a.category_id - b.category_id);

  const submission = await submissionFor(submissionMonth(period), siteIds);

  // Trend: approved monthly entries per month (yearly batches left out, as
  // in by_month), over trendMonths().
  let latestMonth: string | null = null;
  if (period.type === "all") {
    const latest = await filtered()
      .select("to_char(MAX(e.date_of_reporting), 'YYYY-MM')", "month")
      .andWhere("e.status = 'approved'")
      .andWhere("e.reporting_period IS DISTINCT FROM 'yearly'")
      .getRawOne();
    latestMonth = latest?.month ?? null;
  }
  const trendKeys = trendMonths(period, latestMonth);
  let trend: { month: string; gross: number; saved: number; net: number }[] = [];
  if (trendKeys.length) {
    const [y, m] = trendKeys[trendKeys.length - 1].split("-").map(Number);
    const rows = await filtered({ key: "trend", type: "month", start: `${trendKeys[0]}-01`, end: ymd(y, m, lastDay(y, m)) })
      .select("to_char(e.date_of_reporting, 'YYYY-MM')", "month")
      .addSelect("(c.scope IS NULL)", "saved")
      .addSelect(sumKgSql("e"), "kg")
      .andWhere("e.status = 'approved'")
      .andWhere("e.reporting_period IS DISTINCT FROM 'yearly'")
      .groupBy("to_char(e.date_of_reporting, 'YYYY-MM')")
      .addGroupBy("(c.scope IS NULL)")
      .getRawMany();
    trend = trendKeys.map((month) => {
      const gross = num(rows.find((r) => r.month === month && !r.saved)?.kg);
      const saved = num(rows.find((r) => r.month === month && r.saved)?.kg);
      return { month, gross: t3(gross), saved: t3(saved), net: t3(addKg(gross, -saved)) };
    });
  }

  // The same period last year, on the same rules as the KPIs.
  const ly = lastYearComparison(period);
  const lyRows = ly ? (await approvedRows(ly.period)).filter((r) => r.counted) : [];
  const last_year = lastYear(period, siteIds, lyRows);
  const compared = last_year && last_year.status !== "not_due" ? last_year : null;
  kpis.net_vs_last_year_pct = pctChange(kpis.net, compared?.kpis.net);
  const by_site_ly = by_site.map((s) => ({
    ...s,
    net_vs_last_year_pct: pctChange(s.net, compared?.by_site.find((x) => x.site_id === s.site_id)?.net),
  }));

  return { ...base, kpis, by_scope, by_site: by_site_ly, by_month, yearly_total, by_category, submission, trend, last_year };
}

type ApprovedRow = { site_id: number; scope: string | null; kg: unknown };

// Gross/saved/net and per-scope figures of last year's counted approved rows
// (see lastYearComparison), in total and per site; null when the period has
// no last year (all time).
const lastYear = (period: OverviewPeriod, siteIds: number[], rows: ApprovedRow[] = []) => {
  const ly = lastYearComparison(period);
  if (!ly) return null;
  const split = (rs: ApprovedRow[]) => {
    const t = (scope: string | null) => sumKg(rs.filter((r) => r.scope === scope).map((r) => r.kg));
    const scope_1 = t("Scope 1");
    const scope_2 = t("Scope 2");
    const scope_3 = t("Scope 3");
    const saved = t(null);
    const gross = addKg(scope_1, scope_2, scope_3);
    return { gross: t3(gross), net: t3(addKg(gross, -saved)), saved: t3(saved), scope_1: t3(scope_1), scope_2: t3(scope_2), scope_3: t3(scope_3) };
  };
  const kpis = split(rows);
  return {
    period: ly.period,
    status: ly.status,
    kpis,
    by_site: siteIds.map((site_id) => {
      const { gross, saved, net } = split(rows.filter((r) => r.site_id === site_id));
      return { site_id, gross, saved, net };
    }),
  };
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
  // Approved entries as people filed them (automatic FERA twins left out);
  // approved_count counts every approved row.
  approved_entry_count: 0,
  pending_count: 0,
  // Pending entries as the approvals list shows them (FERA twins of a pending
  // entry fold into it); pending_count counts every pending row.
  pending_review_count: 0,
  rejected_count: 0,
  pending_emission: 0,
  net_vs_last_year_pct: null as number | null,
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
                WHERE e.created_by = u.user_id AND e.status::text <> 'draft'
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
