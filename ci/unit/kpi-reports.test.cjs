// KPI-11 pure parts: the report model against the hand-worked goldens in
// ci/golden/kpi/reports/ (GRI, BRSR, ESRS from the seed library: unit
// conversion, previous-year columns, omissions with reasons, draft, pending
// and rejected values left out), display-unit conversion, the XLSX sheet
// names and headers, and the GRI PDF template's HTML. Runs against the
// compiled build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const XLSX = require("xlsx");

const { buildReportModel } = require(path.resolve("dist/kpi/reports/model.js"));
const { displayFactor, toDisplay } = require(path.resolve("dist/kpi/reports/display.js"));
const { griSheets, GRI_HEADER, GRI_INDEX_SHEET } = require(path.resolve("dist/kpi/reports/gri.js"));
const { brsrSheets, brsrPart } = require(path.resolve("dist/kpi/reports/brsr.js"));
const { esrsSheets, ESRS_HEADER } = require(path.resolve("dist/kpi/reports/esrs.js"));
const { workbook, AUDIT_HEADER } = require(path.resolve("dist/kpi/reports/xlsx.js"));
const { griHtml } = require(path.resolve("dist/kpi/reports/griPdf.js"));

const G = (f) => require(path.resolve(`ci/golden/kpi/reports/${f}.json`));
const input = G("input");
const list = (j, key) => (Array.isArray(j) ? j : j[key]);
const definitions = list(require(path.resolve("data/kpi/definitions.json")), "definitions");
const frameworks = list(require(path.resolve("data/kpi/frameworks.json")), "frameworks");
const mappings = list(require(path.resolve("data/kpi/mappings.json")), "mappings");
const disclosureFiles = { GRI: "GRI-2021", BRSR: "BRSR-2023", ESRS: "ESRS-2023" };

/** The ReportInput the loader would build for input.json, from the seed library. */
function reportInput(code) {
  const fw = frameworks.find((f) => f.code === code);
  const defId = new Map(definitions.map((d, i) => [d.code, i + 1]));
  const disclosures = [...list(require(path.resolve(`data/kpi/disclosures/${disclosureFiles[code]}.json`)), "disclosures")]
    .sort((a, b) => a.sort_key - b.sort_key || a.code.localeCompare(b.code))
    .map((d, i) => ({ id: 1000 + i, code: d.code, title: d.title, section: d.section, requirement: d.requirement, esrs_topic: d.esrs_topic ?? null, source_url: d.source_url }));
  const discId = new Map(disclosures.map((d) => [d.code, d.id]));
  const maps = mappings
    .filter((m) => m.framework === code && m.version === fw.version)
    .map((m) => ({ disclosure_id: discId.get(m.disclosure), kpi_definition_id: defId.get(m.kpi), fit: m.fit, breakdown_key: m.breakdown_key ?? null, display_unit: m.display_unit ?? null, note: m.note ?? null }));
  const kpis = definitions.map((d) => ({
    id: defId.get(d.code), code: d.code, name: d.name, value_type: d.value_type, canonical_unit: d.canonical_unit ?? null, level: d.level, aggregation: d.aggregation,
    frequency: input.selected[d.code] ?? d.default_frequency, source: d.source, selected: d.code in input.selected, reason_excluded: input.excluded[d.code] ?? null,
  }));
  const values = [];
  for (const v of input.values) {
    const months = v.months ?? [null];
    months.forEach((m, n) => {
      const start = m ? `${v.year}-${String(m).padStart(2, "0")}-01` : `${v.year}-01-01`;
      values.push({ id: v.id + n, kpi_definition_id: defId.get(v.code), site_id: v.site, period_start: start, frequency: m ? "monthly" : "annual", value: v.value, text: null, breakdown: v.breakdown ?? null, status: v.status ?? "approved" });
    });
  }
  const pending = values.filter((v) => v.status === "pending" && v.period_start.startsWith(String(input.year)));
  return {
    framework: { code, version: fw.version, name: fw.name }, year: input.year, year_type: input.year_type, company: input.company, sites: input.sites,
    disclosures, mappings: maps, kpis, material: input.material, values,
    evidence: Object.fromEntries(Object.entries(input.evidence).map(([k, n]) => [Number(k), n])),
    pending: { count: pending.length, value_ids: pending.map((v) => v.id) },
  };
}

const project = (model) => ({
  totals: model.totals,
  pending: model.pending.count,
  rows: model.rows.map((r) => ({
    code: r.code,
    status: r.status,
    items: r.items.map((i) => ({
      code: i.code, status: i.status, value: i.value, previous: i.previous, unit: i.unit, complete: i.complete, evidence: i.evidence_count,
      ...(i.breakdown ? { breakdown: i.breakdown } : {}), ...(i.unit_note ? { unit_note: i.unit_note } : {}),
    })),
  })),
  omissions: model.omissions.map((o) => [o.code, o.reason_kind, o.reason]),
});

for (const code of ["GRI", "BRSR", "ESRS"]) {
  test(`golden: the ${code} model equals the hand-worked figures`, () => {
    const want = G(code.toLowerCase());
    const got = project(buildReportModel(reportInput(code)));
    assert.deepEqual(got.totals, want.totals);
    assert.equal(got.pending, want.pending);
    assert.deepEqual(got.rows, want.rows);
    assert.deepEqual(got.omissions.map(([c, k, r], i) => (want.omissions[i]?.length === 3 ? [c, k, r] : [c, k])), want.omissions);
  });
}

test("approved values only: draft, pending and rejected values never reach a figure or the value ids", () => {
  const model = buildReportModel(reportInput("GRI"));
  const ids = model.rows.flatMap((r) => r.items.flatMap((i) => [...i.value_ids, ...i.previous_value_ids]));
  for (const notApproved of [127, 128, 129, 302, 342, 391]) assert.ok(!ids.includes(notApproved), String(notApproved));
  const w = model.rows.find((r) => r.code === "303-3").items[0];
  assert.deepEqual(w.value_ids, [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 121, 122, 123, 124, 125, 126]);
  assert.equal(w.evidence_count, 2, "the pending value's 4 files aren't counted");
  assert.deepEqual([w.missing_sites, w.missing_periods.length], [[], 6], "Plant B: July–December");
  assert.equal(model.omissions.find((o) => o.code === "405-1").reason, "No approved value for 2026.");
  assert.equal(model.omissions.find((o) => o.code === "2-8").reason, "Not tracked in ESGLite");
});

test("display units: exact factors, 'per' units part by part, never a guessed currency", () => {
  assert.equal(displayFactor("GJ", "GJ"), 1);
  assert.equal(toDisplay(5400, "GJ", "MWh").value, 1500);
  assert.equal(toDisplay(1500, "kL", "ML").value, 1.5);
  assert.equal(toDisplay(1500, "kL", "m3").value, 1500);
  assert.equal(toDisplay(2.5, "tonne", "kg").value, 2500);
  assert.equal(toDisplay(10, "kL per INR crore", "m3 per INR lakh").value, 0.1, "per crore → per lakh: ÷ 100");
  const eur = toDisplay(1.9, "tCO2e per INR crore", "tCO2e per EUR million");
  assert.deepEqual(eur, { value: 1.9, unit: "tCO2e per INR crore", unit_note: "Shown in tCO2e per INR crore: tCO2e per EUR million needs a conversion ESGLite doesn't make." });
  assert.deepEqual(toDisplay(3, "count", null), { value: 3, unit: "count", unit_note: null });
  assert.equal(displayFactor("tCO2e", "tonne"), null, "CO2e mass never becomes a plain mass");
});

const audit = [{ value_id: 101, kpi_code: "WATER_WITHDRAWAL", kpi_name: "Water withdrawn", site_id: 1, site_name: "Plant A", period_start: "2026-01-01", period_label: "Jan 2026", value: 100, unit: "kL", value_canonical: 100, canonical_unit: "kL", source: "manual", approved_by: 2, approved_by_name: "Mia Manager", approved_at: "2026-02-03T10:00:00.000Z", evidence: ["bill-jan.pdf", "meter.jpg"] }];

test("XLSX: sheet names and headers per framework; an audit trail sheet in each", () => {
  const read = (sheets) => XLSX.read(workbook(sheets), { type: "buffer" });
  const gri = read(griSheets(buildReportModel(reportInput("GRI")), audit));
  assert.deepEqual(gri.SheetNames, [GRI_INDEX_SHEET, "Audit trail"]);
  const griRows = XLSX.utils.sheet_to_json(gri.Sheets[GRI_INDEX_SHEET], { header: 1, defval: null });
  assert.equal(griRows[0][0], "GRI content index · Golden Steel · 2026");
  assert.deepEqual(griRows[3], GRI_HEADER);
  assert.deepEqual(griRows[4], ["GRI 2 General disclosures", ...Array(GRI_HEADER.length - 1).fill(null)].slice(0, griRows[4].length));
  const withdrawal = griRows.find((r) => r[0] === "303-3");
  assert.deepEqual(withdrawal.slice(0, 7), ["303-3", withdrawal[1], "Water withdrawn", 1.5, "ML", "Plant A, Plant B", 1.56]);
  assert.match(withdrawal[7], /Incomplete/);
  assert.match(withdrawal[7], /By source: groundwater 0.72, third_party 0.48/);
  const omitted = griRows.find((r) => r[0] === "405-1");
  assert.deepEqual([omitted[9], omitted[10]], ["Yes", "No approved value for 2026."]);
  const trail = XLSX.utils.sheet_to_json(gri.Sheets["Audit trail"], { header: 1, defval: null });
  assert.deepEqual(trail[0], AUDIT_HEADER);
  assert.deepEqual(trail[1], [101, "WATER_WITHDRAWAL", "Water withdrawn", "Plant A", "Jan 2026", 100, "kL", 100, "kL", "manual", "Mia Manager", "2026-02-03", "bill-jan.pdf; meter.jpg"]);

  const brsr = read(brsrSheets(buildReportModel(reportInput("BRSR")), audit));
  assert.deepEqual(brsr.SheetNames, ["Section A", "Principle 3", "Principle 5", "Principle 6", "Audit trail"]);
  const p6 = XLSX.utils.sheet_to_json(brsr.Sheets["Principle 6"], { header: 1, defval: null });
  assert.deepEqual(p6[3], ["Indicator", "Disclosure", "Parameter", "Unit", "2026 (current year)", "2025 (previous year)", "BRSR Core", "Assurance evidence (files)", "Notes"]);
  const energy = p6.find((r) => r[2] === "Energy consumed");
  assert.ok(energy, JSON.stringify(p6.map((r) => r[2])));
  assert.deepEqual(energy.slice(3, 8), ["GJ", 5400, 3240, "Core", 0]);
  assert.deepEqual(p6.find((r) => r[0] === "P6-E9").slice(4, 7), ["Not tracked in ESGLite", null, "Core"]);
  assert.equal(brsrPart("Principle 6 · Leadership"), "Principle 6");

  const esrs = read(esrsSheets(buildReportModel(reportInput("ESRS")), audit));
  assert.deepEqual(esrs.SheetNames, ["Datapoints", "Not material", "Audit trail"]);
  const dp = XLSX.utils.sheet_to_json(esrs.Sheets.Datapoints, { header: 1, defval: null });
  assert.deepEqual(dp[3], ESRS_HEADER);
  assert.deepEqual(dp.find((r) => r[1] === "E1-5" && r[4] === 1500).slice(0, 8), ["E1", "E1-5", dp.find((r) => r[1] === "E1-5")[2], "Energy consumed", 1500, "MWh", 900, "Material"]);
  const nm = XLSX.utils.sheet_to_json(esrs.Sheets["Not material"], { header: 1, defval: null });
  assert.deepEqual(nm, [["Topic", "Reason", "Datapoints not reported"], ["E3", "No water stress at our sites", "E3-4"], ["E5", "Materiality not assessed.", "E5-5"], ["S1", "Materiality not assessed.", "S1-6, S1-7, S1-9, S1-10, S1-13, S1-14, S1-15, S1-16, S1-17"]]);
});

test("GRI PDF template: the brand, every value, omissions, escaped text (HTML snapshot)", () => {
  const theme = { id: "t", name: "Golden <Steel>", page: { size: "A4", margin: "1mm" }, colors: { primary: "#123456", accent: "#abcdef", ink: "#111111", muted: "#555555", surface: "#eeeeee", border: "#dddddd", onPrimary: "#ffffff", coverBgFrom: "#000000", coverBgTo: "#111111" }, chartPalette: [], fonts: { heading: "Georgia, serif", body: "Arial, sans-serif" }, footer: "Confidential — prepared for Golden Steel" };
  const model = buildReportModel(reportInput("GRI"));
  model.company.name = "Golden <Steel> & Co";
  const html = griHtml(model, theme, audit, { withScripts: false });
  assert.ok(!html.includes("<Steel>"), "escaped");
  assert.ok(html.includes("Golden &lt;Steel&gt; &amp; Co"));
  assert.ok(html.includes("background: #123456"), "the brand's primary colour");
  assert.ok(html.includes(`<tr class="section"><th colspan="7">GRI 305 Emissions</th></tr>`));
  assert.ok(html.includes(`<td class="code">305-1</td>`) && html.includes("180.75"));
  assert.ok(html.includes(`<td class="code">405-1</td><td>`) && html.includes("No approved value for 2026."));
  assert.ok(!html.includes("<script>"), "no scripts in the snapshot form");
  assert.equal((html.match(/<tr>/g) || []).length, 1 + model.rows.reduce((n, r) => n + r.items.length, 0), "the header and a line per KPI");
  assert.ok(griHtml(model, theme, audit).includes("window.__ready=true"), "the printed form signals the printer");
});
