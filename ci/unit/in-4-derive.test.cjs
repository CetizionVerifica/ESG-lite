// IN-4 · derive/pathway.ts (pure): gap band, renewable shares, energy intensity,
// completeness %; and the events date window shape. Runs against the build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const d = require(path.resolve("dist/insights/derive/pathway.js"));

test("gapBand: max(0, actual − pathway) for years with both; missing years left out", () => {
  assert.deepEqual(d.gapBand([{ year: 2021, actual: 100, pathway: 100 }, { year: 2022, actual: 105, pathway: 100 }, { year: 2023, actual: 90, pathway: 95 }, { year: 2024, actual: null, pathway: 90 }]), [
    { year: 2021, gap: 0 },
    { year: 2022, gap: 5 },
    { year: 2023, gap: 0 },
  ]);
});

test("renewableShares: % of electricity; null without data, 0 with none renewable", () => {
  assert.deepEqual(d.renewableShares([{ total_kwh: 1000, renewable_kwh: 250 }, null, { total_kwh: 10, renewable_kwh: 0 }, { total_kwh: 0, renewable_kwh: 0 }]), [25, null, 0, null]);
});

test("energyIntensities: kWh per output; null when either is missing or output is 0", () => {
  assert.deepEqual(d.energyIntensities([1000, null, 500, 10], [10, 5, 0, null]), [100, null, null, null]);
});

test("completenessPct: approved ÷ expected; null for a future month or nothing expected", () => {
  assert.equal(d.completenessPct({ emissions_expected: 4, emissions_approved: 2, kpi_expected: 1, kpi_approved: 1 }, false), 60);
  assert.equal(d.completenessPct({ emissions_expected: 4, emissions_approved: 4, kpi_expected: 0, kpi_approved: 0 }, true), null);
  assert.equal(d.completenessPct({ emissions_expected: 0, emissions_approved: 0, kpi_expected: 0, kpi_approved: 0 }, false), null);
  assert.equal(d.completenessPct({ emissions_expected: 3, emissions_approved: 0, kpi_expected: 0, kpi_approved: 0 }, false), 0);
});
