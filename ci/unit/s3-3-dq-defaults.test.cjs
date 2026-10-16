// S3-3 · every rule in 01-contracts.md §3, on the compiled build
// (npm run build && npm run test:unit).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  autoDq,
  dqWithEvidence,
  dataTypeFor,
  geographyScore,
  timeScore,
  reliabilityScore,
  completenessScore,
  technologyScore,
  PRIMARY_METHODS,
} = require(path.resolve("dist/scope3/dq/defaults.js"));
const { overallOf, DQ_INDICATORS } = require(path.resolve("dist/scope3/contracts/dq.js"));
const { METHOD_KEYS } = require(path.resolve("dist/scope3/contracts/ghgCategory.js"));

test("geography: the site's own country is good, a region fair, GLO or missing poor", () => {
  assert.equal(geographyScore("AE", "AE"), 1);
  assert.equal(geographyScore("ae", "AE"), 1, "case does not matter");
  assert.equal(geographyScore("  AE  ", "AE"), 1, "nor does padding");
  assert.equal(geographyScore("EU-27", "AE"), 2, "a region code");
  assert.equal(geographyScore("RER", "AE"), 2);
  assert.equal(geographyScore("GLO", "AE"), 3);
  assert.equal(geographyScore(null, "AE"), 3);
  assert.equal(geographyScore("", "AE"), 3);
  // §3 is silent on another country; a factor for somewhere else is poor.
  assert.equal(geographyScore("IN", "AE"), 3);
  assert.equal(geographyScore("AE", null), 3, "nothing to compare against");
});

test("time: this year or last is good, within three years fair, older poor", () => {
  assert.equal(timeScore(2026, 2026), 1);
  assert.equal(timeScore(2025, 2026), 1);
  assert.equal(timeScore(2027, 2026), 1, "a year ahead is as close as a year behind");
  assert.equal(timeScore(2024, 2026), 2);
  assert.equal(timeScore(2023, 2026), 2);
  assert.equal(timeScore(2022, 2026), 3);
  assert.equal(timeScore(null, 2026), 3);
  assert.equal(timeScore(2026, null), 3);
});

test("reliability: the method sets it, and no evidence caps it at fair", () => {
  // With evidence, a specific method is good.
  for (const method of PRIMARY_METHODS) {
    assert.equal(reliabilityScore(method, true), 1, method);
    assert.equal(reliabilityScore(method, false), 2, `${method} with no evidence`);
  }
  for (const method of ["hybrid", "average_data", "distance_based", "fuel_based"]) {
    assert.equal(reliabilityScore(method, true), 2, method);
    assert.equal(reliabilityScore(method, false), 2, method);
  }
  assert.equal(reliabilityScore("spend_based", true), 3);
  assert.equal(reliabilityScore("spend_based", false), 3);
  assert.equal(reliabilityScore("unknown", true), 3, "a legacy row claims nothing");
});

test("completeness: good unless the row is an estimate", () => {
  assert.equal(completenessScore(false), 1);
  assert.equal(completenessScore(undefined), 1);
  assert.equal(completenessScore(true), 3);
});

test("technology: the factor type leads, then the method", () => {
  assert.equal(technologyScore("average_data", "supplier"), 1, "a supplier's own factor");
  assert.equal(technologyScore("average_data", "process"), 1);
  assert.equal(technologyScore("supplier_specific", null), 1, "a specific method with no type");
  assert.equal(technologyScore("spend_based", "eeio_spend"), 3);
  assert.equal(technologyScore("average_data", null), 2);
  assert.equal(technologyScore("distance_based", "life_cycle"), 2);
});

test("data type: a specific method or attached evidence is primary data", () => {
  for (const method of PRIMARY_METHODS) {
    assert.equal(dataTypeFor({ method }), "primary", method);
  }
  assert.equal(dataTypeFor({ method: "average_data" }), "secondary");
  assert.equal(dataTypeFor({ method: "average_data", hasEvidence: true }), "primary", "a bill or a meter reading");
  assert.equal(dataTypeFor({ method: "spend_based", hasEvidence: false }), "secondary");
});

test("autoDq: every indicator, the overall score and the source", () => {
  const best = autoDq({
    method: "supplier_specific",
    factor: { geography: "AE", year: 2026, factor_type: "supplier" },
    siteCountry: "AE",
    reportingYear: 2026,
    hasEvidence: true,
  });
  assert.deepEqual(best, {
    technology: 1,
    geography: 1,
    time: 1,
    completeness: 1,
    reliability: 1,
    overall: 1,
    source: "auto",
  });

  const worst = autoDq({
    method: "spend_based",
    factor: { geography: "GLO", year: 2019, factor_type: "eeio_spend" },
    siteCountry: "AE",
    reportingYear: 2026,
    isProxy: true,
  });
  assert.deepEqual(worst, {
    technology: 3,
    geography: 3,
    time: 3,
    completeness: 3,
    reliability: 3,
    overall: 3,
    source: "auto",
  });

  // A row with no factor at all still gets a complete, valid answer.
  const bare = autoDq({ method: "average_data", reportingYear: 2026 });
  for (const indicator of DQ_INDICATORS) {
    assert.ok([1, 2, 3].includes(bare[indicator]), `${indicator} is a score`);
  }
  assert.equal(bare.overall, overallOf(bare));
  assert.equal(bare.source, "auto");
});

test("autoDq: the overall score is always the rounded mean of the five", () => {
  for (const method of METHOD_KEYS) {
    for (const hasEvidence of [true, false]) {
      const dq = autoDq({
        method,
        factor: { geography: "EU-27", year: 2024, factor_type: "life_cycle" },
        siteCountry: "AE",
        reportingYear: 2026,
        hasEvidence,
      });
      assert.equal(dq.overall, overallOf(dq), `${method} evidence=${hasEvidence}`);
    }
  }
});

test("evidence attached later: reliability is recomputed and nothing else", () => {
  const before = autoDq({
    method: "supplier_specific",
    factor: { geography: "AE", year: 2026, factor_type: "supplier" },
    siteCountry: "AE",
    reportingYear: 2026,
    hasEvidence: false,
  });
  assert.equal(before.reliability, 2, "no evidence caps it at fair");

  const after = dqWithEvidence(before, "supplier_specific");
  assert.equal(after.reliability, 1, "the file lifts it to good");
  assert.equal(after.overall, overallOf(after));
  for (const indicator of ["technology", "geography", "time", "completeness"]) {
    assert.equal(after[indicator], before[indicator], `${indicator} is untouched`);
  }
  assert.notEqual(after, before, "a new object, never a mutation");
  assert.equal(before.reliability, 2, "the original is unchanged");

  // A judgement somebody entered by hand is never overwritten by a file.
  const manual = { ...before, source: "manual" };
  assert.deepEqual(dqWithEvidence(manual, "supplier_specific"), manual);
});

test("methodFor: the row's own method, then the form's first, then average data", () => {
  const { methodFor } = require(path.resolve("dist/services/emissionWrite/compute.js"));
  const scope3 = { scope: "Scope 3" };
  assert.equal(methodFor({ ...scope3, method_options: ["distance_based", "spend_based"] }, { method: "spend_based" }), "spend_based", "the row wins");
  assert.equal(methodFor({ ...scope3, method_options: ["distance_based", "spend_based"] }, {}), "distance_based", "then the form's first");
  assert.equal(methodFor(scope3, {}), "average_data", "then average data");
  assert.equal(methodFor({ scope: "Scope 1" }, { method: "spend_based" }), null, "never outside Scope 3");
  assert.equal(methodFor({ scope: "Scope 2" }, {}), null);
  assert.equal(methodFor({ scope: null }, {}), null);
});

test("method_options: read in either shape, offered keys most specific first", () => {
  const { readMethodOptions, offeredMethods } = require(path.resolve("dist/scope3/dq/methodOptions.js"));
  const contract = [
    { method: "distance_based", units: ["km", " passenger.km "] },
    { method: "spend_based", units: ["USD"] },
  ];
  assert.deepEqual(readMethodOptions(contract), [
    { method: "distance_based", units: ["km", "passenger.km"] },
    { method: "spend_based", units: ["USD"] },
  ]);
  assert.deepEqual(offeredMethods(contract), ["distance_based", "spend_based"]);
  // A legacy bare key reads as that method with no unit limit.
  assert.deepEqual(readMethodOptions(["fuel_based", "spend_based"]), [
    { method: "fuel_based", units: [] },
    { method: "spend_based", units: [] },
  ]);
  // Junk is skipped, never trusted: unknown keys, "unknown", repeats, stray values.
  assert.deepEqual(offeredMethods(["teleportation", "unknown", { method: "hybrid" }, "hybrid", null, 7, { units: ["kg"] }]), ["hybrid"]);
  assert.deepEqual(offeredMethods(null), []);
  assert.deepEqual(offeredMethods({ method: "hybrid", units: ["kg"] }), []);
});

test("method_options writes: MethodOptionsSchema, refused by name", () => {
  const { parseMethodOptionsInput } = require(path.resolve("dist/scope3/dq/methodOptions.js"));
  assert.deepEqual(parseMethodOptionsInput(undefined), { ok: true, value: undefined }, "absent keeps what is stored");
  assert.deepEqual(parseMethodOptionsInput(null), { ok: true, value: null }, "null clears");
  assert.deepEqual(parseMethodOptionsInput([]), { ok: true, value: null }, "an empty list clears too");
  const ok = parseMethodOptionsInput([{ method: "supplier_specific", units: ["kg"] }]);
  assert.deepEqual(ok, { ok: true, value: [{ method: "supplier_specific", units: ["kg"] }] });

  const field = (v) => parseMethodOptionsInput(v).field;
  assert.equal(field([{ method: "teleportation", units: ["kg"] }]), "method_options[0].method");
  assert.equal(field([{ method: "unknown", units: ["kg"] }]), "method_options[0].method");
  assert.equal(field([{ method: "hybrid", units: ["kg"] }, { method: "spend_based", units: [] }]), "method_options[1].units");
  assert.equal(field(["hybrid"]), "method_options[0]", "bare keys are read, never written");
  assert.equal(field([{ method: "hybrid", units: ["kg"] }, { method: "hybrid", units: ["t"] }]), "method_options");
  assert.equal(field("hybrid"), "method_options");
  assert.match(parseMethodOptionsInput([{ method: "spend_based", units: [] }]).message, /at least one unit/);
});
