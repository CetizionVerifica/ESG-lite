// Unit tests for the historical import plan (P27). Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { filedMonths, monthIndex, planHistoricalRows } = require(path.resolve("dist/services/historicalImport.js"));

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

test("S3-4: totals come from the engine; a row it refuses is skipped with its reason, never the sheet's figure", () => {
  const rows = [
    { year: 2019, month: "January", unit: "kWh", activity: 1000, emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh", calculatedEmission: 99 },
    { year: 2019, month: "February", unit: "MWh", activity: 2, calculatedEmission: 1.25 },
    { year: 2019, month: "February", unit: "kWh", activity: 7 },
  ];
  const engine = new Map([
    [1, { ok: true, total: 0.7, warnings: ["No 2018 factor for \"Grid\"; the 2017 factor was used."] }],
    [2, { ok: false, reason: 'Unit mismatch: Expected "kWh" but received "MWh". No conversion available.' }],
    [3, { ok: true, total: 0.01 }],
  ]);
  const plan = planHistoricalRows(rows, new Map(), new Set(), engine);
  assert.deepEqual(plan.rows.map((r) => [r.status, r.total, r.totalFrom]), [["import", 0.7, "calculated"], ["skip", null, null], ["import", 0.01, "calculated"]]);
  assert.match(plan.rows[0].warnings[0], /2017 factor/);
  assert.match(plan.rows[1].reason, /Unit mismatch/); // not the sheet's 1.25
  // Only an accepted row holds its month: row 3 is February's entry once row 2 is refused.
  assert.equal(plan.rows[2].reason, null);
});

test("the plan skips filed and repeated months and lists people once", () => {
  const row = { year: 2019, unit: "kWh", activity: 10, emissionFactor: 1, emissionFactorUnit: "tCO2e/kWh" };
  const ok = new Map([1, 2, 3, 4].map((n) => [n, { ok: true, total: 10 }]));
  const plan = planHistoricalRows(
    [
      { ...row, month: "January", email: "A@x.example" },
      { ...row, month: "Jan", email: "a@x.example" },
      { ...row, month: "February", email: "known@x.example" },
      { ...row, month: "March", email: "nope" },
    ],
    new Map([["2019-02", "filed"]]),
    new Set(["known@x.example"]),
    ok,
  );
  assert.deepEqual(plan.rows.map((r) => r.status), ["import", "skip", "skip", "import"]);
  assert.match(plan.rows[1].reason, /Same month as row 1/);
  assert.equal(plan.rows[2].reason, "filed");
  assert.deepEqual(plan.people.map((p) => [p.email, p.exists]), [["a@x.example", false], ["known@x.example", true]]);
  assert.deepEqual(plan.invalidEmails, ["nope"]);
  assert.deepEqual([plan.toImport, plan.toSkip], [2, 2]);
});
