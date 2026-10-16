// S3-13 Scope 3 report rows: kg-then-round totals (D5), method mix, value-chain
// and primary shares, emission-weighted data quality, datasets, GWP sets,
// Unmapped, boundary status and the PDF pages. Runs against the compiled build
// (npm run build && npm run test:unit).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { buildScope3Rows, scope3Blocks, methodMixText } = require(path.resolve("dist/reporting/ghg-scope3.js"));
const { renderBlocks } = require(path.resolve("dist/reporting/blocks.js"));

const theme = {
  id: "t", name: "CI", page: { size: "A4", margin: "18mm" },
  colors: { primary: "#0B2E5C", accent: "#2F6FB0", ink: "#101828", muted: "#475467", surface: "#F5F7FA", border: "#E4E9F0", onPrimary: "#FFFFFF", coverBgFrom: "#061933", coverBgTo: "#0B2E5C" },
  chartPalette: ["#2F6FB0", "#0B2E5C"], fonts: { heading: "Inter", body: "Inter" }, footer: "",
};

const g = (over) => ({
  category_id: 1,
  category_name: "Purchased goods",
  n: 1,
  method: null,
  dq_overall: null,
  data_type: null,
  is_proxy: false,
  dataset: null,
  dataset_version: null,
  factor_type: null,
  gwp_set: null,
  kg: 0,
  biogenic_kg: null,
  ...over,
});

const boundary = [
  { n: 1, status: "included", reason: null, method_note: "Spend for services, supplier figures for steel" },
  { n: 13, status: "not_relevant", reason: "No leased-out assets, franchises or investments", method_note: null },
  { n: 9, status: "excluded", reason: "Customers collect at the gate", method_note: null },
];

test("16 rows: categories 1–15 in order, then Unmapped", () => {
  const { rows } = buildScope3Rows([], boundary, [], { biogenic: false });
  assert.equal(rows.length, 16);
  rows.slice(0, 15).forEach((r, i) => assert.equal(r.n, i + 1));
  assert.equal(rows[15].n, null);
  assert.equal(rows[15].name, "Unmapped");
  assert.equal(rows[15].status, null);
  assert.equal(rows[0].name, "Purchased goods and services");
  assert.equal(rows[0].direction, "upstream");
  assert.equal(rows[14].direction, "downstream");
  // A category without a boundary row reads Screening, as on the Boundary page.
  assert.equal(rows[1].status, "screening");
  assert.equal(rows[12].status, "not_relevant");
  assert.match(rows[12].reason, /No leased-out/);
  assert.equal(rows[0].method_note, "Spend for services, supplier figures for steel");
});

test("kg are summed, then rounded to tCO₂e once (D5)", () => {
  // Three rows of 0.004 t each: summing rounded tonnes would give 0, kg-then-round gives 0.01.
  const groups = [g({ kg: 4 }), g({ kg: 4, method: "spend_based" }), g({ kg: 4, n: 6, category_id: 3 })];
  const { rows, total_tco2e } = buildScope3Rows(groups, boundary, [], { biogenic: false });
  assert.equal(rows[0].tco2e, 0.01);
  assert.equal(total_tco2e, 0.01);
  assert.equal(rows[5].tco2e, 0);
  assert.equal(rows[0].share_pct, 66.7);
});

test("method mix, value-chain, primary and proxy shares are shares of the category's kg", () => {
  const groups = [
    g({ kg: 6000, method: "supplier_specific", data_type: "primary" }),
    g({ kg: 3000, method: "spend_based", data_type: "secondary", is_proxy: true }),
    g({ kg: 1000, method: null }),
  ];
  const [r] = buildScope3Rows(groups, boundary, [], { biogenic: false }).rows;
  assert.deepEqual(r.methods, { supplier_specific: 60, spend_based: 30, unknown: 10 });
  assert.deepEqual(Object.keys(r.methods), ["supplier_specific", "spend_based", "unknown"]);
  assert.equal(r.value_chain_pct, 60);
  assert.equal(r.primary_pct, 60);
  assert.equal(r.proxy_pct, 30);
  assert.equal(methodMixText(r), "Supplier's own figure 60%, From the amount spent 30%, Not recorded 10%");
});

test("data quality is emission-weighted; unscored rows are left out of the score", () => {
  const groups = [g({ kg: 3000, dq_overall: 1 }), g({ kg: 1000, dq_overall: 3 }), g({ kg: 1000 })];
  const [r] = buildScope3Rows(groups, boundary, [], { biogenic: false }).rows;
  assert.equal(r.dq.overall, 1.5);
  assert.equal(r.dq.good_pct, 60);
  assert.equal(r.dq.fair_pct, 0);
  assert.equal(r.dq.poor_pct, 20);
  const none = buildScope3Rows([g({ kg: 10 })], boundary, [], { biogenic: false }).rows[0];
  assert.equal(none.dq.overall, null);
});

test("datasets are distinct per dataset, version and factor type; GWP sets in AR order", () => {
  const groups = [
    g({ kg: 10, dataset: "DEFRA", dataset_version: "2025", factor_type: "cradle_to_gate", gwp_set: "AR6" }),
    g({ kg: 50, dataset: "USEEIO", dataset_version: "v2", factor_type: "eeio_spend", gwp_set: "AR5", method: "spend_based" }),
    g({ kg: 5, dataset: "DEFRA", dataset_version: "2025", factor_type: "cradle_to_gate", gwp_set: "AR6", method: "average_data" }),
    g({ kg: 1, dataset: "Legacy", factor_type: "nonsense" }),
  ];
  const out = buildScope3Rows(groups, boundary, [], { biogenic: false });
  const r = out.rows[0];
  assert.deepEqual(r.datasets, [
    { dataset: "USEEIO", version: "v2", factor_type: "eeio_spend" },
    { dataset: "DEFRA", version: "2025", factor_type: "cradle_to_gate" },
    { dataset: "Legacy", version: null, factor_type: "other" },
  ]);
  assert.deepEqual(r.gwp_sets, ["AR5", "AR6"]);
  assert.deepEqual(out.gwp_sets, ["AR5", "AR6"]);
});

test("Unmapped collects rows and categories without a confirmed number", () => {
  const groups = [g({ n: null, kg: 2000, category_id: 9, category_name: "Misc S3" }), g({ n: 1, kg: 2000 })];
  const mapped = [
    { category_id: 1, category_name: "Purchased goods", ghg_category: 1 },
    { category_id: 9, category_name: "Misc S3", ghg_category: null },
  ];
  const { rows } = buildScope3Rows(groups, boundary, mapped, { biogenic: false });
  const un = rows[15];
  assert.equal(un.tco2e, 2);
  assert.equal(un.share_pct, 50);
  assert.deepEqual(un.mapped_categories, [{ category_id: 9, name: "Misc S3" }]);
  assert.deepEqual(rows[0].mapped_categories, [{ category_id: 1, name: "Purchased goods" }]);
});

test("biogenic CO₂ is null (Not tracked) until the column exists, then summed separately", () => {
  assert.equal(buildScope3Rows([g({ kg: 10 })], boundary, [], { biogenic: false }).rows[0].biogenic_tco2e, null);
  const r = buildScope3Rows([g({ kg: 10000, biogenic_kg: 1500 }), g({ kg: 1, biogenic_kg: null })], boundary, [], { biogenic: true }).rows[0];
  assert.equal(r.biogenic_tco2e, 1.5);
  assert.equal(r.tco2e, 10); // biogenic is not added to the total
});

test("PDF pages: by category with the ch. 11 footnote, exclusions with reasons, methodology, data quality, base year", () => {
  const built = buildScope3Rows(
    [g({ kg: 6000, method: "supplier_specific", dataset: "supplier", factor_type: "supplier", gwp_set: "AR6" }), g({ kg: 4000, n: 6, category_id: 3 })],
    boundary,
    [{ category_id: 1, category_name: "Purchased goods", ghg_category: 1 }],
    { biogenic: false },
  );
  const report = {
    company_id: 1,
    consolidation_approach: "equity_share",
    period: { label: "CY2025", year: 2025, year_type: "CY" },
    total_tco2e: built.total_tco2e,
    gwp_sets: built.gwp_sets,
    tracked: { method: true, dq: false, data_type: false, proxy: false, biogenic: false, gases: false, total_kgco2e: false },
    rows: built.rows,
  };
  const blocks = scope3Blocks(report, null, "Source: test.");
  const text = JSON.stringify(blocks);
  const byCat = blocks.find((b) => b.type === "table" && b.title.startsWith("Scope 3 emissions by GHG Protocol category"));
  assert.ok(byCat);
  assert.equal(byCat.rows.length, 16); // 15 categories + total (Unmapped hidden when empty)
  assert.match(byCat.caption, /excluding biogenic CO₂ and not reduced by offsets/);
  assert.match(byCat.caption, /Biogenic CO₂ is not tracked/);
  assert.equal(byCat.rows[0][0], "1 · Purchased goods and services");
  assert.equal(byCat.rows[0][4], "100.0%"); // value-chain data
  assert.equal(byCat.rows[0][5], "Not tracked");
  const ex = blocks.find((b) => b.type === "table" && b.title === "Excluded and not relevant categories");
  assert.deepEqual(ex.rows.map((r) => r[2]), ["Customers collect at the gate", "No leased-out assets, franchises or investments"]);
  assert.match(text, /Equity share approach/);
  assert.match(text, /IPCC AR6/);
  assert.match(text, /Methodology by category/);
  assert.match(text, /Spend for services, supplier figures for steel/);
  assert.match(text, /Entries are not scored for data quality yet/);
  assert.match(text, /No Scope 3 base year set/);
  const html = renderBlocks(blocks, theme).html;
  for (const t of ["Scope 3 emissions by GHG Protocol category", "Excluded and not relevant categories", "Methodology by category", "Data quality"]) {
    assert.ok(html.includes(t), t);
  }

  const withBase = JSON.stringify(
    scope3Blocks(report, {
      base_year: 2023, year_type: "CY", rationale: "First year with supplier data", policy_note: null, significance_pct: 5,
      frozen_at: "2026-01-05T00:00:00Z", version: 2, categories: [{ n: 1, tco2e: 5 }],
      events: [{ reason: "error", delta_tco2e: 0.6, note: "Invoice keyed twice", created_at: "2026-03-01T00:00:00Z" }],
    }, "Source: test."),
  );
  assert.match(withBase, /Scope 3 base year 2023/);
  assert.match(withBase, /First year with supplier data/);
  assert.match(withBase, /by 5% or more/);
  assert.match(withBase, /Correction of errors/);
  assert.match(withBase, /\+20\.0%/); // 5 t → 6 t
});
