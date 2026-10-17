// KPI-8 pure parts: the §5 review checks (each held and passed, the info
// check, details for the reason chips) and what is left before a period can
// close (per KPI frequency and period end; assignments narrow the sites).
// Runs against the compiled build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { computeChecks } = require(path.resolve("dist/kpi/review/checks.js"));
const { periodLeft, expectedSites, lockRange } = require(path.resolve("dist/kpi/review/lock.js"));

const base = {
  source: "manual", value_numeric: 120, value_canonical: 120, unit: "kL", canonical_unit: "kL", breakdown: null,
  is_estimate: false, evidence_count: 1, previous: null, limit_pct: 5, stale: false, checked_at: "2026-10-17T00:00:00.000Z",
};

test("a clean value is ready", () => {
  assert.deepEqual(computeChecks(base), { ready: true, held: [], info: [], checked_at: "2026-10-17T00:00:00.000Z" });
});

test("KPI_EVIDENCE holds a manual value without evidence; auto and calculated values trace to their source", () => {
  assert.deepEqual(computeChecks({ ...base, evidence_count: 0 }).held, ["KPI_EVIDENCE"]);
  assert.deepEqual(computeChecks({ ...base, evidence_count: 0, source: "auto" }).held, []);
  assert.deepEqual(computeChecks({ ...base, evidence_count: 0, source: "formula" }).held, []);
});

test("KPI_CHANGE_LIMIT: more than the company's limit from the same period last year", () => {
  const held = computeChecks({ ...base, value_canonical: 360, previous: 120 });
  assert.deepEqual(held.held, ["KPI_CHANGE_LIMIT"]);
  assert.deepEqual(held.details.KPI_CHANGE_LIMIT, { previous: 120, change_pct: 200, ratio: 3, limit_pct: 5 });
  assert.deepEqual(computeChecks({ ...base, value_canonical: 126, previous: 120 }).held, [], "exactly 5 % passes");
  assert.deepEqual(computeChecks({ ...base, value_canonical: 113, previous: 120 }).held, ["KPI_CHANGE_LIMIT"], "a fall counts too (−5.8 %)");
  assert.deepEqual(computeChecks({ ...base, value_canonical: 150, previous: 120, limit_pct: 30 }).held, [], "the company's own limit");
  assert.deepEqual(computeChecks({ ...base, previous: null }).held, [], "nothing last year passes");
  assert.deepEqual(computeChecks({ ...base, value_canonical: 5, previous: 0 }).held, ["KPI_CHANGE_LIMIT"], "from 0");
  assert.deepEqual(computeChecks({ ...base, value_canonical: 0, previous: 0 }).held, []);
});

test("KPI_BREAKDOWN_SUM: parts more than ±0.5 % off the total", () => {
  assert.deepEqual(computeChecks({ ...base, breakdown: { groundwater: 70, surface: 50 } }).held, []);
  assert.deepEqual(computeChecks({ ...base, breakdown: { groundwater: 70, surface: 50.5 } }).held, [], "0.42 % is inside");
  const off = computeChecks({ ...base, breakdown: { groundwater: 70, surface: 40 } });
  assert.deepEqual(off.held, ["KPI_BREAKDOWN_SUM"]);
  assert.deepEqual(off.details.KPI_BREAKDOWN_SUM, { parts: 110, total: 120, difference_pct: -8.33 });
});

test("KPI_UNIT_CONVERTED is informational; KPI_ESTIMATE and KPI_AUTO_STALE hold", () => {
  const converted = computeChecks({ ...base, unit: "m3" });
  assert.deepEqual([converted.ready, converted.held, converted.info], [true, [], ["KPI_UNIT_CONVERTED"]]);
  assert.deepEqual(computeChecks({ ...base, unit: "kilolitres" }).info, [], "a spelling of the canonical unit");
  assert.deepEqual(computeChecks({ ...base, is_estimate: true }).held, ["KPI_ESTIMATE"]);
  assert.deepEqual(computeChecks({ ...base, source: "auto", stale: true }).held, ["KPI_AUTO_STALE"]);
  const all = computeChecks({ ...base, evidence_count: 0, is_estimate: true, value_canonical: 300, previous: 100, unit: "m3" });
  assert.deepEqual([all.ready, all.held, all.info], [false, ["KPI_EVIDENCE", "KPI_CHANGE_LIMIT", "KPI_ESTIMATE"], ["KPI_UNIT_CONVERTED"]]);
});

test("lock ranges: a month of the reporting year, or the whole year (CY and FY)", () => {
  assert.deepEqual(lockRange("CY", 2026, 9), { start: "2026-09-01", end: "2026-09-30" });
  assert.deepEqual(lockRange("FY", 2026, 9), { start: "2025-09-01", end: "2025-09-30" }, "FY 2026 September = September 2025");
  assert.deepEqual(lockRange("FY", 2026, 2), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(lockRange("FY", 2026, null), { start: "2025-04-01", end: "2026-03-31" });
});

test("what's left: periods ending in the month, by frequency; assignments narrow the sites; the company row", () => {
  const kpis = [
    { id: 1, code: "LTI", name: "Lost-time injuries", level: "site", frequency: "monthly" },
    { id: 2, code: "DISCHARGE", name: "Water discharged", level: "site", frequency: "quarterly" },
    { id: 3, code: "WASTE", name: "Waste", level: "site", frequency: "annual" },
    { id: 4, code: "REVENUE", name: "Revenue", level: "company", frequency: "annual" },
  ];
  const sites = [{ site_id: 1, name: "A" }, { site_id: 2, name: "B" }];
  const values = [
    { id: 10, kpi_definition_id: 1, site_id: 1, period_start: "2026-09-01", frequency: "monthly", status: "approved" },
    { id: 11, kpi_definition_id: 1, site_id: 2, period_start: "2026-09-01", frequency: "monthly", status: "pending" },
    { id: 12, kpi_definition_id: 2, site_id: 1, period_start: "2026-07-01", frequency: "quarterly", status: "rejected" },
  ];
  const sep = periodLeft({ range: lockRange("CY", 2026, 9), yearType: "CY", year: 2026, kpis, sites, includeCompany: true, assignments: [{ kpi_definition_id: 2, site_id: 1 }], values });
  assert.deepEqual(sep.left.map((l) => [l.site_id, l.code, l.period_start, l.reason, l.value_id]), [
    [1, "DISCHARGE", "2026-07-01", "rejected", 12],
    [2, "LTI", "2026-09-01", "pending", 11],
  ], "Q3 ends in September; discharge is assigned on site 1 only; waste and revenue end in December");
  assert.deepEqual(sep.perTarget.get("1").get(1).counts, { missing: 0, draft: 0, pending: 0, approved: 1, rejected: 0 });

  const dec = periodLeft({ range: lockRange("CY", 2026, 12), yearType: "CY", year: 2026, kpis, sites, includeCompany: true, assignments: [], values });
  assert.deepEqual(dec.left.filter((l) => l.code !== "LTI" && l.code !== "DISCHARGE").map((l) => [l.site_id, l.code, l.reason]), [
    [null, "REVENUE", "missing"], [1, "WASTE", "missing"], [2, "WASTE", "missing"],
  ]);
  const siteOnly = periodLeft({ range: lockRange("CY", 2026, 12), yearType: "CY", year: 2026, kpis, sites: [sites[0]], includeCompany: false, assignments: [], values });
  assert.ok(siteOnly.left.every((l) => l.site_id === 1), "a site lock leaves company values out");

  const year = periodLeft({ range: lockRange("CY", 2026, null), yearType: "CY", year: 2026, kpis: [kpis[0]], sites: [sites[0]], includeCompany: false, assignments: [], values });
  assert.equal(year.left.length, 11, "the whole year: 12 months, September approved");
  assert.deepEqual(expectedSites(5, [1, 2, 3], [{ kpi_definition_id: 5, site_id: 3 }, { kpi_definition_id: 5, site_id: null }]), [3]);
  assert.deepEqual(expectedSites(5, [1, 2], []), [1, 2]);
});
