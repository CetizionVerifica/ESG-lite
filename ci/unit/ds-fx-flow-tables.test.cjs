// DS fix · the GHG flow tables get rows on the server (src/studio/sources/flows.ts):
// the factor table from the approved rows' factor snapshots, the Scope 3
// categories table from computeScope3's rows and the report inputs'
// exclusions; and the one renderer prints those rows instead of "Not reported".
// Runs against the build: npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const dist = (p) => require(path.resolve("dist", p));
const flows = dist("studio/sources/flows.js");
const { buildScope3Rows } = dist("reporting/ghg-scope3.js");
const H = dist("reporting/studio/html.js");
const R = dist("reporting/studio/render/index.js");

const tracked = { method: true, dq: true, data_type: true, proxy: false, biogenic: false, gases: false, total_kgco2e: true };

/** A Scope 3 report as computeScope3 returns it: Cat 1 and Cat 6 with approved data, Cat 8 excluded on the boundary. */
function report() {
  const groups = [
    { category_id: 31, category_name: "Purchased goods", n: 1, method: "spend_based", dq_overall: 2, data_type: "secondary", is_proxy: false, dataset: "USEEIO", dataset_version: "2.0", factor_type: "eeio_spend", gwp_set: "AR5", kg: 12345.6, biogenic_kg: null },
    { category_id: 36, category_name: "Business travel", n: 6, method: "distance_based", dq_overall: 1, data_type: "primary", is_proxy: false, dataset: "DEFRA", dataset_version: "2024", factor_type: "combustion", gwp_set: "AR5", kg: 1500, biogenic_kg: null },
  ];
  const boundary = [
    { n: 1, status: "included", reason: null, method_note: null },
    { n: 6, status: "included", reason: null, method_note: "Flights and hotels." },
    { n: 8, status: "excluded", reason: "No leased assets.", method_note: null },
  ];
  const built = buildScope3Rows(groups, boundary, [], tracked);
  return { company_id: 1, consolidation_approach: "operational_control", period: { label: "CY 2025", year: 2025, year_type: "CY" }, total_tco2e: built.total_tco2e, gwp_sets: built.gwp_sets, tracked, rows: built.rows };
}

test("dataFlows lists the factor table and Scope 3 sections only", () => {
  const doc = { pages: [{ kind: "freeform", id: "a" }, { kind: "flow", id: "s3", flowType: "scope3_categories" }, { kind: "flow", id: "ef", flowType: "ghg_factor_table" }, { kind: "flow", id: "t", flowType: "toc" }] };
  assert.deepEqual(flows.dataFlows(doc), [
    { id: "s3", flowType: "scope3_categories" },
    { id: "ef", flowType: "ghg_factor_table" },
  ]);
});

test("scope3Rows: 15 categories; reported with computeScope3's tCO₂e, excluded with the inputs' reason, the rest not addressed", () => {
  const r = report();
  const inputs = { exclusions: { value: [{ what: "Category 8 · Upstream leased assets", reason: "No leased assets." }], source: "prefill" } };
  const rows = flows.scope3Rows(r, inputs);
  assert.equal(rows.length, 15);
  assert.deepEqual(rows.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const c1 = rows.find((x) => x.n === 1);
  assert.equal(c1.status, "reported");
  assert.equal(c1.display, "12.346", "computeScope3's tCO₂e (12.346), formatted once");
  assert.equal(c1.dq, "2.0");
  assert.match(c1.method, /100%/);
  const c6 = rows.find((x) => x.n === 6);
  assert.equal(c6.status, "reported");
  assert.equal(c6.display, "1.500");
  assert.equal(c6.reason, "Flights and hotels.");
  const c8 = rows.find((x) => x.n === 8);
  assert.equal(c8.status, "excluded");
  assert.equal(c8.reason, "No leased assets.");
  assert.equal(c8.display, undefined);
  for (const n of [2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14, 15]) assert.equal(rows.find((x) => x.n === n).status, "not_addressed", `category ${n}`);
  // Without the exclusion in the report inputs, a boundary exclusion alone isn't "excluded" (as the DS-12 checks read it).
  assert.equal(flows.scope3Rows(r, {}).find((x) => x.n === 8).status, "not_addressed");
});

test("factorTable: a group per scope, factor values as stored, the entries count and a note", () => {
  const rows = [
    { scope: "Scope 1", category: "Stationary Combustion", factor: "Diesel", value: "2.68000000", unit: "litre", source: "DEFRA", version: "2024", gwp: "AR5", rows: 3 },
    { scope: "Scope 2", category: "Purchased Electricity", factor: "Grid India", value: "0.71600000", unit: "kWh", source: "CEA", version: "v20", gwp: null, rows: 1 },
  ];
  const t = flows.factorTable(rows, 2, "CY 2025");
  assert.deepEqual(t.columns, flows.FACTOR_COLUMNS);
  assert.deepEqual(t.rows[0], { cells: ["Scope 1"], group: true });
  assert.deepEqual(t.rows[1].cells, ["Stationary Combustion", "Diesel", "2.68", "litre", "DEFRA 2024", "AR5", 3]);
  assert.deepEqual(t.rows[2], { cells: ["Scope 2"], group: true });
  assert.deepEqual(t.rows[3].cells, ["Purchased Electricity", "Grid India", "0.716", "kWh", "CEA v20", "Not recorded", 1]);
  assert.match(t.note, /CY 2025/);
  assert.match(t.note, /2 approved entries have no factor record/);
  assert.equal(flows.factorValueText("0.00012345"), "0.00012345");
  assert.equal(flows.factorValueText(null), null);
});

test("the renderer prints the rows: no 'Not reported' in either section", () => {
  const doc = {
    version: 2,
    kind: "ghg",
    format: "a4",
    meta: { title: "x", year: 2025, yearType: "CY", sites: "all" },
    design: { theme: {} },
    pages: [
      { id: "s3", kind: "flow", name: "Scope 3 categories", flowType: "scope3_categories", options: { categories: [], showDq: true, showMethod: true } },
      { id: "ef", kind: "flow", name: "Emission factors", flowType: "ghg_factor_table", options: {} },
    ],
  };
  const factors = flows.factorTable([{ scope: "Scope 1", category: "Stationary Combustion", factor: "Diesel", value: "2.68", unit: "litre", source: "DEFRA", version: "2024", gwp: "AR5", rows: 3 }], 0, "CY 2025");
  const data = R.renderData([], [], { values: [] }, { flow: { ef: factors }, scope3: { s3: flows.scope3Rows(report(), { exclusions: { value: [{ what: "Category 8", reason: "No leased assets." }] } }) } });
  const { document } = H.documentHtml(doc, data, { mode: "sheet", assets: { urls: {} } });
  assert.doesNotMatch(document, /Not reported/);
  assert.equal((document.match(/<tr data-category=/g) || []).length, 15);
  assert.match(document, /data-category="1" data-status="reported"/);
  assert.match(document, /data-category="8" data-status="excluded"/);
  assert.match(document, /ds-factor-table/);
  assert.match(document, /Diesel/);
  // Without the extras both sections fall back to "Not reported" (the bug this fixes).
  const empty = H.documentHtml(doc, R.renderData([], [], { values: [] }), { mode: "sheet", assets: { urls: {} } }).document;
  assert.equal((empty.match(/class="ds-flow-missing"/g) || []).length, 2);
});
