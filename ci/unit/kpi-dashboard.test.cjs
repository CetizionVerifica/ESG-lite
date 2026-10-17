// KPI-10 pure part: coverage counting per framework — exact, partial and
// derived fits; KPIs excluded with a reason; not tracked; not material and
// undecided ESRS topics; voluntary disclosures; BRSR Core. Worked by hand.
// Runs against the compiled build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { coverage, answeringKpis, disclosureState } = require(path.resolve("dist/kpi/dashboard/coverage.js"));

const d = (id, code, requirement = "required", esrs_topic = null) => ({ id, code, title: `T ${code}`, section: "S", requirement, esrs_topic });
const kpis = (entries) => new Map(entries.map(([id, selected, reason, state]) => [id, { selected, reason_excluded: reason, state }]));

test("answering KPIs: exact and partial fits; derived ones only when nothing else answers", () => {
  const mappings = [
    { disclosure_id: 1, kpi_definition_id: 10, fit: "exact" },
    { disclosure_id: 1, kpi_definition_id: 11, fit: "partial" },
    { disclosure_id: 1, kpi_definition_id: 12, fit: "derived" },
    { disclosure_id: 2, kpi_definition_id: 12, fit: "derived" },
  ];
  assert.deepEqual(answeringKpis(1, mappings), [10, 11]);
  assert.deepEqual(answeringKpis(2, mappings), [12]);
  assert.deepEqual(answeringKpis(3, mappings), []);
});

test("a disclosure's state from its KPIs", () => {
  const mappings = [
    { disclosure_id: 1, kpi_definition_id: 10, fit: "exact" },
    { disclosure_id: 1, kpi_definition_id: 11, fit: "partial" },
    { disclosure_id: 1, kpi_definition_id: 12, fit: "derived" },
  ];
  const at = (entries) => disclosureState(d(1, "303-3"), { mappings, kpis: kpis(entries), material: new Map() });
  assert.equal(at([[10, true, null, "approved"], [11, true, null, "approved"], [12, true, null, "missing"]]).state, "approved", "a derived KPI doesn't count beside exact ones");
  assert.equal(at([[10, true, null, "approved"], [11, true, null, "pending"]]).state, "pending");
  assert.equal(at([[10, true, null, "approved"], [11, true, null, "missing"]]).state, "missing");
  assert.equal(at([[10, true, null, "approved"], [11, false, "Not relevant to us", undefined]]).state, "approved", "an excluded KPI doesn't count");
  const nt = at([[10, true, null, "approved"], [11, false, null, undefined]]);
  assert.deepEqual([nt.state, nt.reason_kind], ["missing", "not_tracked"], "not selected without a reason: not tracked");
  const ex = at([[10, false, "No stacks", undefined], [11, false, "No stacks", undefined]]);
  assert.deepEqual([ex.state, ex.reason_kind, ex.reason], ["excluded", "excluded", "No stacks"]);
  assert.equal(at([[10, true, null, "approved"], [11, true, null, "not_due"]]).state, "not_due");
  const none = disclosureState(d(9, "2-21"), { mappings, kpis: kpis([]), material: new Map() });
  assert.deepEqual([none.state, none.reason_kind], ["missing", "not_tracked"], "nothing mapped");
});

test("coverage per framework: counts, percent, excluded listed apart, voluntary ignored, ESRS materiality, BRSR Core", () => {
  const mappings = [
    { disclosure_id: 1, kpi_definition_id: 10, fit: "exact" },
    { disclosure_id: 2, kpi_definition_id: 11, fit: "exact" },
    { disclosure_id: 3, kpi_definition_id: 12, fit: "exact" },
    { disclosure_id: 4, kpi_definition_id: 13, fit: "exact" },
    { disclosure_id: 5, kpi_definition_id: 10, fit: "partial" },
    { disclosure_id: 6, kpi_definition_id: 14, fit: "exact" },
  ];
  const k = kpis([[10, true, null, "approved"], [11, true, null, "pending"], [12, true, null, "missing"], [13, false, "No stacks", undefined], [14, true, null, "approved"]]);
  const brsr = coverage({
    framework: { id: 2, code: "BRSR", version: "BRSR 2023" },
    disclosures: [d(1, "P6-E3", "core"), d(2, "P6-E4", "core"), d(3, "P3-E11", "core"), d(4, "P6-E6"), d(5, "A-20a"), d(6, "P6-L2", "voluntary")],
    mappings,
    kpis: k,
    material: new Map(),
  });
  assert.deepEqual(
    [brsr.required, brsr.approved, brsr.pending, brsr.missing, brsr.not_due, brsr.excluded, brsr.percent, brsr.core],
    [4, 2, 1, 1, 0, 1, 50, { done: 1, total: 3 }],
  );
  assert.deepEqual(brsr.excluded_disclosures, [{ disclosure_id: 4, code: "P6-E6", title: "T P6-E6", reason_kind: "excluded", reason: "No stacks" }]);
  assert.equal(brsr.disclosures.find((x) => x.code === "P6-L2").state, "voluntary");

  const esrs = coverage({
    framework: { id: 3, code: "ESRS", version: "ESRS 2023" },
    disclosures: [d(1, "E3-4", "if_material", "E3"), d(2, "E1-6", "if_material", "E1"), d(3, "S1-14", "if_material", "S1"), d(5, "GOV-1")],
    mappings,
    kpis: k,
    material: new Map([["E3", { material: false, reason: "No water stress at our sites" }], ["E1", { material: true, reason: null }]]),
  });
  assert.deepEqual([esrs.required, esrs.approved, esrs.pending, esrs.excluded, esrs.percent, esrs.core], [2, 1, 1, 2, 50, null]);
  assert.deepEqual(esrs.excluded_disclosures.map((x) => [x.code, x.reason_kind, x.reason]), [["E3-4", "not_material", "No water stress at our sites"], ["S1-14", "not_material", null]], "an undecided topic isn't material");
  assert.equal(coverage({ framework: { id: 1, code: "GRI", version: "x" }, disclosures: [], mappings: [], kpis: k, material: new Map() }).percent, 0);
});
