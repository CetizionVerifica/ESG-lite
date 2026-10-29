// S3-14 base-year change detection (src/scope3/baseYear/detect.ts): the
// module's golden cases (frozen base 10,000 t, threshold 5 %) and each
// suggested reason. Runs against the compiled build (npm run build && npm run test:unit).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { createHash } = require("crypto");
const { detectChanges, categoryTotals, largestCategory, retotalled } = require(path.resolve("dist/scope3/baseYear/detect.js"));

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
  assert.equal(t.categories[0].tco2e, 0.008); // 4 + 4 kg, rounded once at 3 dp (#209)
  assert.equal(t.categories[15].n, null);
  assert.equal(t.total_tco2e, 0.012); // 12 kg
});

// #209: a base year frozen before tCO₂e went to 3 dp stores its totals at 2 dp, and a proposal
// dismissed then holds a signature of 2-dp deltas. Neither is rewritten.
// Category 1 120,000 kg, Category 4 34,567.8 kg (34.57 at 2 dp), Category 6 8,123.4 kg (8.12).
const OLD = (() => {
  const s = freeze({ 1: [1, 120_000, FP, 3, 1], 2: [4, 34_567.8, FP, 3, 1], 3: [6, 8_123.4, FP, 3, 2] });
  const stored = { 1: 120, 4: 34.57, 6: 8.12 };
  return { ...s, total_tco2e: 162.69, categories: s.categories.map((c) => ({ n: c.n, tco2e: stored[c.n] ?? 0 })) };
})();
const tOf = (list, n) => list.find((c) => c.n === n).tco2e;

test("#209: a snapshot frozen at 2 dp is read at 3 dp from its rows' kg; the stored one is untouched", () => {
  const r = retotalled(OLD);
  assert.equal(r.total_tco2e, 162.691);
  assert.deepEqual(r.categories, categoryTotals(OLD.rows).categories);
  assert.deepEqual([1, 4, 6].map((n) => tOf(r.categories, n)), [120, 34.568, 8.123]);
  assert.equal(r.total_kg, OLD.total_kg);
  assert.equal(r.version, 1);
  assert.equal(OLD.total_tco2e, 162.69);
  assert.equal(tOf(OLD.categories, 4), 34.57);
  // Without rows there is nothing to work from: the stored totals stay.
  assert.equal(retotalled({ ...OLD, rows: undefined }).total_tco2e, 162.69);
});

test("#209: a 2-dp snapshot against 3-dp rows: no phantom change, and the footer equals the headline", () => {
  const c = detectChanges(OLD, now((s) => (s.rows = { ...clone(OLD.rows), 1: [1, 131_234.4, FP, 3, 1] })), 5);
  assert.equal(c.delta_tco2e, 11.234);
  assert.equal(c.before.total_tco2e, 162.691);
  // Only Category 1 changed: every other category is the same before and after.
  for (const b of c.before.categories) if (b.n !== 1) assert.equal(tOf(c.after.categories, b.n), b.tco2e, `Category ${b.n}`);
  // The before/after table's footer (Σ of the per-category changes) equals the headline.
  const footer = Math.round(c.after.categories.reduce((a, x) => a + x.tco2e - tOf(c.before.categories, x.n), 0) * 1000) / 1000;
  assert.equal(footer, c.delta_tco2e);
  assert.equal(Math.round((c.after.total_tco2e - c.before.total_tco2e) * 1000) / 1000, 11.235); // totals rounded apart, as on screen before
});

/** The signature exactly as production worked it out before #209: deltas at 2 dp, in the changes' order. */
const sig2dp = (changes) => createHash("sha1").update(JSON.stringify(changes)).digest("hex").slice(0, 16);

test("#209: the signature follows kg, not the precision tCO₂e is shown at", () => {
  // 1,234.40 and 1,234.45 kg are both 1.234 t, but not the same change.
  const a = detectChanges(BASE, now((s) => (s.rows[1][1] += 1_234.4)), 5);
  const b = detectChanges(BASE, now((s) => (s.rows[1][1] += 1_234.45)), 5);
  assert.equal(a.changes[0].delta_tco2e, b.changes[0].delta_tco2e);
  assert.notEqual(a.signature, b.signature);
  assert.equal(a.signature, detectChanges(BASE, now((s) => (s.rows[1][1] += 1_234.4)), 5).signature);
  assert.notEqual(a.signature, a.legacy_signature);
});

test("#209: legacy_signature is the 2-dp signature a proposal dismissed before #209 holds", () => {
  // One edited row, +1,234.5 kg: 1.23 t at 2 dp, 1.235 t at 3 dp (values from the production build).
  const one = detectChanges(BASE, now((s) => (s.rows[1][1] += 1_234.5)), 5);
  assert.equal(one.changes[0].delta_tco2e, 1.235);
  assert.equal(one.legacy_signature, sig2dp([["error", "edited", 1, 1, 1, 1.23]]));
  assert.equal(one.legacy_signature, "f2081c0552fac0eb");
  // Two changes that tie at 2 dp keep production's order (Category 1 first), though 3 dp puts Category 4 first.
  const two = detectChanges(BASE, now((s) => { s.rows[1][1] += 1_226; s.rows[2][1] += 1_234; }), 5);
  assert.deepEqual(two.changes.map((x) => [x.n, x.delta_tco2e]), [[4, 1.234], [1, 1.226]]);
  assert.equal(two.legacy_signature, sig2dp([["error", "edited", 1, 1, 1, 1.23], ["error", "edited", 4, 1, 1, 1.23]]));
  assert.equal(two.legacy_signature, "41974acfb1619a3e");
});
