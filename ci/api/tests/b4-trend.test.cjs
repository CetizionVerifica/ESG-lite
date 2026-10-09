// B4-TREND: the trend series and the vs-last-year figures P06 needs on
// GET /manager/overview. Golden values worked out by hand from
// ci/api/fixture.sql (manager = sites 1 + 2):
//   approved monthly: 2024-05 site 1 S1 50 + saved 5; 2025-02 site 1 S3 11;
//                     2025-08 site 2 S1 10; 2025-09 site 1 S1 4.29 + S3 1.0
//   approved yearly:  CY 2024 site 1 S2 80; FY 2025-26 site 2 S2 120
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

const get = async (q) => {
  const res = await call("GET", `/manager/overview?${q}`, "manager");
  assert.equal(res.status, 200, q);
  return res.json;
};
const zero = (month) => ({ month, gross: 0, saved: 0, net: 0 });
const monthsOf = (y) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);

test("month: 6-month trend ending with the month, nothing last year", async () => {
  const o = await get("period=2025-09");
  assert.deepEqual(o.trend, [
    zero("2025-04"),
    zero("2025-05"),
    zero("2025-06"),
    zero("2025-07"),
    { month: "2025-08", gross: 10, saved: 0, net: 10 },
    { month: "2025-09", gross: 5.29, saved: 0, net: 5.29 },
  ]);
  assert.deepEqual(o.last_year.period, { key: "2024-09", type: "month", start: "2024-09-01", end: "2024-09-30" });
  assert.deepEqual(o.last_year.kpis, { gross: 0, net: 0, saved: 0, scope_1: 0, scope_2: 0, scope_3: 0 });
  assert.equal(o.kpis.net_vs_last_year_pct, null);
  assert.ok(o.by_site.every((s) => s.net_vs_last_year_pct === null));
});

test("calendar year: 12-month trend, last year counts its own CY batch", async () => {
  const o = await get("period=2025");
  const byMonth = { "2025-02": [11, 0], "2025-08": [10, 0], "2025-09": [5.29, 0] };
  assert.deepEqual(
    o.trend,
    monthsOf(2025).map((m) => (byMonth[m] ? { month: m, gross: byMonth[m][0], saved: 0, net: byMonth[m][0] } : zero(m))),
  );
  // The trend is the monthly series; it matches by_month for a whole year.
  assert.deepEqual(o.trend, o.by_month);
  assert.equal(o.last_year.period.key, "2024");
  assert.deepEqual(o.last_year.kpis, { gross: 130, net: 125, saved: 5, scope_1: 50, scope_2: 80, scope_3: 0 });
  assert.equal(o.kpis.net, 26.29);
  assert.equal(o.kpis.net_vs_last_year_pct, -79); // (26.29 - 125) / 125
  assert.deepEqual(o.last_year.by_site, [
    { site_id: 1, gross: 130, saved: 5, net: 125 },
    { site_id: 2, gross: 0, saved: 0, net: 0 },
  ]);
  assert.deepEqual(
    o.by_site.map((s) => [s.site_id, s.net, s.net_vs_last_year_pct]),
    [
      [1, 16.29, -87], // (16.29 - 125) / 125
      [2, 10, null], // nothing approved last year
    ],
  );
});

test("financial year: last year is the previous FY, yearly batches stay out of the trend", async () => {
  const o = await get("period=FY2025-26");
  assert.deepEqual(o.last_year.period, { key: "FY2024-25", type: "fy", start: "2024-04-01", end: "2025-03-31" });
  // FY 2024-25: 50 + 11 gross, 5 saved; the CY 2024 batch is not an FY batch.
  assert.deepEqual(o.last_year.kpis, { gross: 61, net: 56, saved: 5, scope_1: 50, scope_2: 0, scope_3: 11 });
  assert.equal(o.kpis.net, 135.29);
  assert.equal(o.kpis.net_vs_last_year_pct, 141.6); // (135.29 - 56) / 56
  assert.equal(o.trend.length, 12);
  assert.equal(o.trend[0].month, "2025-04");
  assert.equal(o.trend[11].month, "2026-03");
  assert.equal(o.trend.reduce((s, m) => s + m.gross, 0), 15.29);
});

test("quarter: 6-month trend, last year is the same quarter", async () => {
  const o = await get("period=2025-Q3");
  assert.deepEqual(o.trend.map((m) => m.month), ["2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09"]);
  assert.equal(o.last_year.period.key, "2024-Q3");
  assert.equal(o.kpis.net_vs_last_year_pct, null);
});

test("saved (null scope) is split out of the trend", async () => {
  const o = await get("period=2024-05");
  assert.deepEqual(o.trend.map((m) => m.month), ["2023-12", "2024-01", "2024-02", "2024-03", "2024-04", "2024-05"]);
  assert.deepEqual(o.trend[5], { month: "2024-05", gross: 50, saved: 5, net: 45 });
});

test("all time: trend ends with the latest approved month, no last year", async () => {
  const o = await get("");
  assert.deepEqual(o.trend.map((m) => m.month), ["2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09"]);
  assert.equal(o.last_year, null);
  assert.equal(o.kpis.net_vs_last_year_pct, null);
  assert.ok(o.by_site.every((s) => s.net_vs_last_year_pct === null));
});

test("site and category filters apply to the trend and last year", async () => {
  const cat = await get("period=2025&categoryId=1");
  assert.deepEqual(
    cat.trend.filter((m) => m.gross),
    [
      { month: "2025-08", gross: 10, saved: 0, net: 10 },
      { month: "2025-09", gross: 4.29, saved: 0, net: 4.29 },
    ],
  );
  assert.deepEqual(cat.last_year.kpis, { gross: 50, net: 50, saved: 0, scope_1: 50, scope_2: 0, scope_3: 0 });
  assert.equal(cat.kpis.net_vs_last_year_pct, -71.4); // (14.29 - 50) / 50

  const site2 = await get("period=2025-09&siteIds=2");
  assert.deepEqual(site2.trend.filter((m) => m.gross), [{ month: "2025-08", gross: 10, saved: 0, net: 10 }]);
  assert.deepEqual(site2.last_year.by_site, [{ site_id: 2, gross: 0, saved: 0, net: 0 }]);
});
