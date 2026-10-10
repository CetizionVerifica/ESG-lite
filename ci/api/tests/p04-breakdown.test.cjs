// P04: GET /user/emissions/breakdown, consumption and tCO2e per emission
// category for one category, with the same filters as GET /user/emissions.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call } = require("../helpers.cjs");

const breakdown = (q, who = "manager") => call("GET", `/user/emissions/breakdown?${q}`, who);

test("needs a category", async () => {
  assert.equal((await breakdown("siteIds=1,2")).status, 400);
  assert.equal((await breakdown("categoryId=1&status=done")).status, 400);
  assert.equal((await breakdown("categoryId=1abc")).status, 400);
  assert.equal((await breakdown("categoryId=1&year=abc")).status, 400);
  assert.equal((await breakdown("categoryId=1&month=13")).status, 400);
});

test("totals one category across the caller's sites", async () => {
  const res = await breakdown("categoryId=1&siteIds=1,2");
  assert.equal(res.status, 200);
  assert.equal(res.json.category_id, 1);
  assert.equal(res.json.entries, 4); // 1, 6, 9, 12; never company 2's row 8
  assert.deepEqual(res.json.groups, [
    { emission_category: "(not set)", entries: 4, total_emission: 67.29, consumption: 1739, unit: null },
  ]);
});

test("follows the year, month and status filters", async () => {
  const y2025 = await breakdown("categoryId=1&siteIds=1,2&year=2025");
  assert.deepEqual(y2025.json.groups.map((g) => [g.entries, g.total_emission, g.consumption]), [[2, 14.29, 1720]]);
  const sept = await breakdown("categoryId=1&siteIds=1,2&year=2025&month=9");
  assert.equal(sept.json.entries, 1);
  const rejected = await breakdown("categoryId=1&siteIds=1,2&status=rejected");
  assert.deepEqual(rejected.json.groups.map((g) => g.total_emission), [3]);
});

test("follows the search filter", async () => {
  const res = await breakdown("categoryId=3&siteIds=1,2&search=Mumbai"); // row 3 only
  assert.equal(res.json.entries, 1);
  assert.equal(res.json.groups[0].total_emission, 1);
});

test("stays inside the caller's sites", async () => {
  const user = await breakdown("categoryId=1", "user"); // site 1 only: rows 1 and 9
  assert.equal(user.json.entries, 2);
  assert.equal(user.json.groups[0].total_emission, 54.29);
  const other = await breakdown("categoryId=1", "otherUser"); // company 2: row 8
  assert.equal(other.json.groups[0].total_emission, 999);
  assert.equal((await breakdown("categoryId=1&siteIds=3", "user")).status, 403);
});

test("groups by emission category case-insensitively, with units", () => {
  const { computeBreakdown } = require(path.join(__dirname, "../../../dist/services/emissionBreakdown.js"));
  const groups = computeBreakdown(
    [
      { activity_data: { emission_category: "Natural Gas", Quantity: "1,000" }, activity_data_unit: "m3", total_emission: 2 },
      { activity_data: { emission_category: "natural gas", amount: 500 }, activity_data_unit: "m3", total_emission: "1.5" },
      { activity_data: { emission_category: "Diesel", litres: 40 }, activity_data_unit: "litre", total_emission: 0.1 },
      { activity_data: { emission_category: "Diesel", litres: 60 }, activity_data_unit: "kg", total_emission: 0.2 },
    ],
    ["litres"],
  );
  assert.deepEqual(groups, [
    { emission_category: "Natural Gas", entries: 2, total_emission: 3.5, consumption: 1500, unit: "m3" },
    { emission_category: "Diesel", entries: 2, total_emission: 0.3, consumption: 100, unit: "mixed" },
  ]);
});
