// KPI-2 seed integrity: the library seed in data/kpi/ loads, every mapping
// points at an existing KPI and disclosure, every disclosure has a source URL
// and a verified flag, units and formulas check out, and the v1 set of
// 01-contracts §7 is all there. Runs against the compiled build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { readSeed, seedProblems } = require(path.resolve("dist/kpi/library/seed.js"));
const { formulaRefs, formulaProblems } = require(path.resolve("dist/kpi/library/formulaRefs.js"));

const seed = readSeed(path.resolve("data/kpi"));

test("the seed has no integrity problems", () => {
  assert.deepEqual(seedProblems(seed), []);
});

test("three framework versions, 65 KPIs, 76 disclosures, 144 mappings, every disclosure sourced", () => {
  assert.deepEqual(seed.frameworks.map((f) => `${f.code} ${f.version}`), ["GRI GRI 2021+", "BRSR BRSR 2023", "ESRS ESRS 2023"]);
  assert.equal(seed.definitions.length, 65, "KPIs");
  const per = (fw) => seed.disclosures.filter((d) => d.framework === fw).length;
  assert.deepEqual([per("GRI"), per("BRSR"), per("ESRS")], [32, 26, 18], "disclosures per framework");
  assert.equal(seed.mappings.length, 144, "mappings");
  for (const d of seed.disclosures) {
    assert.match(d.source_url, /^https:\/\/(www\.globalreporting\.org|www\.sebi\.gov\.in|eur-lex\.europa\.eu)\//, `${d.framework} ${d.code}`);
    assert.equal(typeof d.verified, "boolean");
    assert.ok(d.title.length > 0 && d.title.length <= 120, `${d.code}: our own short title`);
  }
});

test("every mapping points at an existing KPI and disclosure", () => {
  const kpis = new Set(seed.definitions.map((d) => d.code));
  const discs = new Set(seed.disclosures.map((d) => `${d.framework}|${d.code}`));
  for (const m of seed.mappings) {
    assert.ok(kpis.has(m.kpi), `mapping to unknown KPI ${m.kpi}`);
    assert.ok(discs.has(`${m.framework}|${m.disclosure}`), `mapping to unknown disclosure ${m.framework} ${m.disclosure}`);
  }
});

test("the 01-contracts §7 v1 KPIs are seeded with their sources and main mappings", () => {
  const by = Object.fromEntries(seed.definitions.map((d) => [d.code, d]));
  const v1 = {
    GHG_SCOPE1: "auto", GHG_SCOPE2_LB: "auto", GHG_SCOPE2_MB: "auto", GHG_SCOPE3: "auto", GHG_INTENSITY_REVENUE: "formula",
    ENERGY_TOTAL: "auto", ENERGY_RENEWABLE: "auto", ENERGY_NON_RENEWABLE: "auto", ENERGY_INTENSITY_REVENUE: "formula",
    WATER_WITHDRAWAL: "manual", WATER_DISCHARGE: "manual", WATER_CONSUMPTION: "formula", WASTE_GENERATED: "manual",
    WASTE_DIVERTED: "manual", WASTE_DISPOSED: "manual", AIR_NOX: "manual", AIR_SOX: "manual", AIR_PM: "manual", REVENUE: "manual",
    EMPLOYEES_TOTAL: "manual", LTIFR: "manual", FATALITIES: "manual", RECORDABLE_INJURIES: "manual", TRAINING_HOURS_AVG: "manual",
    WOMEN_IN_WORKFORCE: "manual", WOMEN_ON_BOARD: "manual", GENDER_PAY_GAP: "manual", COMPLAINTS_RECEIVED: "manual", COMPLAINTS_RESOLVED: "manual",
  };
  for (const [code, source] of Object.entries(v1)) {
    assert.ok(by[code], `${code} is seeded`);
    assert.equal(by[code].source, source, `${code} source`);
  }
  const maps = (kpi) => seed.mappings.filter((m) => m.kpi === kpi).map((m) => `${m.framework} ${m.disclosure}`).sort();
  assert.deepEqual(maps("GHG_SCOPE1"), ["BRSR P6-E7", "ESRS E1-6", "GRI 305-1"]);
  assert.deepEqual(maps("ENERGY_TOTAL"), ["BRSR P6-E1", "ESRS E1-5", "GRI 302-1"]);
  assert.deepEqual(maps("WATER_WITHDRAWAL"), ["BRSR P6-E3", "ESRS E3-4", "GRI 303-3"]);
  assert.deepEqual(maps("WASTE_GENERATED"), ["BRSR P6-E9", "ESRS E5-5", "GRI 306-3"]);
  assert.deepEqual(maps("LTIFR"), ["BRSR P3-E11", "ESRS S1-14", "GRI 403-9"]);
  // Energy shows in GJ for BRSR and MWh for ESRS (D10).
  const unit = (fw, kpi) => seed.mappings.find((m) => m.framework === fw && m.kpi === kpi).display_unit;
  assert.equal(unit("BRSR", "ENERGY_TOTAL"), "GJ");
  assert.equal(unit("ESRS", "ENERGY_TOTAL"), "MWh");
});

test("BRSR Core flags sit on the assured indicators; ESRS topical disclosures are if_material", () => {
  const core = seed.disclosures.filter((d) => d.framework === "BRSR" && d.requirement === "core").map((d) => d.code).sort();
  assert.deepEqual(core, ["P1-E8", "P3-E11", "P3-E1c", "P5-E3b", "P5-E7", "P6-E1", "P6-E3", "P6-E4", "P6-E7", "P6-E9", "P9-E7"]);
  for (const d of seed.disclosures.filter((x) => x.framework === "ESRS" && x.esrs_topic)) assert.equal(d.requirement, "if_material", d.code);
  for (const code of ["E1-5", "E1-6", "E3-4", "E5-5", "S1-6", "S1-9", "S1-13", "S1-14", "S1-16"]) {
    assert.ok(seed.disclosures.some((d) => d.framework === "ESRS" && d.code === code), `ESRS ${code}`);
  }
});

test("governance KPIs (D19): board composition in the governance topic, mapped to verified disclosures", () => {
  const by = Object.fromEntries(seed.definitions.map((d) => [d.code, d]));
  assert.equal(by.WOMEN_ON_BOARD.topic, "governance");
  const maps = (kpi) => seed.mappings.filter((m) => m.kpi === kpi).map((m) => `${m.framework} ${m.disclosure} ${m.fit}`).sort();
  assert.deepEqual(maps("WOMEN_ON_BOARD"), ["BRSR A-21 exact", "ESRS GOV-1 partial", "GRI 2-9 partial", "GRI 405-1 exact"]);
  assert.deepEqual(maps("BOARD_INDEPENDENCE"), ["ESRS GOV-1 exact", "GRI 2-9 partial"]);
  assert.deepEqual(maps("CORRUPTION_INCIDENTS"), ["ESRS G1-4 partial", "GRI 205-3 exact"]);
  assert.deepEqual(maps("ANTI_CORRUPTION_TRAINING_SHARE"), ["ESRS G1-3 partial", "GRI 205-2 partial"]);
  assert.deepEqual(maps("FINES_PAID"), ["BRSR P1-E2 partial", "ESRS G1-4 partial", "GRI 2-27 partial"]);
  assert.deepEqual(maps("ETHICS_CONCERNS"), ["GRI 2-16 partial", "GRI 2-26 partial"]);
  assert.deepEqual(maps("DAYS_PAYABLE"), ["BRSR P1-E8 exact", "ESRS G1-6 partial"]);
  assert.deepEqual(maps("DATA_BREACHES"), ["BRSR P9-E7 exact", "GRI 418-1 partial"]);
  for (const code of ["BOARD_INDEPENDENCE", "CORRUPTION_INCIDENTS", "ANTI_CORRUPTION_TRAINING_SHARE", "FINES_PAID", "ETHICS_CONCERNS", "DAYS_PAYABLE", "DATA_BREACHES"]) {
    assert.deepEqual([by[code].level, by[code].default_frequency, by[code].source], ["company", "annual", "manual"], code);
  }
  assert.equal(by.DATA_BREACHES.topic, "customers", "customer data is a Social topic");
  assert.equal(by.FINES_PAID.canonical_unit, "INR");
  for (const code of ["G1-3", "G1-4", "G1-6"]) {
    const d = seed.disclosures.find((x) => x.framework === "ESRS" && x.code === code);
    assert.deepEqual([d.esrs_topic, d.requirement], ["G1", "if_material"], code);
  }
});

test("seedProblems catches a broken mapping, a missing source URL and a bad unit", () => {
  const broken = JSON.parse(JSON.stringify(seed));
  broken.mappings.push({ ...broken.mappings[0], kpi: "NOPE" });
  broken.disclosures[0].source_url = "";
  broken.definitions.find((d) => d.code === "WATER_WITHDRAWAL").allowed_units.push("kWh");
  const problems = seedProblems(broken);
  assert.ok(problems.some((p) => /unknown KPI/.test(p)));
  assert.ok(problems.some((p) => /no source_url/.test(p)));
  assert.ok(problems.some((p) => /"kWh" can't convert/.test(p)));
});

test("formula references: allowed characters, unknown codes and cycles", () => {
  assert.deepEqual(formulaRefs("(GHG_SCOPE1 + GHG_SCOPE2_LB) / REVENUE"), ["GHG_SCOPE1", "GHG_SCOPE2_LB", "REVENUE"]);
  assert.equal(formulaRefs("A ; DROP"), null);
  assert.equal(formulaRefs("(A + B"), null);
  const known = new Set(["A", "B", "C"]);
  assert.deepEqual(formulaProblems(new Map([["A", "B / C"]]), known), []);
  assert.ok(formulaProblems(new Map([["A", "B / X"]]), known).some((p) => /Unknown KPI X/.test(p.problem)));
  assert.ok(formulaProblems(new Map([["A", "B * 2"], ["B", "A / 2"]]), known).some((p) => /loops back/.test(p.problem)));
});

test("#209: every KPI in tonnes of CO₂e shows 3 decimals, as every tCO₂e figure does; intensities keep theirs", () => {
  const { normaliseUnit } = require(path.resolve("dist/kpi/values/units.js"));
  const { TONNES_DP } = require(path.resolve("dist/services/emissionWrite/round.js"));
  const tonnes = seed.definitions.filter((d) => normaliseUnit(d.canonical_unit) === "tco2e");
  assert.deepEqual(tonnes.map((d) => d.code).sort(), ["GHG_SCOPE1", "GHG_SCOPE2_LB", "GHG_SCOPE2_MB", "GHG_SCOPE3"]);
  for (const d of tonnes) assert.equal(d.decimals, TONNES_DP, d.code);
  assert.equal(seed.definitions.find((d) => d.code === "GHG_INTENSITY_REVENUE").decimals, 4, "tCO2e per INR crore is an intensity");
});
