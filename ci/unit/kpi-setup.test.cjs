// KPI-3 recommendation rule (src/kpi/setup/recommend.ts) on the seeded library
// (data/kpi): GRI only, BRSR Core, ESRS with E3 not material, calculated KPIs
// pulling in their inputs, retired KPIs and undecided topics.
//   npm run build && node --test ci/unit/kpi-setup.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { recommend, disclosureApplies } = require(path.resolve("dist/kpi/setup/recommend.js"));
const { formulaRefs } = require(path.resolve("dist/kpi/library/formulaRefs.js"));

const DATA = path.resolve("data/kpi");
const frameworks = JSON.parse(fs.readFileSync(path.join(DATA, "frameworks.json"), "utf8")).map((f, i) => ({ id: i + 1, code: f.code, version: f.version }));
const fwId = (code) => frameworks.find((f) => f.code === code).id;
const disclosures = [];
for (const file of fs.readdirSync(path.join(DATA, "disclosures"))) {
  const d = JSON.parse(fs.readFileSync(path.join(DATA, "disclosures", file), "utf8"));
  for (const x of d.disclosures) disclosures.push({ id: disclosures.length + 1, framework_id: fwId(d.framework), code: x.code, requirement: x.requirement, esrs_topic: x.esrs_topic ?? null });
}
const definitions = JSON.parse(fs.readFileSync(path.join(DATA, "definitions.json"), "utf8")).map((d, i) => ({ id: i + 1, code: d.code, source: d.source, formula: d.formula ?? null, active: true }));
const defId = (code) => definitions.find((d) => d.code === code).id;
const mappings = JSON.parse(fs.readFileSync(path.join(DATA, "mappings.json"), "utf8")).map((m) => ({
  disclosure_id: disclosures.find((d) => d.framework_id === fwId(m.framework) && d.code === m.disclosure).id,
  kpi_definition_id: defId(m.kpi),
}));

const run = (codes, material = {}, defs = definitions) =>
  recommend({
    frameworks: frameworks.filter((f) => codes.includes(f.code)),
    disclosures,
    mappings,
    definitions: defs,
    material: new Map(Object.entries(material)),
    refsOf: (f) => formulaRefs(f) ?? [],
  });
const byCode = (recs) => new Map(recs.map((r) => [r.code, r]));

test("nothing enabled: nothing recommended", () => {
  assert.deepEqual(run([]), []);
});

test("GRI only: every KPI a GRI disclosure asks for, with GRI reasons only", () => {
  const recs = byCode(run(["GRI"]));
  assert.ok(recs.get("GHG_SCOPE1").reasons.some((r) => r.disclosure === "305-1" && r.requirement === "required"));
  assert.ok(recs.get("WATER_WITHDRAWAL"));
  for (const r of recs.values()) for (const why of r.reasons) assert.equal(why.framework, "GRI");
  assert.ok(!recs.has("WATER_RECYCLED"));
});

test("BRSR: Core disclosures count, and their reason says core", () => {
  const recs = byCode(run(["BRSR"]));
  const core = [...recs.values()].filter((r) => r.reasons.some((x) => x.requirement === "core"));
  assert.ok(core.length > 0);
  assert.ok(recs.get("GHG_SCOPE1").reasons.some((x) => x.requirement === "core"));
  // Voluntary disclosures never recommend.
  assert.equal(disclosureApplies({ requirement: "voluntary", esrs_topic: null }, new Map()), false);
});

test("ESRS: if_material datapoints follow the topic; E3 not material drops water; undecided topics don't count", () => {
  const material = byCode(run(["ESRS"], { E1: true, E3: true, S1: true }));
  assert.ok(material.get("WATER_WITHDRAWAL")?.reasons.some((x) => x.disclosure.startsWith("E3")));
  const notWater = byCode(run(["ESRS"], { E1: true, E3: false, S1: true }));
  assert.ok(!notWater.has("WATER_WITHDRAWAL"), "E3 not material");
  assert.ok(notWater.has("GHG_SCOPE1"), "E1 material");
  const undecided = byCode(run(["ESRS"], {}));
  assert.ok(!undecided.has("GHG_SCOPE1"), "an undecided topic isn't material");
  assert.equal(disclosureApplies({ requirement: "required", esrs_topic: "E3" }, new Map([["E3", false]])), false);
  assert.equal(disclosureApplies({ requirement: "required", esrs_topic: "E3" }, new Map()), true);
  assert.equal(disclosureApplies({ requirement: "required", esrs_topic: null }, new Map()), true);
});

test("calculated KPIs pull in their inputs, transitively", () => {
  const recs = byCode(run(["GRI"]));
  assert.ok(recs.has("GHG_INTENSITY_REVENUE"));
  for (const code of ["GHG_SCOPE1", "GHG_SCOPE2_LB", "REVENUE"]) assert.ok(recs.get(code).pulled_in_by.includes("GHG_INTENSITY_REVENUE"), code);
  assert.deepEqual(recs.get("REVENUE").reasons, [], "only an input");
  // WATER_INTENSITY_REVENUE → WATER_CONSUMPTION → WATER_WITHDRAWAL, WATER_DISCHARGE.
  const defs = definitions.map((d) => ({ ...d }));
  const only = defs.filter((d) => d.code === "WATER_INTENSITY_REVENUE");
  const recs2 = byCode(
    recommend({
      frameworks: [{ id: 99, code: "X", version: "1" }],
      disclosures: [{ id: 1, framework_id: 99, code: "X-1", requirement: "required", esrs_topic: null }],
      mappings: [{ disclosure_id: 1, kpi_definition_id: only[0].id }],
      definitions: defs,
      material: new Map(),
      refsOf: (f) => formulaRefs(f) ?? [],
    }),
  );
  assert.deepEqual([...recs2.keys()].sort(), ["REVENUE", "WATER_CONSUMPTION", "WATER_DISCHARGE", "WATER_INTENSITY_REVENUE", "WATER_WITHDRAWAL"]);
  assert.deepEqual(recs2.get("WATER_WITHDRAWAL").pulled_in_by, ["WATER_CONSUMPTION"]);
});

test("retired KPIs are never recommended", () => {
  const defs = definitions.map((d) => (d.code === "GHG_SCOPE1" ? { ...d, active: false } : d));
  assert.ok(!byCode(run(["GRI"], {}, defs)).has("GHG_SCOPE1"));
});
