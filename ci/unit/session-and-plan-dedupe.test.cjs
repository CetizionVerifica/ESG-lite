// Unit tests for the session password fingerprint (services/sessionCheck) and
// the Category 15 plan's already-imported filter (scope3/assets/service).
// Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.JWT_SECRET = process.env.JWT_SECRET || "unit-test-secret";
const { passwordStamp } = require(path.resolve("dist/services/sessionCheck.js"));
const { withoutImported } = require(path.resolve("dist/scope3/assets/service.js"));

test("the password fingerprint is stable, differs per hash and doesn't contain the hash", () => {
  const a = "$2b$10$abcdefghijklmnopqrstuuJ4k1y0bS9zv7m0c4mQ1n1i3kq5bO7W";
  const b = "$2b$10$abcdefghijklmnopqrstuuJ4k1y0bS9zv7m0c4mQ1n1i3kq5bO7X";
  assert.equal(passwordStamp(a), passwordStamp(a));
  assert.notEqual(passwordStamp(a), passwordStamp(b));
  assert.equal(passwordStamp(a).length, 22);
  assert.ok(!a.includes(passwordStamp(a)));
});

const plan = () => ({
  rows: [
    { row_ref: "investment-1", activity_name: "Reported emissions [tCO2e]" },
    { row_ref: "investment-2-1", activity_name: "Telecom" },
    { row_ref: "investment-2-2", activity_name: "Retail" },
  ],
  planned: [
    { investment_id: 1, row_refs: ["investment-1"], method: "investment_specific" },
    { investment_id: 2, row_refs: ["investment-2-1", "investment-2-2"], method: "average_data" },
  ],
  skipped: [{ investment_id: 3, investee: "Loan Co", reason: "out_of_scope" }],
});
const investments = [{ id: 1, investee: "Specific Co" }, { id: 2, investee: "Average Co" }, { id: 3, investee: "Loan Co" }];

test("nothing saved for the year: the plan is unchanged", () => {
  const out = plan();
  assert.equal(withoutImported(out, investments, new Set()), out);
});

test("an investment with any saved row is left out whole, listed once as already_imported", () => {
  // Investment 2 was saved under an older split (one sector): both its new rows still go.
  const out = withoutImported(plan(), investments, new Set(["#2"]));
  assert.deepEqual(out.rows.map((r) => r.row_ref), ["investment-1"]);
  assert.deepEqual(out.planned.map((p) => p.investment_id), [1]);
  assert.deepEqual(out.skipped, [
    { investment_id: 3, investee: "Loan Co", reason: "out_of_scope" },
    { investment_id: 2, investee: "Average Co", reason: "already_imported" },
  ]);
});

test("a fully saved year leaves no rows to plan", () => {
  const out = withoutImported(plan(), investments, new Set(["#1", "#2"]));
  assert.deepEqual(out.rows, []);
  assert.deepEqual(out.planned, []);
  assert.equal(out.skipped.filter((s) => s.reason === "already_imported").length, 2);
});
