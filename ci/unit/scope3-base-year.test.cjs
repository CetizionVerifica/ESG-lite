// S3-14 base-year change detection (src/scope3/baseYear/detect.ts): the
// module's golden cases (frozen base 10,000 t, threshold 5 %) and each
// suggested reason. Runs against the compiled build (npm run build && npm run test:unit).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { detectChanges, categoryTotals, largestCategory } = require(path.resolve("dist/scope3/baseYear/detect.js"));

const FP = "spend_based|DEFRA|2025|AR6|12|0.5";
const clone = (x) => JSON.parse(JSON.stringify(x));

/** A frozen base year from `{pk: [n, kg, fp, dq, site]}`. */
function freeze(rows, extra = {}) {
  const state = { rows, sites: { 1: null, 2: null }, boundary: { 1: ["included", null], 11: ["included", "10-year life"] }, ...extra };
  return { version: 1, frozen_at: "2026-01-01T00:00:00Z", base_year: 2023, year_type: "CY", ...categoryTotals(state.rows), ...state };
}

// 10,000 t: 6,000 t in Category 1 and 4,000 t in Category 4.
const BASE = freeze({ 1: [1, 6_000_000, FP, 3, 1], 2: [4, 4_000_000, FP, 3, 1] });
const now = (mutate) => {
  const s = clone({ rows: BASE.rows, sites: BASE.sites, boundary: BASE.boundary });
  mutate(s);
  return s;
};

test("golden: a +600 t correction on a 10,000 t base is above 5 % → error proposal", () => {
  const c = detectChanges(BASE, now((s) => (s.rows[1][1] += 600_000)), 5);
  assert.equal(BASE.total_tco2e, 10000);
  assert.equal(c.threshold_tco2e, 500);
  assert.equal(c.delta_tco2e, 600);
  assert.equal(c.delta_pct, 6);
  assert.equal(c.significant, true);
  assert.equal(c.reason, "error");
  assert.deepEqual(c.changes, [{ reason: "error", kind: "edited", n: 1, site_id: 1, rows: 1, delta_tco2e: 600 }]);
  assert.equal(c.after.categories[0].tco2e, 6600);
  assert.equal(largestCategory(c), 1);
});

test("golden: +400 t stays below the threshold → no proposal", () => {
  const c = detectChanges(BASE, now((s) => (s.rows[1][1] += 400_000)), 5);
  assert.equal(c.significant, false);
  assert.equal(c.delta_tco2e, 400);
  assert.equal(c.changes.length, 1);
});

test("golden: +300 t and −300 t in different categories net to zero → none, both listed", () => {
  const c = detectChanges(BASE, now((s) => { s.rows[1][1] += 300_000; s.rows[2][1] -= 300_000; }), 5);
  assert.equal(c.significant, false);
  assert.equal(c.delta_tco2e, 0);
  assert.deepEqual(c.changes.map((x) => [x.n, x.delta_tco2e]).sort(), [[1, 300], [4, -300]]);
});

test("exactly at the threshold counts; nothing changed means no reason", () => {
  assert.equal(detectChanges(BASE, now((s) => (s.rows[1][1] += 500_000)), 5).significant, true);
  const same = detectChanges(BASE, now(() => {}), 5);
  assert.equal(same.significant, false);
  assert.equal(same.reason, null);
  assert.deepEqual(same.changes, []);
});

test("deleted and late rows are errors", () => {
  const c = detectChanges(BASE, now((s) => { delete s.rows[2]; s.rows[9] = [1, 100_000, FP, null, 1]; }), 5);
  assert.equal(c.reason, "error");
  assert.deepEqual(c.changes.map((x) => x.kind).sort(), ["added", "deleted"]);
  assert.equal(c.delta_tco2e, -3900);
});

test("methodology: a changed factor dataset, version or GWP set on a base-year row", () => {
  const c = detectChanges(BASE, now((s) => { s.rows[1][2] = "spend_based|DEFRA|2025|AR5|12|0.5"; s.rows[1][1] = 6_800_000; }), 5);
  assert.equal(c.significant, true);
  assert.equal(c.reason, "methodology");
  assert.equal(c.changes[0].kind, "method");
  assert.equal(c.changes[0].delta_tco2e, 800);
});

test("methodology: boundary status and Category 11 assumptions are listed without tCO₂e", () => {
  const c = detectChanges(BASE, now((s) => { s.boundary[1] = ["excluded", null]; s.boundary[11] = ["included", "12-year life"]; }), 5);
  assert.equal(c.significant, false);
  assert.deepEqual(c.changes.map((x) => x.kind).sort(), ["boundary", "cat11_assumption"]);
  assert.ok(c.changes.every((x) => x.reason === "methodology" && x.delta_tco2e === 0));
});

test("data_quality: rows of a site and category replaced by better-scored ones", () => {
  const c = detectChanges(BASE, now((s) => { delete s.rows[1]; s.rows[7] = [1, 5_200_000, "supplier_specific|supplier||AR6||", 1, 1]; }), 5);
  assert.equal(c.reason, "data_quality");
  assert.equal(c.delta_tco2e, -800);
  assert.ok(c.changes.every((x) => x.reason === "data_quality" && x.kind === "replaced"));
  // A worse-scored replacement is an error, not a data-quality change.
  const worse = detectChanges(BASE, now((s) => { delete s.rows[1]; s.rows[7] = [1, 5_200_000, FP, 4, 1]; }), 5);
  assert.equal(worse.reason, "error");
});

test("structural: rows of a site that left or joined the company, and lease role changes", () => {
  const gone = detectChanges(BASE, now((s) => { delete s.sites[1]; delete s.rows[1]; delete s.rows[2]; }), 5);
  assert.equal(gone.reason, "structural");
  assert.equal(gone.delta_tco2e, -10000);
  assert.ok(gone.changes.every((x) => x.kind === "site_removed"));
  const joined = detectChanges(BASE, now((s) => { s.sites[5] = null; s.rows[50] = [1, 900_000, FP, 3, 5]; }), 5);
  assert.equal(joined.reason, "structural");
  assert.equal(joined.changes[0].kind, "site_added");
  const lease = detectChanges(BASE, now((s) => (s.sites[2] = "lessee")), 5);
  assert.deepEqual(lease.changes, [{ reason: "structural", kind: "lease_role", n: null, site_id: 2, rows: 0, delta_tco2e: 0 }]);
});

test("the suggested reason is the one behind the largest share; the signature tracks the change set", () => {
  const c = detectChanges(BASE, now((s) => { s.rows[1][1] += 200_000; s.rows[2][2] = "x"; s.rows[2][1] += 700_000; }), 5);
  assert.equal(c.reason, "methodology");
  const again = detectChanges(BASE, now((s) => { s.rows[1][1] += 200_000; s.rows[2][2] = "x"; s.rows[2][1] += 700_000; }), 5);
  assert.equal(c.signature, again.signature);
  const other = detectChanges(BASE, now((s) => (s.rows[1][1] += 200_001)), 5);
  assert.notEqual(c.signature, other.signature);
});

test("kg are summed, then rounded once (D5); 16 category rows with Unmapped last", () => {
  const t = categoryTotals({ a: [1, 4, FP, null, 1], b: [1, 4, FP, null, 1], c: [null, 4, FP, null, 1] });
  assert.equal(t.categories.length, 16);
  assert.equal(t.categories[0].tco2e, 0.01);
  assert.equal(t.categories[15].n, null);
  assert.equal(t.total_tco2e, 0.01);
});
