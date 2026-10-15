// S3-1 category taxonomy: the GHG category table and the name → number
// proposals used by the D1 backfill. Runs against the compiled build
// (npm run build && npm run test:unit).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { GHG_CATEGORIES, isGhgCategoryNumber } = require(path.resolve("dist/scope3/contracts/ghgCategory.js"));
const { proposeGhgCategory } = require(path.resolve("dist/scope3/taxonomy/propose.js"));
const { isScope3 } = require(path.resolve("dist/scope3/taxonomy/service.js"));

test("15 categories, numbered 1–15 in order, unique keys, at least one method each", () => {
  assert.equal(GHG_CATEGORIES.length, 15);
  GHG_CATEGORIES.forEach((c, i) => {
    assert.equal(c.n, i + 1);
    assert.ok(c.methods.length >= 1, c.key);
  });
  assert.equal(new Set(GHG_CATEGORIES.map((c) => c.key)).size, 15);
  assert.ok(isGhgCategoryNumber(15) && !isGhgCategoryNumber(0) && !isGhgCategoryNumber(16) && !isGhgCategoryNumber(1.5));
});

test("an exact GHG Protocol name is confidence 100, whatever the case or punctuation", () => {
  for (const c of GHG_CATEGORIES) {
    assert.deepEqual(proposeGhgCategory(c.name), { ghg_category: c.n, confidence: 100, basis: "exact" });
  }
  assert.deepEqual(proposeGhgCategory("  END OF LIFE treatment of sold products "), { ghg_category: 12, confidence: 100, basis: "exact" });
});

test("legacy category names map before keywords", () => {
  assert.deepEqual(proposeGhgCategory("FERA Purchased Electricity"), { ghg_category: 3, confidence: 95, basis: "legacy_map" });
  assert.deepEqual(proposeGhgCategory("Business Travel - Air"), { ghg_category: 6, confidence: 95, basis: "legacy_map" });
  assert.equal(proposeGhgCategory("Downstream Transportation and Distribution (sea)").ghg_category, 9);
});

test("keywords give the spec's examples and stay below 100", () => {
  const cases = [
    ["Inbound freight", 4],
    ["Outbound freight to customers", 9],
    ["Staff travel", 6],
    ["FERA", 3],
    ["Employee commute survey", 7],
    ["Hazardous waste", 5],
    ["Raw materials", 1],
    ["Capex machinery", 2],
    ["Franchise stores", 14],
    ["Equity investments", 15],
  ];
  for (const [name, n] of cases) {
    const p = proposeGhgCategory(name);
    assert.equal(p.ghg_category, n, name);
    assert.equal(p.basis, "keyword", name);
    assert.ok(p.confidence > 0 && p.confidence < 100, name);
  }
});

test("no match gives no number and confidence 0", () => {
  assert.deepEqual(proposeGhgCategory("Miscellaneous"), { ghg_category: null, confidence: 0, basis: "none" });
  assert.deepEqual(proposeGhgCategory(""), { ghg_category: null, confidence: 0, basis: "none" });
});

test("isScope3 accepts the older spellings only", () => {
  for (const s of ["Scope 3", "scope3", "S3", " scope-3 "]) assert.ok(isScope3(s), s);
  for (const s of ["Scope 1", "", null, undefined, 3]) assert.ok(!isScope3(s), String(s));
});
