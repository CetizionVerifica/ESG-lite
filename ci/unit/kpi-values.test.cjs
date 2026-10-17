// KPI-4 pure parts: the period engine (CY/FY; monthly, quarterly, annual; due
// dates), units (each dimension, aliases, refusal across dimensions and
// families) and aggregation (each rule, missing ≠ 0, weighted). Expected
// figures are worked out by hand. Runs against the compiled build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const period = require(path.resolve("dist/kpi/values/period.js"));
const units = require(path.resolve("dist/kpi/values/units.js"));
const agg = require(path.resolve("dist/kpi/values/aggregate.js"));
const { KpiError } = require(path.resolve("dist/kpi/contracts/errors.js"));

// ---------------------------------------------------------------- periods
test("CY periods: 12 months, 4 quarters, 1 year", () => {
  const months = period.periodsFor("monthly", "CY", 2026);
  assert.equal(months.length, 12);
  assert.deepEqual(months[0], { start: "2026-01-01", end: "2026-01-31", label: "Jan 2026", frequency: "monthly", year_type: "CY", year: 2026, index: 1 });
  assert.equal(months[1].end, "2026-02-28");
  assert.equal(months[11].end, "2026-12-31");
  assert.equal(period.periodsFor("monthly", "CY", 2028)[1].end, "2028-02-29", "leap year");
  const quarters = period.periodsFor("quarterly", "CY", 2026);
  assert.deepEqual(quarters.map((q) => [q.start, q.end, q.label]), [
    ["2026-01-01", "2026-03-31", "Q1 2026"], ["2026-04-01", "2026-06-30", "Q2 2026"],
    ["2026-07-01", "2026-09-30", "Q3 2026"], ["2026-10-01", "2026-12-31", "Q4 2026"],
  ]);
  assert.deepEqual(period.periodsFor("annual", "CY", 2026).map((p) => [p.start, p.end, p.label]), [["2026-01-01", "2026-12-31", "2026"]]);
});

test("FY periods: FY 2026 runs April 2025 to March 2026", () => {
  const months = period.periodsFor("monthly", "FY", 2026);
  assert.equal(months[0].start, "2025-04-01");
  assert.equal(months[0].label, "Apr 2025");
  assert.equal(months[8].start, "2025-12-01");
  assert.equal(months[9].start, "2026-01-01");
  assert.equal(months[11].end, "2026-03-31");
  assert.deepEqual(period.periodsFor("quarterly", "FY", 2026).map((q) => [q.start, q.end, q.label]), [
    ["2025-04-01", "2025-06-30", "Q1 FY2025-26"], ["2025-07-01", "2025-09-30", "Q2 FY2025-26"],
    ["2025-10-01", "2025-12-31", "Q3 FY2025-26"], ["2026-01-01", "2026-03-31", "Q4 FY2025-26"],
  ]);
  assert.deepEqual(period.periodsFor("annual", "FY", 2026).map((p) => [p.start, p.end, p.label]), [["2025-04-01", "2026-03-31", "FY2025-26"]]);
});

test("periodOf, reportingYearOf and isPeriodStart", () => {
  assert.equal(period.reportingYearOf("2026-03-31", "FY"), 2026);
  assert.equal(period.reportingYearOf("2026-04-01", "FY"), 2027);
  assert.equal(period.reportingYearOf("2026-04-01", "CY"), 2026);
  assert.equal(period.periodOf("2026-09-17", "monthly", "CY").start, "2026-09-01");
  assert.equal(period.periodOf("2026-02-10", "quarterly", "FY").label, "Q4 FY2025-26");
  assert.equal(period.periodOf("2025-05-01", "annual", "FY").start, "2025-04-01");
  assert.equal(period.isPeriodStart("2026-09-01", "monthly", "CY"), true);
  assert.equal(period.isPeriodStart("2026-09-02", "monthly", "CY"), false);
  assert.equal(period.isPeriodStart("2026-04-01", "quarterly", "CY"), true);
  assert.equal(period.isPeriodStart("2026-05-01", "quarterly", "CY"), false);
  assert.equal(period.isPeriodStart("2026-04-01", "annual", "FY"), true);
  assert.equal(period.isPeriodStart("2026-04-01", "annual", "CY"), false);
  assert.equal(period.isPeriodStart("2026-01-01", "annual", "CY"), true);
});

test("due dates: due_day of the month after the period ends, clamped", () => {
  assert.equal(period.dueDate({ end: "2026-09-30" }), "2026-10-15");
  assert.equal(period.dueDate({ end: "2026-12-31" }), "2027-01-15");
  assert.equal(period.dueDate({ end: "2026-03-31" }, 31), "2026-04-30");
  assert.equal(period.dueDate({ end: "2027-01-31" }, 30), "2027-02-28");
  assert.equal(period.dueDate(period.periodsFor("annual", "FY", 2026)[0], 15), "2026-04-15");
  assert.equal(period.dueDate(period.periodsFor("quarterly", "CY", 2026)[1], 1), "2026-07-01");
});

test("ranges and overlap", () => {
  assert.deepEqual(period.yearRange("FY", 2026), { start: "2025-04-01", end: "2026-03-31" });
  assert.deepEqual(period.monthRange(2028, 2), { start: "2028-02-01", end: "2028-02-29" });
  assert.equal(period.overlaps({ start: "2026-01-01", end: "2026-03-31" }, { start: "2026-03-01", end: "2026-03-31" }), true);
  assert.equal(period.overlaps({ start: "2026-01-01", end: "2026-03-31" }, { start: "2026-04-01", end: "2026-04-30" }), false);
});

// ---------------------------------------------------------------- units
const kpi = (dim, canonical, allowed) => ({ unit_dimension: dim, canonical_unit: canonical, allowed_units: allowed });

test("energy: kWh, MWh, MJ and TJ to GJ", () => {
  const k = kpi("energy", "GJ", ["GJ", "MJ", "kWh", "MWh", "GWh", "TJ"]);
  assert.deepEqual(units.toCanonical(1000, "kWh", k), { unit: "kWh", value_canonical: 3.6, converted: true });
  assert.equal(units.toCanonical(4120, "MWh", k).value_canonical, 14832);
  assert.equal(units.toCanonical(500, "MJ", k).value_canonical, 0.5);
  assert.equal(units.toCanonical(2, "TJ", k).value_canonical, 2000);
  assert.deepEqual(units.toCanonical(7, "GJ", k), { unit: "GJ", value_canonical: 7, converted: false });
  assert.deepEqual(units.toCanonical(7, null, k), { unit: "GJ", value_canonical: 7, converted: false }, "no unit = canonical");
  assert.equal(units.convert(1, "GJ", "MWh"), 0.277777777778);
});

test("mass and CO2e: tonnes, kg, MT; tCO2e never converts to tonnes", () => {
  const k = kpi("mass", "tonne", ["tonne", "kg"]);
  assert.equal(units.toCanonical(12400, "kg", k).value_canonical, 12.4);
  assert.equal(units.toCanonical(3, "MT", k).value_canonical, 3, "engine alias MT → tonne");
  assert.equal(units.toCanonical(3, "tonnes", k).value_canonical, 3);
  const c = kpi("mass", "tCO2e", ["tCO2e", "kgCO2e"]);
  assert.equal(units.toCanonical(2500, "kgCO2e", c).value_canonical, 2.5);
  assert.equal(units.conversionFactor("tCO2e", "tonne"), null);
});

test("water volumes: m³, litres, kL and ML (megalitre, not millilitre)", () => {
  const k = kpi("volume", "kL", ["kL", "m3", "litre", "ML"]);
  assert.equal(units.toCanonical(1200, "m3", k).value_canonical, 1200);
  assert.equal(units.toCanonical(1200, "m³", k).value_canonical, 1200);
  assert.equal(units.toCanonical(5000, "Ltr", k).value_canonical, 5);
  assert.equal(units.toCanonical(1.2, "ML", k).value_canonical, 1200);
  assert.equal(units.convert(1, "mL", "litre"), 0.001);
  assert.equal(units.toCanonical(1, "ML", k).unit, "ML");
});

test("count, percent, rates, time and currency", () => {
  assert.equal(units.toCanonical(42, "count", kpi("count", "count", ["count"])).value_canonical, 42);
  assert.equal(units.toCanonical(42, "people", kpi("count", "count", ["count"])).value_canonical, 42, "alias of count");
  assert.equal(units.toCanonical(37.5, "%", kpi("ratio", "%", ["%"])).value_canonical, 37.5);
  assert.equal(units.toCanonical(37.5, "percent", kpi("ratio", "%", ["%"])).value_canonical, 37.5);
  const rate = kpi("ratio", "per million hours", ["per million hours", "per 200000 hours"]);
  assert.equal(units.toCanonical(0.4, "per 200000 hours", rate).value_canonical, 2);
  assert.equal(units.toCanonical(90, "minutes", kpi("time", "hours", ["hours", "minutes"])).value_canonical, 1.5);
  const rev = kpi("currency", "INR crore", ["INR crore", "INR lakh", "INR"]);
  assert.equal(units.toCanonical(250, "INR lakh", rev).value_canonical, 2.5);
  assert.equal(units.toCanonical(10000000, "INR", rev).value_canonical, 1);
  assert.equal(units.conversionFactor("USD", "INR"), null, "never a currency exchange");
  const intensity = kpi("none", "GJ per INR crore", ["GJ per INR crore"]);
  assert.equal(units.toCanonical(3.2, "GJ per INR crore", intensity).value_canonical, 3.2);
});

test("refusals: another dimension, another family, unknown or not allowed → KPI_UNIT_NOT_ALLOWED", () => {
  const water = kpi("volume", "kL", ["kL", "m3"]);
  const refuse = (fn) => assert.throws(fn, (e) => e instanceof KpiError && e.code === "KPI_UNIT_NOT_ALLOWED");
  refuse(() => units.toCanonical(1, "kWh", water));
  refuse(() => units.toCanonical(1, "kg", water));
  refuse(() => units.toCanonical(1, "furlong", water));
  refuse(() => units.toCanonical(1, "litre", water), "convertible but not allowed");
  refuse(() => units.toCanonical(1, "USD", kpi("currency", "INR crore", ["INR crore"])));
  refuse(() => units.toCanonical(1, "tonne", kpi("mass", "tCO2e", ["tCO2e"])));
  refuse(() => units.toCanonical(1, "MWh per EUR million", kpi("none", "GJ per INR crore", ["GJ per INR crore"])));
  refuse(() => units.toCanonical(1, "count", kpi("none", null, [])));
});

test("unitProblems flags a canonical unit of the wrong dimension and allowed units that don't convert", () => {
  assert.deepEqual(units.unitProblems(kpi("volume", "kL", ["kL", "m3", "ML"])), []);
  assert.ok(units.unitProblems(kpi("energy", "kL", ["kL"])).length);
  assert.ok(units.unitProblems(kpi("volume", "kL", ["kL", "kg"])).length);
  assert.ok(units.unitProblems(kpi("volume", null, [])).length);
  assert.ok(units.unitProblems(kpi("none", "x", ["y"])).length);
});

// ---------------------------------------------------------------- aggregation
const e = (...vals) => vals.map((value) => ({ value }));

test("sum, average, max, latest over the values present", () => {
  assert.deepEqual(agg.aggregate(e(10, 20, 30), "sum"), { value: 60, count: 3, missing: 0, complete: true });
  assert.equal(agg.aggregate(e(10, 20, 30), "average").value, 20);
  assert.equal(agg.aggregate(e(10, 30, 20), "max").value, 30);
  assert.equal(agg.aggregate(e(10, 30, 20), "latest").value, 20);
  assert.equal(agg.aggregate(e(0.1, 0.2), "sum").value, 0.3, "no binary noise");
});

test("missing is not zero: a gap is reported, never counted as 0", () => {
  const r = agg.aggregate(e(10, null, 30), "average");
  assert.deepEqual(r, { value: 20, count: 2, missing: 1, complete: false }, "average of the two present, not 40/3");
  assert.deepEqual(agg.aggregate(e(null, null), "sum"), { value: null, count: 0, missing: 2, complete: false });
  assert.deepEqual(agg.aggregate([], "sum"), { value: null, count: 0, missing: 0, complete: false });
  assert.equal(agg.aggregate(e(5, null), "latest").value, 5);
});

test("weighted average: LTIFR weighted by hours worked", () => {
  // Site A: 2.0 over 1,000,000 h; site B: 5.0 over 250,000 h → (2,000,000 + 1,250,000) / 1,250,000 = 2.6
  const r = agg.aggregate([{ value: 2, weight: 1_000_000 }, { value: 5, weight: 250_000 }], "weighted_average");
  assert.deepEqual(r, { value: 2.6, count: 2, missing: 0, complete: true });
  const noWeight = agg.aggregate([{ value: 2, weight: 1_000_000 }, { value: 5, weight: null }], "weighted_average");
  assert.deepEqual(noWeight, { value: 2, count: 1, missing: 1, complete: false });
  assert.equal(agg.aggregate([{ value: 2, weight: 0 }], "weighted_average").value, null);
  assert.equal(agg.WEIGHT_KPI.LTIFR, "HOURS_WORKED");
});

test("none: company level only", () => {
  assert.equal(agg.aggregate(e(42), "none").value, 42);
  assert.equal(agg.aggregate(e(42, 43), "none").value, null);
});

test("roll-ups name what's missing", () => {
  const months = period.periodsFor("monthly", "CY", 2026).map((p) => p.start);
  const byStart = new Map([["2026-01-01", { value: 100 }], ["2026-02-01", { value: 120 }], ["2026-03-01", { value: null }]]);
  const year = agg.rollupPeriods(months, byStart, "sum");
  assert.equal(year.value, 220);
  assert.equal(year.missing, 10);
  assert.equal(year.missing_periods.length, 10);
  assert.ok(year.missing_periods.includes("2026-03-01"));
  const sites = agg.rollupSites([1, 2, 3], new Map([[1, { value: 4 }], [3, { value: 6 }]]), "sum");
  assert.deepEqual([sites.value, sites.missing_sites], [10, [2]]);
  assert.deepEqual(agg.rollupSites([1], new Map([[1, { value: 4 }]]), "none").missing_sites, [1]);
});
