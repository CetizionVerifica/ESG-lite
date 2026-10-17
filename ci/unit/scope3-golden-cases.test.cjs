// S3-0: the shape of ci/golden/scope3/cases.json (docs/scope3/01-contracts.md §9).
// Every case is owned by a Scope 3 module and uses a method its category
// offers; cases with figures reproduce their expected kgCO₂e; a case can only
// run once it has figures and no open question.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const cat = require(path.resolve("dist/scope3/contracts/ghgCategory.js"));
const schemas = require(path.resolve("dist/scope3/contracts/schemas.js"));
const { cases, tolerance } = require(path.resolve("ci/golden/scope3/cases.json"));

/** The same rule as ci/golden/scope3/run.cjs, read from cases.json. */
const within = (actual, expected) => Math.abs(actual - expected) <= Math.max(tolerance.kg, Math.abs(expected) * tolerance.relative);

/**
 * Plain arithmetic, independent of the engine. S3-6 rows with `supplier`
 * multiply the quantity by the supplier's figure, or add up their hybrid
 * input lines (none of the cases allocates facility data).
 */
const rowKg = (c, r) => {
  if (!r.supplier) return r.quantity * (r.share ?? 1) * c.factors[r.factor].kgco2e_per_unit;
  const own = r.supplier.factor ? r.quantity * (r.share ?? 1) * c.factors[r.supplier.factor].kgco2e_per_unit : 0;
  return own + (r.supplier.lines ?? []).reduce((s, l) => s + l.quantity * c.factors[l.factor].kgco2e_per_unit, 0);
};
const rowsKg = (c) => c.rows.reduce((s, r) => s + rowKg(c, r), 0);

test("at least 15 worked examples with figures, unique ids, each owned and skipped or run", () => {
  assert.ok(cases.filter((c) => c.id.startsWith("ex-") && c.expected_kgco2e !== null).length >= 15);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  for (const c of cases) {
    assert.match(c.owner, /^S3-(1[0-6]|[1-9])$/, c.id);
    assert.ok(["skip", "run"].includes(c.status), c.id);
    assert.ok(c.guidance_ref && c.guidance_ref.example && c.source, c.id);
    assert.ok(c.expected_kgco2e === null || typeof c.expected_kgco2e === "number", c.id);
  }
});

test("each guidance example uses a method its category offers", () => {
  for (const c of cases.filter((k) => k.category !== null)) {
    assert.ok(cat.methodAllowed(c.category, c.method), `${c.id}: ${c.method} not offered for Category ${c.category}`);
  }
});

test("rows multiply out to the expected kgCO₂e, unless the case carries an open question", () => {
  for (const c of cases.filter((k) => k.rows.length && !k.open_question)) {
    const sum = rowsKg(c);
    assert.ok(within(sum, c.expected_kgco2e), `${c.id}: rows give ${sum}`);
  }
});

test("a run case has figures and no open question", () => {
  for (const c of cases.filter((k) => k.status === "run")) {
    assert.equal(typeof c.expected_kgco2e, "number", `${c.id} runs without an expected figure`);
    assert.equal(c.open_question, undefined, `${c.id} runs with an open question`);
  }
});

test("proxy cases carry a valid emission.proxy, so the engine routes them to methods/proxy.ts", () => {
  const proxies = cases.filter((c) => c.owner === "S3-12");
  assert.ok(proxies.length >= 2);
  for (const c of proxies) assert.ok(schemas.ProxySchema.safeParse(c.proxy).success, c.id);
});
