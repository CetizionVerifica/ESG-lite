// Unit tests for the monthly-vs-yearly mode-lock message (F-13). Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { modeLockMessage, yearWindowLabel } = require(path.resolve("dist/services/emissionWrite/checks.js"));

test("a calendar or financial year window reads as CY / FY, anything else as dates", () => {
  assert.equal(yearWindowLabel({ start: "2025-01-01", end: "2025-12-31" }), "CY 2025");
  assert.equal(yearWindowLabel({ start: "2025-04-01", end: "2026-03-31" }), "FY 2025-26");
  assert.equal(yearWindowLabel({ start: "2025-02-01", end: "2025-12-31" }), "2025-02-01 – 2025-12-31");
});

test("a yearly entry over monthly ones names the year and suggests monthly first", () => {
  const conflict = { conflicting_period: "monthly", conflicting_rows: 16, conflicting_year_type: null, window: { start: "2025-01-01", end: "2025-12-31" } };
  assert.equal(
    modeLockMessage(conflict, "yearly"),
    "This category is already filed monthly for CY 2025 (16 monthly entries). Keep entering it monthly, or delete those entries first to file the year as one entry.",
  );
  assert.match(modeLockMessage({ ...conflict, conflicting_rows: 1 }, "yearly"), /\(1 monthly entry\)/);
});

test("a monthly entry over a yearly batch keeps its wording", () => {
  const conflict = { conflicting_period: "yearly", conflicting_rows: 1, conflicting_year_type: "CY", window: { start: "2024-01-01", end: "2024-12-31" } };
  assert.match(modeLockMessage(conflict, "monthly"), /yearly batch covering 2024-01-01 – 2024-12-31/);
});
