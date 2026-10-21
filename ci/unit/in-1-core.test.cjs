// IN-1 · unit tests for the Insights core: scope period maths (CY, FY crossing
// years), the Overview period key, derive/ functions the summary uses (I6
// statuses at their edges, change, share, combined intensity, readiness), the
// stamp hash and the cache (TTL, failed loads, key parts). Runs against the build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const scope = require(path.resolve("dist/insights/scope.js"));
const d = require(path.resolve("dist/insights/derive/index.js"));
const cache = require(path.resolve("dist/insights/cache.js"));
const stamp = require(path.resolve("dist/insights/sources/stamp.js"));
const targets = require(path.resolve("dist/insights/sources/targets.js"));

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test("periodRange: CY is Jan–Dec; FY 2026 is Apr 2025–Mar 2026 (crosses the calendar year)", () => {
  assert.deepEqual(scope.periodRange({ year: 2026, yearType: "CY" }), { start: "2026-01-01", end: "2026-12-31" });
  assert.deepEqual(scope.periodRange({ year: 2026, yearType: "FY" }), { start: "2025-04-01", end: "2026-03-31" });
  assert.deepEqual(scope.periodRange({ year: 2025, yearType: "FY" }), { start: "2024-04-01", end: "2025-03-31" });
});

test("overviewKey: the /manager/overview period for a CY or FY", () => {
  assert.equal(scope.overviewKey({ year: 2025, yearType: "CY" }), "2025");
  assert.equal(scope.overviewKey({ year: 2026, yearType: "FY" }), "FY2025-26");
  assert.equal(scope.overviewKey({ year: 2000, yearType: "FY" }), "FY1999-00");
});

test("periodMonths: twelve months in order, FY from April", () => {
  const fy = scope.periodMonths({ year: 2026, yearType: "FY" });
  assert.equal(fy.length, 12);
  assert.equal(fy[0], "2025-04");
  assert.equal(fy[11], "2026-03");
  assert.deepEqual(scope.periodMonths({ year: 2024, yearType: "CY" }).slice(0, 2), ["2024-01", "2024-02"]);
});

test("periodLabel: all sites, one site by name, several by count", () => {
  const names = new Map([[1, "Plant A"]]);
  assert.equal(scope.periodLabel({ year: 2026, yearType: "CY" }, "all", names), "CY 2026 · All sites");
  assert.equal(scope.periodLabel({ year: 2026, yearType: "FY" }, [1], names), "FY 2026 · Plant A");
  assert.equal(scope.periodLabel({ year: 2026, yearType: "CY" }, [1, 2], names), "CY 2026 · 2 sites");
});

test("changePct and goodWhenDown: null without a base; zero, negative and positive", () => {
  assert.equal(d.changePct(10, null), null);
  assert.equal(d.changePct(null, 10), null);
  assert.equal(d.changePct(10, 0), null);
  close(d.changePct(90, 100), -10, "down");
  close(d.changePct(-5, -10), 50, "negative base uses |base|");
  assert.equal(d.goodWhenDown(null), null);
  assert.equal(d.goodWhenDown(0), null);
  assert.equal(d.goodWhenDown(-1), true);
  assert.equal(d.goodWhenDown(2), false);
});

test("share: % of a total; null when the total is 0 or missing", () => {
  close(d.share(25, 200), 12.5, "share");
  assert.equal(d.share(1, 0), null);
  assert.equal(d.share(null, 10), null);
  assert.equal(d.share(0, 10), 0);
});

test("pathwayStatus (I6): on_track at the pathway, at_risk up to +5 %, off_track beyond; no_data without figures", () => {
  assert.deepEqual(d.pathwayStatus(100, 100), { status: "on_track", gap_pct: 0 });
  assert.equal(d.pathwayStatus(90, 100).status, "on_track");
  assert.equal(d.pathwayStatus(105, 100).status, "at_risk");
  assert.equal(d.pathwayStatus(105.0001, 100).status, "off_track");
  close(d.pathwayStatus(110, 100).gap_pct, 10, "gap");
  assert.deepEqual(d.pathwayStatus(null, 100), { status: "no_data", gap_pct: null });
  assert.equal(d.pathwayStatus(5, 0).status, "no_data");
});

test("expectedProgress (I6): straight line from the end of the baseline year to the end of the target year", () => {
  assert.equal(d.expectedProgress(2020, 2030, "2015-06-01"), 0);
  assert.equal(d.expectedProgress(2020, 2030, "2031-01-01"), 100);
  close(d.expectedProgress(2020, 2022, "2021-12-31") , ((Date.UTC(2021, 11, 31) - Date.UTC(2020, 11, 31, 23, 59, 59)) / (Date.UTC(2022, 11, 31, 23, 59, 59) - Date.UTC(2020, 11, 31, 23, 59, 59))) * 100, "half way");
  assert.equal(d.expectedProgress(2020, 2020, "2021-01-01"), null);
});

test("targetStatus (I6): reached ≥ 100, on_track ≥ expected, at_risk ≤ 10 pp behind, off_track beyond, no_data", () => {
  assert.equal(d.targetStatus(null, 50), "no_data");
  assert.equal(d.targetStatus(100, 50), "reached");
  assert.equal(d.targetStatus(120, 130), "reached");
  assert.equal(d.targetStatus(50, 50), "on_track");
  assert.equal(d.targetStatus(40, 50), "at_risk");
  assert.equal(d.targetStatus(39.999, 50), "off_track");
  assert.equal(d.targetStatus(-20, 0), "off_track");
  assert.equal(d.targetStatus(10, null), "on_track");
});

test("combinedIntensity: Σ emissions ÷ Σ production over sites with output; combined when units differ", () => {
  const one = d.combinedIntensity([{ emissions: 30, production: 100, units: ["t"] }, { emissions: 10, production: 0, units: [] }]);
  assert.deepEqual(one, { value: 0.3, unit: "t", combined: false });
  const two = d.combinedIntensity([{ emissions: 30, production: 100, units: ["t"] }, { emissions: 10, production: 100, units: ["MWh"] }]);
  assert.equal(two.combined, true);
  assert.equal(two.unit, "mixed units");
  close(two.value, 0.2, "combined");
  assert.deepEqual(d.combinedIntensity([]), { value: null, unit: null, combined: false });
});

test("readinessOf: approved ÷ counted per pillar and overall; null when nothing is counted", () => {
  const r = d.readinessOf([
    { pillar: "environment", approved: 3, pending: 1, missing: 0 },
    { pillar: "social", approved: 0, pending: 0, missing: 2 },
    { pillar: "governance", approved: 0, pending: 0, missing: 0 },
  ]);
  close(r.pct, 50, "overall");
  assert.deepEqual(r.by_pillar, { environment: 75, social: 0, governance: null });
  assert.equal(d.readinessOf([{ pillar: "environment", approved: 0, pending: 0, missing: 0 }]), null);
});

test("countAbove: rows moving more than the limit on last year, matched by key", () => {
  const now = [{ id: 1, v: 110 }, { id: 2, v: 104 }, { id: 3, v: 50 }, { id: 4, v: 1 }];
  const before = [{ id: 1, v: 100 }, { id: 2, v: 100 }, { id: 3, v: 100 }];
  assert.equal(d.countAbove(now, before, (r) => r.id, (r) => r.v, 5), 2);
  assert.equal(d.countAbove(now, before, (r) => r.id, (r) => r.v, 60), 0);
});

test("nearTermTargetYear: 2030 when 5–10 years from the base, else the nearest edge", () => {
  assert.equal(targets.nearTermTargetYear(2021), 2030);
  assert.equal(targets.nearTermTargetYear(2017), 2027);
  assert.equal(targets.nearTermTargetYear(2026), 2031);
});

test("hashStamp: 16 hex chars, changes with any part and with the salt", () => {
  const a = stamp.hashStamp({ emissions: "1:1:0:4.2:x" }, "1|1,2|false|2026-01-01");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, stamp.hashStamp({ emissions: "1:1:0:4.2:x" }, "1|1,2|false|2026-01-01"));
  assert.notEqual(a, stamp.hashStamp({ emissions: "1:2:0:4.2:x" }, "1|1,2|false|2026-01-01"));
  assert.notEqual(a, stamp.hashStamp({ emissions: "1:1:0:4.2:x" }, "1|1,2|false|2026-01-02"));
});

test("cache: a hit inside the TTL, a reload after it, failed loads never stay", async () => {
  cache.emptyCache();
  let calls = 0;
  const load = async () => ++calls;
  assert.equal(await cache.cached("k", load, 1000), 1);
  assert.equal(await cache.cached("k", load, 1000 + cache.TTL_MS - 1), 1);
  assert.equal(await cache.cached("k", load, 1000 + cache.TTL_MS), 2);
  await assert.rejects(cache.cached("bad", async () => { throw new Error("x"); }, 5));
  assert.equal(await cache.cached("bad", async () => "ok", 6), "ok");
  assert.equal(cache.etagOf("abc"), '"in-abc"');
  cache.emptyCache();
  assert.equal(cache.cacheSize(), 0);
});

test("cacheKey: panel, company, sites, period, pillar, compare, extras and stamp", () => {
  const s = { companyId: 1, siteIds: [1, 2], period: { year: 2026, yearType: "CY" }, query: { pillar: undefined, compare: "prior" } };
  const k = cache.cacheKey("summary", s, { years: 5 }, "abc");
  assert.deepEqual(JSON.parse(k), ["summary", 1, [1, 2], "CY", 2026, null, "prior", { years: 5 }, "abc"]);
  assert.notEqual(k, cache.cacheKey("summary", s, { years: 5 }, "abd"));
  assert.notEqual(k, cache.cacheKey("summary", { ...s, siteIds: [1] }, { years: 5 }, "abc"));
});
