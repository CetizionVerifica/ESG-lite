// B4: GET /manager/overview must give the same numbers the current
// ManagerDashboard computes in the browser. The functions below are ports of
// ESG-lite_FE src/pages/ManagerDashboard/hooks/useEmissionsData.ts (kpis,
// status counts) and hooks/useChartOptions.ts (monthly trend, site
// comparison, category chart, yearly total), fed the same way the page feeds
// them: GET /user/emissions?siteId= for every site.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

// ---- ports of the dashboard's browser-side aggregation --------------------
function filterEmissions(emissions, { selectedCategory, selectedYear }) {
  let result = emissions;
  if (selectedCategory) result = result.filter((e) => e.category?.category_id === selectedCategory);
  if (selectedYear) result = result.filter((e) => parseInt(e.date_of_reporting.substring(0, 4)) === selectedYear);
  return result;
}

function feKpis(filtered) {
  const approved = filtered.filter((e) => e.status === "approved");
  let s1 = 0, s2 = 0, s3 = 0, saved = 0;
  approved.forEach((e) => {
    const scope = e.category?.scope;
    const v = Number(e.total_emission) || 0;
    if (scope === "Scope 1") s1 += v;
    else if (scope === "Scope 2") s2 += v;
    else if (scope === "Scope 3") s3 += v;
    else if (scope === null) saved += v;
  });
  const gross = s1 + s2 + s3;
  return { gross, net: gross - saved, scope_1: s1, scope_2: s2, scope_3: s3, saved, entries: filtered.length };
}

function feStatusCounts(filtered) {
  return {
    pending: filtered.filter((e) => e.status === "pending").length,
    approved: filtered.filter((e) => e.status === "approved").length,
    rejected: filtered.filter((e) => e.status === "rejected").length,
  };
}

function feMonthlyNet(filtered, selectedYear) {
  const approved = filtered.filter((e) => e.status === "approved");
  const gross = {}, saved = {}, months = [];
  for (let i = 0; i < 12; i++) {
    const key = `${selectedYear}-${String(i + 1).padStart(2, "0")}`;
    months.push(key);
    gross[key] = 0;
    saved[key] = 0;
  }
  approved.forEach((e) => {
    if (e.reporting_period === "yearly") return;
    const month = e.date_of_reporting.substring(0, 7);
    if (gross[month] !== undefined) {
      const v = Number(e.total_emission) || 0;
      if (e.category?.scope === null || e.category?.scope === undefined) saved[month] += v;
      else gross[month] += v;
    }
  });
  return months.map((m) => ({ month: m, net: parseFloat((gross[m] - saved[m]).toFixed(2)) }));
}

function feSiteComparison(sites, approvedSitesEmissions, comparisonYear) {
  return sites.map((site) => {
    const year = (approvedSitesEmissions[site.site_id] || []).filter(
      (e) => new Date(e.date_of_reporting).getFullYear() === comparisonYear,
    );
    return { site_id: site.site_id, value: parseFloat(year.reduce((s, e) => s + (Number(e.total_emission) || 0), 0).toFixed(2)) };
  });
}

function feCategoryChart(filtered) {
  const data = {};
  filtered.filter((e) => e.status === "approved").forEach((e) => {
    const scope = e.category?.scope;
    if (scope === null || scope === undefined) return;
    const name = e.category?.category_name || "Unknown";
    data[name] = (data[name] || 0) + (Number(e.total_emission) || 0);
  });
  return Object.entries(data).map(([name, value]) => ({ name, value: parseFloat(Number(value).toFixed(2)) }));
}

function feYearlyTotal(filtered) {
  return parseFloat(
    filtered
      .filter((e) => e.status === "approved" && e.reporting_period === "yearly")
      .reduce((s, e) => s + (Number(e.total_emission) || 0), 0)
      .toFixed(2),
  );
}
// ---------------------------------------------------------------------------

const MANAGER_SITES = [
  { site_id: 1, name: "CI Plant A" },
  { site_id: 2, name: "CI Plant B" },
];

async function dashboardData() {
  const perSite = {};
  for (const site of MANAGER_SITES) {
    const res = await call("GET", `/user/emissions?siteId=${site.site_id}`, "manager");
    assert.equal(res.status, 200);
    perSite[site.site_id] = res.json;
  }
  return perSite;
}

const close = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: ${actual} != ${expected}`);
const r2 = (n) => parseFloat(n.toFixed(2));

const SCENARIOS = [
  { name: "all time, all sites", query: "", selectedYear: null, selectedCategory: null, sites: [1, 2] },
  { name: "2024, all sites", query: "period=2024", selectedYear: 2024, selectedCategory: null, sites: [1, 2] },
  { name: "2025, all sites", query: "period=2025", selectedYear: 2025, selectedCategory: null, sites: [1, 2] },
  { name: "2025, Plant B only", query: "period=2025&siteIds=2", selectedYear: 2025, selectedCategory: null, sites: [2] },
  { name: "2025, Stationary Combustion", query: "period=2025&categoryId=1", selectedYear: 2025, selectedCategory: 1, sites: [1, 2] },
  { name: "2026, all sites", query: "period=2026", selectedYear: 2026, selectedCategory: null, sites: [1, 2] },
];

for (const sc of SCENARIOS) {
  test(`overview matches the dashboard: ${sc.name}`, async () => {
    const perSite = await dashboardData();
    const emissions = sc.sites.flatMap((id) => perSite[id]);
    const filtered = filterEmissions(emissions, sc);

    const res = await call("GET", `/manager/overview?${sc.query}`, "manager");
    assert.equal(res.status, 200);
    const o = res.json;
    assert.deepEqual(o.site_ids, sc.sites);

    const fe = feKpis(filtered);
    for (const k of ["gross", "net", "scope_1", "scope_2", "scope_3", "saved", "entries"]) close(o.kpis[k], fe[k], `kpis.${k}`);
    const st = feStatusCounts(filtered);
    assert.deepEqual(
      { pending: o.kpis.pending_count, approved: o.kpis.approved_count, rejected: o.kpis.rejected_count },
      st,
    );
    assert.equal(r2(o.yearly_total), feYearlyTotal(filtered));

    const feCats = feCategoryChart(filtered).sort((a, b) => a.name.localeCompare(b.name));
    const beCats = o.by_category.map((c) => ({ name: c.category_name, value: r2(c.total) })).sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(beCats, feCats);

    if (sc.selectedYear) {
      assert.deepEqual(
        o.by_month.map((m) => ({ month: m.month, net: r2(m.net) })),
        feMonthlyNet(filtered, sc.selectedYear),
      );
      // The site comparison chart ignores the category filter and takes the
      // year from its own picker; compare it on the same footing.
      if (!sc.selectedCategory) {
        const approvedSites = Object.fromEntries(
          Object.entries(perSite).map(([id, rows]) => [id, rows.filter((e) => e.status === "approved")]),
        );
        const feSites = feSiteComparison(MANAGER_SITES.filter((s) => sc.sites.includes(s.site_id)), approvedSites, sc.selectedYear);
        assert.deepEqual(o.by_site.map((s) => ({ site_id: s.site_id, value: r2(s.total) })), feSites);
      }
    }
  });
}

test("seed figures for 2025 are what we expect", async () => {
  const o = (await call("GET", "/manager/overview?period=2025", "manager")).json;
  // Approved 2025 rows on sites 1-2: 4.29 (S1) + 1.0 (S3) + 10 (S1) + 11 (S3); site 3's 999 is another company.
  close(o.kpis.gross, 26.29, "gross");
  close(o.kpis.scope_1, 14.29, "scope_1");
  assert.deepEqual(o.period, { key: "2025", type: "cy", start: "2025-01-01", end: "2025-12-31" });
  assert.equal(o.by_month.length, 12);
  assert.equal(o.submission.month, "2025-12");
});

test("periods: month, quarter, FY", async () => {
  const month = (await call("GET", "/manager/overview?period=2025-09", "manager")).json;
  assert.deepEqual(month.period, { key: "2025-09", type: "month", start: "2025-09-01", end: "2025-09-30" });
  close(month.kpis.gross, 5.29, "Sep gross");
  assert.equal(month.kpis.pending_count, 2);
  // Submissions for Sep 2025 by contributors on sites 1-2: user 1 filed, user 7 did not.
  assert.equal(month.submission.month, "2025-09");
  assert.deepEqual(
    month.submission.users.map((u) => [u.user_id, u.status]),
    [[7, "missing"], [1, "submitted"]],
  );

  const q = (await call("GET", "/manager/overview?period=2025-Q3", "manager")).json;
  assert.deepEqual(q.by_month.map((m) => m.month), ["2025-07", "2025-08", "2025-09"]);
  close(q.kpis.gross, 15.29, "Q3 gross");

  const fy = (await call("GET", "/manager/overview?period=FY2025-26", "manager")).json;
  assert.deepEqual([fy.period.start, fy.period.end], ["2025-04-01", "2026-03-31"]);
  close(fy.yearly_total, 120, "FY yearly batch");
  assert.equal(fy.by_month.length, 12);
  assert.ok(fy.by_month.every((m) => m.month !== "2026-03" || m.gross === 0), "yearly batch kept out of the monthly series");

  for (const bad of ["2025-13", "Q3", "FY2025-27", "2025-Q5"]) {
    assert.equal((await call("GET", `/manager/overview?period=${bad}`, "manager")).status, 400, bad);
  }
});

test("role and site checks", async () => {
  assert.equal((await call("GET", "/manager/overview?siteIds=3", "manager")).status, 403);
  assert.equal((await call("GET", "/manager/overview?siteIds=1,3", "manager")).status, 403);
  for (const who of ["user", "admin", "superadmin"]) {
    assert.equal((await call("GET", "/manager/overview", who)).status, 403, who);
  }
  assert.equal((await call("GET", "/manager/overview", null)).status, 401);

  const other = (await call("GET", "/manager/overview?period=2025", "otherManager")).json;
  assert.deepEqual(other.site_ids, [3]);
  close(other.kpis.gross, 999, "other company sees only its own site");
});
