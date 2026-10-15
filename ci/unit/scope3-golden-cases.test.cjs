// S3-0: the shape of ci/golden/scope3/cases.json (docs/scope3/01-contracts.md §9).
// Every case is owned by a Scope 3 module and uses a method its category
// offers; cases with figures reproduce their expected kgCO₂e; a case can only
// run once it has figures and no open question.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const cat = require(path.resolve("dist/scope3/contracts/ghgCategory.js"));
const { cases } = require(path.resolve("ci/golden/scope3/cases.json"));

const rowsKg = (c) => c.rows.reduce((s, r) => s + r.quantity * (r.share ?? 1) * c.factors[r.factor].kgco2e_per_unit, 0);

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
    assert.ok(Math.abs(sum - c.expected_kgco2e) <= Math.max(0.5, c.expected_kgco2e * 0.001), `${c.id}: rows give ${sum}`);
  }
});

test("a run case has figures and no open question", () => {
  for (const c of cases.filter((k) => k.status === "run")) {
    assert.equal(typeof c.expected_kgco2e, "number", `${c.id} runs without an expected figure`);
    assert.equal(c.open_question, undefined, `${c.id} runs with an open question`);
  }
});
