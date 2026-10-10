// Unit tests for the historical import plan (P27). Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { filedMonths, monthIndex, planHistoricalRows, rowTotal } = require(path.resolve("dist/services/historicalImport.js"));

test("a monthly entry takes its month on any day; a yearly one covers its twelve months", () => {
  const filed = filedMonths([
    { date_of_reporting: new Date(2019, 4, 31), reporting_period: "monthly" },
    { date_of_reporting: new Date(2021, 2, 31), reporting_period: "yearly" },
  ]);
  assert.match(filed.get("2019-05"), /already has an entry/);
  assert.equal(filed.has("2019-06"), false);
  // FY 2020-21 ends in March 2021: April 2020 to March 2021.
  assert.match(filed.get("2020-04"), /yearly entry/);
  assert.match(filed.get("2021-03"), /yearly entry/);
  assert.equal(filed.has("2020-03"), false);
});

test("months parse from names, short names and numbers", () => {
  assert.deepEqual(["January", "feb", "3", "13", "Smarch", ""].map(monthIndex), [0, 1, 2, null, null, null]);
});

test("totals are recomputed when the units match, else taken from the sheet", () => {
  assert.deepEqual(rowTotal({ activity: 1000, unit: "kWh", emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh" }), { total: 0.5, from: "calculated" });
  assert.deepEqual(rowTotal({ activity: 2, unit: "MWh", emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh", calculatedEmission: 1.25 }), { total: 1.25, from: "file" });
  assert.equal(rowTotal({ activity: 2, unit: "MWh", emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh" }), null);
});

test("the plan skips filed and repeated months and lists people once", () => {
  const row = { year: 2019, unit: "kWh", activity: 10, emissionFactor: 1, emissionFactorUnit: "tCO2e/kWh" };
  const plan = planHistoricalRows(
    [
      { ...row, month: "January", email: "A@x.example" },
      { ...row, month: "Jan", email: "a@x.example" },
      { ...row, month: "February", email: "known@x.example" },
      { ...row, month: "March", email: "nope" },
    ],
    new Map([["2019-02", "filed"]]),
    new Set(["known@x.example"]),
  );
  assert.deepEqual(plan.rows.map((r) => r.status), ["import", "skip", "skip", "import"]);
  assert.match(plan.rows[1].reason, /Same month as row 1/);
  assert.equal(plan.rows[2].reason, "filed");
  assert.deepEqual(plan.people.map((p) => [p.email, p.exists]), [["a@x.example", false], ["known@x.example", true]]);
  assert.deepEqual(plan.invalidEmails, ["nope"]);
  assert.deepEqual([plan.toImport, plan.toSkip], [2, 2]);
});
