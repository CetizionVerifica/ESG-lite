// Unit tests for picking the quantity out of activity_data (manager edit,
// update and create share it). Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pickActivityValue } = require(path.resolve("dist/services/activityValue.js"));

test("a common quantity name wins", () => {
  assert.equal(pickActivityValue({ fuel_type: "3", activity_value: "1600" }), 1600);
  assert.equal(pickActivityValue({ Quantity: "12.5", Meter: "250" }), 12.5);
});

test("a configured select column is never the quantity, whatever its name's spelling", () => {
  // Keys in the order Postgres jsonb returns them: the select comes first.
  const row = { "Waste Type": "6", "Amount of waste": "9.17", "Disposal Method": "5", emission_category: "ETP Sludge - Landfill" };
  assert.equal(pickActivityValue(row, new Set(["waste_type", "disposal_method"])), 9.17);
  // Without the config the old guess picks the option id.
  assert.equal(pickActivityValue(row), 6);
});

test("prefers numbers that look like quantities, then any positive number", () => {
  assert.equal(pickActivityValue({ Grade: "2", Litres: "1500" }), 1500);
  assert.equal(pickActivityValue({ Meter: "main", Units: "7" }), 7);
  assert.equal(pickActivityValue({ Meter: "main" }), 0);
});
