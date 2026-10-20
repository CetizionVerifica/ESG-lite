// DS-12 checks (pure, on the build): the typed-number matcher's golden table (RS-9), every
// GHG completeness check on a positive and a negative fixture, the content and layout checks,
// severity by framework (D8), the sort order, and the golden: the seed GHG Inventory template
// with fixed data facts has exactly the checks in ci/golden/ds/checks/inventory.json.
//
//   npm run build && node --test ci/unit/ds-12-checks.test.cjs
//   UPDATE_SNAPSHOT=1 node --test ci/unit/ds-12-checks.test.cjs    # after an intended change
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const D = (p) => require(path.join(ROOT, "dist", p));
const N = D("reporting/studio/render/checks/number.js");
const C = D("studio/contracts/index.js");
const { docIndex } = D("studio/checks/walk.js");
const { ghgChecks } = D("studio/checks/ghg.js");
const { contentChecks } = D("studio/checks/content.js");
const { layoutChecks, rotatedBox } = D("studio/checks/layout.js");
const { numberChecks } = D("studio/checks/numbers.js");
const { runCheckFamilies, sortChecks, warningIds } = D("studio/checks/service.js");
const { readLibrarySeeds } = D("studio/library/seed.js");

const GOLDEN = path.join(ROOT, "ci/golden/ds/checks/inventory.json");

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const base = (o = {}) => ({
  schemaVersion: 2,
  kind: "ghg",
  purpose: "report",
  format: "a4",
  meta: { title: "T", year: 2025, yearType: "CY", sites: "all", frameworks: ["GHGP"], language: "en", ...(o.meta ?? {}) },
  design: { templateId: "t", templateVersion: 1, theme: {} },
  pages: o.pages ?? [],
  assets: [],
  ...(o.kind ? { kind: o.kind } : {}),
});
const page = (id, elements = [], extra = {}) => ({ id, kind: "freeform", name: id, background: {}, elements, ...extra });
const flow = (id, flowType, options = {}, extra = {}) => ({ id, kind: "flow", name: id, flowType, options, ...extra });
let n = 0;
const el = (id, type, props, extra = {}) => ({ id, type, frame: { x: 20, y: 20 + (n++ % 10) * 20, w: 60, h: 15, rotation: 0 }, z: 1, source: "user", props, ...extra });
const g = (metric, o = {}) => ({ source: "ghg", metric, years: { last: 1 }, sites: "all", ...o });
const tile = (id, binding, extra) => el(id, "kpi_tile", { binding, showDelta: false, showSparkline: false, variant: "plain" }, extra);
const chart = (id, kind, binding, o = {}, extra) => el(id, "chart", { binding, kind, options: {}, ...o }, extra);
const para = (...parts) => ({ type: "paragraph", content: parts.map((p) => (typeof p === "string" ? { type: "text", text: p } : p)) });
const text = (id, s, extra = {}, style = "body") => el(id, "text", { doc: { type: "doc", content: typeof s === "string" ? [para(s)] : s }, style, align: "left" }, extra);
const chip = (binding, measure = "value") => ({ type: "data", attrs: { binding, measure } });
const parse = (d) => C.ReportDocSchema.parse(d);

const entry = (value) => ({ value, source: "typed", updatedBy: 1, updatedAt: "2026-10-20T00:00:00.000Z" });
const ALL_EXCLUDED = Array.from({ length: 15 }, (_, i) => ({ what: `Category ${i + 1}`, reason: "Not relevant" }));
const FULL_INPUTS = () => ({
  consolidation_approach: entry("Operational control"),
  reporting_period: entry("Calendar year 2025"),
  responsible_person: entry("Head of Sustainability"),
  base_year: entry(2022),
  recalculation_policy: entry("Recalculated when a change moves the base year by 5% or more."),
  significance_threshold_pct: entry(5),
  uncertainty_statement: entry("Low."),
  verification: entry({ status: "limited", provider: "Verifier Ltd" }),
  exclusions: entry(ALL_EXCLUDED),
  gwp_set: entry("AR6"),
});
const FACTS = () => ({
  periodLabel: "CY 2025",
  pending: 0,
  rejected: 0,
  sitesMissing: [],
  monthsMissing: [],
  scope3Reported: [],
  gwpSets: ["AR6"],
  factorSources: [],
  biogenicT: null,
  totals: { total: 1000, scope1: 400, scope2: 300, scope3: 300 },
});
const val = (value, o = {}) => ({ source: "ghg", display: String(value), value, unit: "tCO₂e", ...o });

/** A CheckInput: every binding and chip resolves to 100 tCO₂e unless `values[elementId]` says otherwise. */
function input(rawDoc, o = {}) {
  const doc = parse(rawDoc);
  const ix = docIndex(doc);
  const values = ix.bindings.map((b) => o.values?.[b.elementId] ?? (b.binding.source === "custom" ? { source: "custom", display: "Unlinked data", value: null, unit: null } : val(100)));
  const tokens = ix.tokens.map((t) => o.tokens?.[t.idx] ?? val(100));
  return { doc, ix, resolved: { values, tokens }, inputs: o.inputs ?? FULL_INPUTS(), ghg: { ...FACTS(), ...(o.ghg ?? {}) }, ...(o.sustainability ? { sustainability: o.sustainability } : {}), measurements: o.measurements ?? null };
}
/** A GHG doc that answers every structural check (gas, DQ, factor table, biogenic, market-based, trend). */
const completeDoc = (extraElements = [], extraPages = [], meta) =>
  base({
    meta,
    pages: [
      page("p1", [
        tile("p1.total", g("total", { compare: "prior" })),
        tile("p1.market", g("scope2_market")),
        chart("p1.gas", "gas_split", g("total", { breakdown: "gas" })),
        tile("p1.dq", g("dq_score")),
        tile("p1.bio", g("biogenic_co2")),
        tile("p1.trend", g("total", { years: { last: 3 } })),
        text("p1.why", "Emissions decreased because of the solar plant."),
        ...extraElements,
      ]),
      flow("f-s3", "scope3_categories", { categories: [] }),
      flow("f-ef", "ghg_factor_table"),
      ...extraPages,
    ],
  });
const ids = (checks) => checks.map((c) => c.id);
const only = (checks, id) => checks.filter((c) => c.id === id);

// ---------------------------------------------------------------------------
// The number matcher (RS-9 golden table)
// ---------------------------------------------------------------------------

test("number golden table: extraction and matching (RS-9)", () => {
  const cands = [
    { value: 48620, unit: "tCO₂e" },
    { value: 3100, unit: "tCO₂e" },
    { value: 1280000, unit: "m³" },
    { value: 12.41, unit: "%" },
    { value: 15000000, unit: null },
  ];
  const cases = [
    ["Total was 48,620 tCO₂e.", "match"],
    ["about 48,600 t", "match"],
    ["roughly 48,000 t", "mismatch"],
    ["Scope 1 at 3,400 t", "mismatch"],
    ["we run 22 MW of solar", "unbound"],
    ["1.28 million m³ of water", "match"],
    ["up 12.4%", "match"],
    ["₹ 1.5 crore of revenue", "match"],
    ["4,86,20,000 kg", "match"], // 48,620 t in kg, Indian grouping
  ];
  for (const [t, want] of cases) {
    const c = N.extractNumbers(t);
    assert.equal(c.length, 1, t);
    assert.equal(N.matchClaim(c[0], cands).status, want, t);
  }
  assert.equal(N.extractNumbers("1.28 million m³")[0].step, 10000, "the writer's rounding");
  assert.equal(N.extractNumbers("48,62,000 t")[0].value, 4862000, "Indian grouping");
  assert.equal(N.extractNumbers("48.6 kt")[0].value, 48600);
  assert.ok(N.matchClaim(N.extractNumbers("48.6 kt")[0], cands).status === "match");
});

test("numbers that are not figures are ignored: years, codes, clauses, dates, small counts", () => {
  for (const t of ["GRI 305-1", "ISO 14064-1", "ESRS E1-6", "Scope 3", "Category 4", "SDG 13", "AR5", "BRSR P6", "FY 2025-26", "in 2024", "on 31 March 2025", "March 31", "v2.1"]) {
    assert.deepEqual(N.extractNumbers(t).map((c) => c.text), [], t);
  }
  assert.equal(N.extractNumbers("fell -12.4%")[0].value, 12.4, "a minus sign is a sign");
});

test("numberChecks: a typed wrong figure is NUMBER_MISMATCH with a chip; a figure at the writer's precision matches", () => {
  const doc = base({ pages: [page("p", [tile("p.s1", g("scope1")), text("p.t", "Scope 1 was 3,400 tCO₂e, about 3,100 t, and 22 MW.")])] });
  const c = numberChecks(input(doc, { values: { "p.s1": val(3104.6) } }));
  const mm = only(c, "NUMBER_MISMATCH");
  assert.equal(mm.length, 1);
  assert.equal(mm[0].details.typed, "3,400 tCO₂e");
  assert.equal(mm[0].fix, "replace_with_token");
  assert.deepEqual(mm[0].details.chip, { binding: g("scope1"), measure: "value" });
  assert.equal(mm[0].elementId, "p.t");
  assert.deepEqual(only(c, "NUMBER_UNBOUND").map((x) => x.details.typed), ["22"]);
  // Chips, hidden text and comparisons: the change in % from a chip is a candidate too.
  const doc2 = base({ pages: [page("p", [text("p.t", [para("Down ", chip(g("total", { compare: "prior" }), "change_pct"), ", or 12.4%.")]), text("p.h", "Hidden 9,999 t", { hidden: true })])] });
  const c2 = numberChecks(input(doc2, { tokens: { 0: { ...val(-12.41), unit: "%" } } }));
  assert.deepEqual(ids(c2), []);
});

// ---------------------------------------------------------------------------
// GHG checks: each on a positive and a negative fixture
// ---------------------------------------------------------------------------

test("a complete GHG doc with full report details raises only the D7 market-based warning", () => {
  const c = ghgChecks(input(completeDoc()));
  assert.deepEqual(ids(c), ["SCOPE2_MARKET_MISSING"]);
  assert.equal(c[0].elementId, "p1.market");
  assert.equal(c[0].fix, "open_inputs");
});

test("GHG_PENDING_ENTRIES, GHG_SITES_MISSING, GHG_MONTHS_MISSING from the period's facts", () => {
  const c = ghgChecks(input(completeDoc(), { ghg: { pending: 4, rejected: 1, sitesMissing: [{ id: 2, name: "Pune" }], monthsMissing: [{ siteId: 1, siteName: "Chennai", months: ["2025-01", "2025-02"] }] } }));
  const p = only(c, "GHG_PENDING_ENTRIES")[0];
  assert.equal(p.severity, "error");
  assert.equal(p.details.count, 5);
  assert.equal(p.fix, "open_pending");
  assert.match(p.message, /^Pending or rejected entries: 5\. Approve them in Review before the final\.$/);
  assert.equal(ghgChecks(input(completeDoc(), { ghg: { pending: 4 } })).find((x) => x.id === "GHG_PENDING_ENTRIES").message, "Pending entries: 4. Approve them in Review before the final.");
  assert.equal(only(c, "GHG_SITES_MISSING")[0].message, "Pune has no approved data for CY 2025.");
  assert.equal(only(c, "GHG_MONTHS_MISSING")[0].message, "Chennai has no approved data for Jan 2025, Feb 2025.");
  assert.ok(!ids(ghgChecks(input(completeDoc()))).some((id) => id.startsWith("GHG_")));
});

test("CONSOLIDATION_MISSING, PERIOD_MISSING, VERIFICATION_STATEMENT_MISSING from report details", () => {
  const inputs = FULL_INPUTS();
  delete inputs.consolidation_approach;
  inputs.reporting_period = entry("  ");
  delete inputs.verification;
  const doc = completeDoc([tile("p1.cons", { source: "input", key: "consolidation_approach" })]);
  const c = ghgChecks(input(doc, { inputs }));
  const cons = only(c, "CONSOLIDATION_MISSING")[0];
  assert.equal(cons.severity, "error");
  assert.equal(cons.elementId, "p1.cons", "points at the tile that shows it");
  assert.equal(cons.fix, "open_inputs");
  assert.equal(only(c, "PERIOD_MISSING")[0].severity, "error");
  assert.equal(only(c, "VERIFICATION_STATEMENT_MISSING")[0].severity, "warning");
  // "Not verified" counts as a statement.
  const ok = FULL_INPUTS();
  ok.verification = entry({ status: "none" });
  assert.ok(!ids(ghgChecks(input(completeDoc(), { inputs: ok }))).includes("VERIFICATION_STATEMENT_MISSING"));
});

test("BASE_YEAR_MISSING only when a trend shows; RECALC_POLICY_MISSING when a base year has no policy or threshold", () => {
  const noBase = FULL_INPUTS();
  delete noBase.base_year;
  assert.equal(only(ghgChecks(input(completeDoc(), { inputs: noBase })), "BASE_YEAR_MISSING")[0].elementId, "p1.total".replace("total", "trend"));
  const flat = base({ pages: completeDoc().pages.map((p) => (p.kind === "freeform" ? { ...p, elements: p.elements.filter((e) => e.id !== "p1.trend").map((e) => (e.id === "p1.total" ? tile("p1.total", g("total")) : e)) } : p)) });
  assert.ok(!ids(ghgChecks(input(flat, { inputs: noBase }))).includes("BASE_YEAR_MISSING"));
  const noPolicy = FULL_INPUTS();
  delete noPolicy.recalculation_policy;
  const r = only(ghgChecks(input(completeDoc(), { inputs: noPolicy })), "RECALC_POLICY_MISSING");
  assert.equal(r.length, 1);
  assert.match(r[0].message, /recalculation policy/);
  assert.ok(!ids(ghgChecks(input(completeDoc(), { inputs: noBase }))).includes("RECALC_POLICY_MISSING"));
});

test("SCOPE2_MARKET_MISSING offers the market-based row when the doc doesn't have one", () => {
  const doc = base({ pages: completeDoc().pages.map((p) => (p.kind === "freeform" ? { ...p, elements: p.elements.filter((e) => e.id !== "p1.market") } : p)) });
  const c = only(ghgChecks(input(doc)), "SCOPE2_MARKET_MISSING")[0];
  assert.equal(c.fix, "add_market_note");
  assert.equal(c.severity, "warning");
});

test("GAS_BREAKDOWN_MISSING: no per-gas figure and no 'not applicable' note", () => {
  const noGas = base({ pages: completeDoc().pages.map((p) => (p.kind === "freeform" ? { ...p, elements: p.elements.filter((e) => e.id !== "p1.gas") } : p)) });
  const c = only(ghgChecks(input(noGas)), "GAS_BREAKDOWN_MISSING");
  assert.equal(c.length, 1);
  assert.equal(c[0].fix, "add_gas_chart");
  const noted = base({ pages: [...noGas.pages, page("p9", [text("p9.n", "A per-gas split is not applicable: all our emissions are CO₂ from electricity.")])] });
  assert.ok(!ids(ghgChecks(input(noted))).includes("GAS_BREAKDOWN_MISSING"));
  const chipGas = base({ pages: [...noGas.pages, page("p9", [text("p9.n", [para("CO₂: ", chip(g("gas_co2")))])])] });
  assert.ok(!ids(ghgChecks(input(chipGas))).includes("GAS_BREAKDOWN_MISSING"));
});

test("BIOGENIC_IN_SCOPE: a scope figure labelled as including biogenic CO₂, or a typed scope total plus biogenic", () => {
  const labelled = completeDoc([chart("p1.s1bio", "bar", g("scope1", { breakdown: "site" }), { title: "Scope 1 including biogenic CO₂" })]);
  const c = only(ghgChecks(input(labelled)), "BIOGENIC_IN_SCOPE");
  assert.deepEqual(c.map((x) => [x.elementId, x.severity]), [["p1.s1bio", "error"]]);
  const excl = completeDoc([chart("p1.s1bio", "bar", g("scope1", { breakdown: "site" }), { title: "Scope 1 (excluding biogenic CO₂, reported separately)" })]);
  assert.ok(!ids(ghgChecks(input(excl, { ghg: { biogenicT: 25 } }))).includes("BIOGENIC_IN_SCOPE"));
  // Scope 1 is 400 t and biogenic 25 t: "425 t" is the sum.
  const typed = completeDoc([text("p1.sum", "Scope 1 came to 425 tCO₂e.")]);
  const t = only(ghgChecks(input(typed, { ghg: { biogenicT: 25 } })), "BIOGENIC_IN_SCOPE");
  assert.equal(t.length, 1);
  assert.equal(t[0].details.typed, "425 tCO₂e");
  assert.ok(!ids(ghgChecks(input(completeDoc([text("p1.sum", "Scope 1 came to 400 tCO₂e.")]), { ghg: { biogenicT: 25 } }))).includes("BIOGENIC_IN_SCOPE"));
});

test("BIOGENIC_NOT_SHOWN: biogenic CO₂ in the data and no biogenic figure", () => {
  const noBio = base({ pages: completeDoc().pages.map((p) => (p.kind === "freeform" ? { ...p, elements: p.elements.filter((e) => e.id !== "p1.bio") } : p)) });
  const c = only(ghgChecks(input(noBio, { ghg: { biogenicT: 12.5 } })), "BIOGENIC_NOT_SHOWN");
  assert.equal(c.length, 1);
  assert.equal(c[0].fix, "add_biogenic");
  assert.match(c[0].message, /12\.5 t of biogenic CO₂/);
  assert.ok(!ids(ghgChecks(input(noBio))).includes("BIOGENIC_NOT_SHOWN"), "no biogenic in the data");
  assert.ok(!ids(ghgChecks(input(completeDoc(), { ghg: { biogenicT: 12.5 } }))).includes("BIOGENIC_NOT_SHOWN"));
});

test("SCOPE3_CATEGORY_UNADDRESSED and EXCLUSION_NO_REASON", () => {
  const inputs = FULL_INPUTS();
  inputs.exclusions = entry(ALL_EXCLUDED.filter((e) => !["Category 1", "Category 4", "Category 9", "Category 6"].includes(e.what)).concat([{ what: "Category 6 · Business travel", reason: "" }]));
  // 1 and 4 have data and the scope3_categories section shows every category; 9 has nothing.
  const c = ghgChecks(input(completeDoc(), { inputs, ghg: { scope3Reported: [1, 4] } }));
  const u = only(c, "SCOPE3_CATEGORY_UNADDRESSED");
  assert.deepEqual(u.map((x) => x.details.category), [9]);
  assert.equal(u[0].message, "Scope 3 Category 9: Downstream transportation and distribution isn't reported or excluded. Mark it as excluded with a reason, or add its data.");
  assert.equal(u[0].fix, "mark_excluded");
  const nr = only(c, "EXCLUSION_NO_REASON");
  assert.deepEqual(nr.map((x) => [x.details.category, x.severity, x.fix]), [[6, "error", "mark_excluded"]]);
  // Data but not shown: no section and no binding names category 4.
  const bare = base({ pages: [page("p1", completeDoc().pages[0].elements)] });
  const inputs2 = FULL_INPUTS();
  inputs2.exclusions = entry(ALL_EXCLUDED.filter((e) => e.what !== "Category 4"));
  const shown = only(ghgChecks(input(bare, { inputs: inputs2, ghg: { scope3Reported: [4] } })), "SCOPE3_CATEGORY_UNADDRESSED");
  assert.deepEqual(shown.map((x) => [x.details.category, x.details.hasData]), [[4, true]]);
  // A category bar chart whose series names category 4 shows it.
  const withChart = base({ pages: [page("p1", [...completeDoc().pages[0].elements, chart("p1.cat", "category_bars", g("scope3", { breakdown: "scope3_category" }))])] });
  const values = { "p1.cat": val(50, { series: [{ label: "2025", values: [{ key: "4 · Upstream transportation and distribution", value: 50 }] }], total: 50 }) };
  assert.ok(!ids(ghgChecks(input(withChart, { inputs: inputs2, values, ghg: { scope3Reported: [4] } }))).includes("SCOPE3_CATEGORY_UNADDRESSED"));
});

test("SCOPE3_DQ_MISSING: Scope 3 shown without data quality", () => {
  const doc = base({ pages: [page("p1", [tile("p1.s3", g("scope3")), tile("p1.market", g("scope2_market")), chart("p1.gas", "gas_split", g("total", { breakdown: "gas" }))])] });
  assert.equal(only(ghgChecks(input(doc)), "SCOPE3_DQ_MISSING").length, 1);
  assert.ok(!ids(ghgChecks(input(completeDoc()))).includes("SCOPE3_DQ_MISSING"));
  const noS3 = base({ pages: [page("p1", [tile("p1.s1", g("scope1"))])] });
  assert.ok(!ids(ghgChecks(input(noS3))).includes("SCOPE3_DQ_MISSING"));
});

test("EF_SOURCE_MISSING: factor sources in the data must be named, or the factors section included", () => {
  const sources = [{ source: "DEFRA", version: "2025" }, { source: "CEA", version: null }];
  const noTable = base({ pages: [page("p1", completeDoc().pages[0].elements), flow("f-m", "methodology", {}, { content: { type: "doc", content: [para("Factors come from DEFRA 2025.")] } })] });
  const c = only(ghgChecks(input(noTable, { ghg: { factorSources: sources } })), "EF_SOURCE_MISSING");
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].details.sources, ["CEA"]);
  assert.equal(c[0].pageId, "f-m");
  assert.equal(c[0].fix, "add_factor_table");
  assert.ok(!ids(ghgChecks(input(completeDoc(), { ghg: { factorSources: sources } }))).includes("EF_SOURCE_MISSING"), "the factors section lists them");
  assert.ok(!ids(ghgChecks(input(noTable))).includes("EF_SOURCE_MISSING"), "no sources in the data");
});

test("GWP_MIXED from the data or the gwp_set input", () => {
  assert.equal(only(ghgChecks(input(completeDoc(), { ghg: { gwpSets: ["AR5", "AR6"] } })), "GWP_MIXED")[0].details.sets.join(), "AR5,AR6");
  const mixed = FULL_INPUTS();
  mixed.gwp_set = entry("MIXED");
  assert.equal(only(ghgChecks(input(completeDoc(), { inputs: mixed })), "GWP_MIXED").length, 1);
  assert.ok(!ids(ghgChecks(input(completeDoc()))).includes("GWP_MIXED"));
});

test("D8: responsible person and uncertainty move up a step with ISO 14064-1 selected", () => {
  const inputs = FULL_INPUTS();
  delete inputs.responsible_person;
  delete inputs.uncertainty_statement;
  const ghgp = ghgChecks(input(completeDoc(), { inputs }));
  assert.equal(only(ghgp, "RESPONSIBLE_PERSON_MISSING")[0].severity, "warning");
  assert.equal(only(ghgp, "UNCERTAINTY_MISSING")[0].severity, "info");
  const iso = ghgChecks(input(completeDoc([], [], { frameworks: ["GHGP", "ISO14064"] }), { inputs }));
  assert.equal(only(iso, "RESPONSIBLE_PERSON_MISSING")[0].severity, "error");
  assert.equal(only(iso, "UNCERTAINTY_MISSING")[0].severity, "warning");
});

test("INTENSITY_MISSING only with BRSR P6 or ESRS E1 selected", () => {
  assert.ok(!ids(ghgChecks(input(completeDoc()))).includes("INTENSITY_MISSING"));
  const brsr = only(ghgChecks(input(completeDoc([], [], { frameworks: ["GHGP", "BRSR_P6"] }))), "INTENSITY_MISSING")[0];
  assert.deepEqual(brsr.details.missing, ["intensity per unit of revenue", "the PPP rate for revenue", "intensity per unit of output"]);
  const esrsDoc = completeDoc([tile("p1.int", g("intensity_revenue"))], [], { frameworks: ["GHGP", "ESRS_E1"] });
  assert.ok(!ids(ghgChecks(input(esrsDoc))).includes("INTENSITY_MISSING"));
  const unavailable = only(ghgChecks(input(esrsDoc, { values: { "p1.int": { source: "ghg", display: "Not reported", value: null, unit: null, unavailable: { reason: "NO_INPUT" } } } })), "INTENSITY_MISSING");
  assert.equal(unavailable.length, 1, "a tile showing Not reported doesn't count");
});

test("TOTAL_MISMATCH: a breakdown that doesn't add up to its total; a typed table whose total row is wrong", () => {
  const doc = completeDoc([chart("p1.split", "scope_split", g("total", { breakdown: "scope" }))]);
  const series = (a, b, c) => [{ label: "2025", values: [{ key: "Scope 1", value: a }, { key: "Scope 2", value: b }, { key: "Scope 3", value: c }] }];
  const bad = only(ghgChecks(input(doc, { values: { "p1.split": val(1000, { series: series(400, 300, 200), total: 1000 }) } })), "TOTAL_MISMATCH");
  assert.equal(bad.length, 1);
  assert.equal(bad[0].elementId, "p1.split");
  assert.ok(!ids(ghgChecks(input(doc, { values: { "p1.split": val(1000, { series: series(400, 300, 300.2), total: 1000 }) } }))).includes("TOTAL_MISMATCH"), "within rounding");
  const table = completeDoc([el("p1.tab", "table", { columns: ["Site", "tCO₂e"], rows: [["A", 10], ["B", "20"], ["Total", 35]], style: "lined" })]);
  const t = only(ghgChecks(input(table)), "TOTAL_MISMATCH");
  assert.deepEqual([t.length, t[0].details.sum, t[0].details.total], [1, 30, 35]);
});

test("YOY_UNEXPLAINED: a change over 20% with no words about it on the page", () => {
  const plain = base({ pages: [page("p", [tile("p.t", g("total", { compare: "prior" })), tile("p.m", g("scope2_market"))])] });
  const values = { "p.t": val(1300, { compare: { against: "prior", year: 2024, value: 1000, change_abs: 300, change_pct: 30 } }) };
  const c = only(ghgChecks(input(plain, { values })), "YOY_UNEXPLAINED");
  assert.equal(c.length, 1);
  assert.match(c[0].message, /\+30\.0%/);
  assert.equal(c[0].severity, "info");
  const explained = base({ pages: [page("p", [...plain.pages[0].elements, text("p.w", "Emissions rose as the new plant opened.")])] });
  assert.ok(!ids(ghgChecks(input(explained, { values }))).includes("YOY_UNEXPLAINED"));
  const small = { "p.t": val(1100, { compare: { against: "prior", year: 2024, value: 1000, change_abs: 100, change_pct: 10 } }) };
  assert.ok(!ids(ghgChecks(input(plain, { values: small }))).includes("YOY_UNEXPLAINED"));
});

test("hidden pages and elements are never checked", () => {
  const doc = completeDoc([el("p1.ph", "placeholder", { accepts: ["text"] }, { hidden: true })], [page("p9", [chart("p9.s1bio", "bar", g("scope1", { breakdown: "site" }), { title: "Scope 1 including biogenic" })], { hidden: true })]);
  const all = [...ghgChecks(input(doc)), ...contentChecks(input(doc))];
  assert.ok(!all.some((c) => c.elementId === "p1.ph" || c.pageId === "p9"));
});

test("a sustainability doc gets no GHG checks", () => {
  const doc = base({ kind: "sustainability", meta: { frameworks: ["GRI"] }, pages: [page("p", [])] });
  assert.deepEqual(ghgChecks(input(doc)), []);
});

// ---------------------------------------------------------------------------
// Content and layout
// ---------------------------------------------------------------------------

test("content: placeholders, alt text, AI text, missing values, custom data, the leadership message, the year lock", () => {
  const doc = base({
    pages: [
      page("p", [
        el("p.ph", "placeholder", { accepts: ["text"], hint: "Signature" }),
        el("p.img", "image", { assetId: "a1", fit: "cover", alt: "" }),
        el("p.grid", "grid", { columns: 2, gap: 2, cells: [{ assetId: "a1", alt: "" }, { alt: "" }] }),
        text("p.ai", "Drafted.", { source: "ai" }),
        text("p.ai2", "Drafted and ticked.", { source: "ai", reviewed: true }),
        tile("p.miss", g("intensity_revenue")),
        tile("p.mkt", g("scope2_market")),
        chart("p.custom", "bar", { source: "custom", columns: ["Year", "n"], rows: [["2024", 1]] }),
      ]),
    ],
  });
  const c = contentChecks(
    input(doc, {
      values: {
        "p.miss": { source: "ghg", display: "Not reported", value: null, unit: null, unavailable: { reason: "NO_INPUT" } },
        "p.mkt": { source: "ghg", display: "Not reported", value: null, unit: null, unavailable: { reason: "NOT_RECORDED" } },
      },
    }),
  );
  assert.deepEqual(
    c.map((x) => [x.id, x.elementId, x.severity]),
    [
      ["EMPTY_PLACEHOLDER", "p.ph", "error"],
      ["MISSING_ALT", "p.img", "warning"],
      ["MISSING_ALT", "p.grid", "warning"],
      ["AI_UNREVIEWED", "p.ai", "warning"],
      ["UNLINKED_DATA", "p.custom", "info"],
      ["VALUES_MISSING", "p.miss", "warning"],
    ],
  );
  assert.equal(only(c, "VALUES_MISSING")[0].fix, "open_inputs");
  const sus = base({ kind: "sustainability", meta: { frameworks: ["GRI"] }, pages: [page("p-lead", [text("p-lead.message", "Dear readers")], { layoutId: "leadership" })] });
  const s = contentChecks(input(sus, { sustainability: { locked: false, periodLabel: "FY 2025-26" } }));
  assert.deepEqual(ids(s), ["LEADERSHIP_UNCONFIRMED", "YEAR_NOT_LOCKED"]);
  const signed = base({ kind: "sustainability", meta: { frameworks: ["GRI"] }, pages: [page("p-lead", [text("p-lead.message", "Dear readers", { reviewed: true })], { layoutId: "leadership" })] });
  assert.deepEqual(ids(contentChecks(input(signed, { sustainability: { locked: true, periodLabel: "FY 2025-26" } }))), []);
});

test("layout: overflow, type size (7 pt for footnotes, charts and tables), contrast thresholds, margin from frames, locked overlaps", () => {
  const doc = base({
    pages: [
      page("p", [
        text("p.body", "Body"),
        text("p.foot", "Footnote", {}, "footnote"),
        chart("p.chart", "bar", g("total", { breakdown: "site" })),
        text("p.edge", "Edge", { frame: { x: 5, y: 100, w: 30, h: 10, rotation: 0 } }),
        text("p.rot", "Rotated", { frame: { x: 12, y: 270, w: 60, h: 6, rotation: 90 } }), // inside unrotated; its rotated box reaches y 303
        el("p.bg", "shape", { shape: "rect", bleed: true }, { frame: { x: -3, y: -3, w: 216, h: 50, rotation: 0 } }),
        el("p.lock", "shape", { shape: "rect" }, { templateLocked: true, frame: { x: 100, y: 200, w: 40, h: 40, rotation: 0 } }),
        text("p.over", "Over", { frame: { x: 120, y: 220, w: 30, h: 10, rotation: 0 } }),
      ]),
    ],
  });
  const m = (elementId, o) => ({ pageId: "p", elementId, type: "text", rectMm: { x: 0, y: 0, w: 1, h: 1 }, overflowMm: 0, outsideSafe: false, outsidePage: false, minFontPt: 10, contrast: 12, onImage: false, bleed: false, ...o });
  const c = layoutChecks(parse(doc), [
    m("p.body", { overflowMm: 2.5, minFontPt: 7.5, contrast: 3.5 }),
    m("p.foot", { minFontPt: 7, contrast: 2.5 }),
    m("p.chart", { minFontPt: 7, contrast: 2.9, onImage: true }),
  ]);
  const got = c.map((x) => [x.id, x.elementId, x.severity]).sort();
  assert.deepEqual(got, [
    ["FONT_TOO_SMALL", "p.body", "error"],
    ["LOW_CONTRAST", "p.body", "warning"],
    ["LOW_CONTRAST", "p.chart", "warning"],
    ["LOW_CONTRAST", "p.foot", "error"],
    ["OUTSIDE_SAFE_AREA", "p.edge", "error"],
    ["OUTSIDE_SAFE_AREA", "p.rot", "error"],
    ["OVERLAPS_LOCKED", "p.over", "warning"],
    ["TEXT_OVERFLOW", "p.body", "error"],
  ]);
  const box = rotatedBox({ x: 12, y: 270, w: 60, h: 6, rotation: 90 });
  assert.deepEqual([box.x, box.y, box.w, box.h].map((v) => Math.round(v * 100) / 100), [39, 243, 6, 60]);
});

test("sort: errors, warnings, info; pending entries first; then page and element order. warningIds: one per id", () => {
  const doc = parse(base({ pages: [page("a", [text("a.1", "x"), text("a.2", "y")]), page("b", [text("b.1", "z")])] }));
  const s = sortChecks(doc, [
    { id: "UNLINKED_DATA", severity: "info", message: "", pageId: "a" },
    { id: "MISSING_ALT", severity: "warning", message: "", pageId: "b", elementId: "b.1" },
    { id: "TEXT_OVERFLOW", severity: "error", message: "", pageId: "b", elementId: "b.1" },
    { id: "MISSING_ALT", severity: "warning", message: "", pageId: "a", elementId: "a.2" },
    { id: "CONSOLIDATION_MISSING", severity: "error", message: "" },
    { id: "GHG_PENDING_ENTRIES", severity: "error", message: "" },
  ]);
  assert.deepEqual(s.map((c) => c.id), ["GHG_PENDING_ENTRIES", "CONSOLIDATION_MISSING", "TEXT_OVERFLOW", "MISSING_ALT", "MISSING_ALT", "UNLINKED_DATA"]);
  assert.deepEqual(warningIds(s), ["MISSING_ALT"]);
});

test("contracts: every fix a check gives is a contract fix; every check id has a rule", () => {
  for (const f of ["mark_excluded", "open_pending", "add_market_note", "add_gas_chart", "add_biogenic", "add_factor_table", "open_link"]) assert.ok(C.CHECK_FIXES.includes(f), f);
  for (const id of C.CHECK_IDS) assert.ok(C.CHECK_RULES[id], id);
  const all = runCheckFamilies(input(completeDoc([text("p1.t", "Total 9,999 t.")]), { inputs: {}, ghg: { pending: 1, biogenicT: 3, factorSources: [{ source: "X", version: null }], gwpSets: ["AR5", "AR6"] } }));
  for (const c of all) {
    assert.ok(C.CheckSchema.safeParse(c).success, JSON.stringify(c));
    assert.ok(c.message.length > 10 && !/undefined|null|NaN/.test(c.message), c.message);
  }
});

// ---------------------------------------------------------------------------
// Golden: the seed GHG Inventory
// ---------------------------------------------------------------------------

test("golden: the seed GHG Inventory template has exactly the expected checks", () => {
  const seeds = readLibrarySeeds(path.join(ROOT, "data/studio"));
  const t = seeds.templates.find((x) => x.slug === "ghg-inventory-classic");
  const doc = parse(t.doc);
  const ix = docIndex(doc);
  // Fixed data: every figure resolves except market-based Scope 2 (D7); categories 1, 4, 6 and 7
  // have data; 8, 13 and 14 are excluded in screening; DEFRA factors; no pending entries.
  const values = ix.bindings.map((b) =>
    b.binding.source === "ghg" && b.binding.metric === "scope2_market"
      ? { source: "ghg", display: "Not reported", value: null, unit: "tCO₂e", unavailable: { reason: "NOT_RECORDED" } }
      : b.binding.source === "input"
        ? { source: "input", display: "x", value: null, unit: null }
        : val(100),
  );
  const inputs = {
    consolidation_approach: entry("Operational control"),
    reporting_period: entry("Calendar year 2025"),
    gwp_set: entry("AR6"),
    conformance: entry(["GHGP"]),
    exclusions: entry([8, 13, 14].map((k) => ({ what: `Category ${k}`, reason: "Not relevant in screening" }))),
  };
  const got = runCheckFamilies({
    doc,
    ix,
    resolved: { values, tokens: ix.tokens.map(() => val(100)) },
    inputs,
    ghg: { ...FACTS(), scope3Reported: [1, 4, 6, 7], factorSources: [{ source: "DEFRA", version: "2025" }] },
    measurements: null,
  }).map((c) => [c.id, c.severity, c.pageId ?? null, c.elementId ?? null, c.fix ?? null, c.details?.category ?? null]);
  if (process.env.UPDATE_SNAPSHOT === "1") {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, `{\n "template": ${JSON.stringify(t.slug)},\n "row": ["id", "severity", "pageId", "elementId", "fix", "category"],\n "checks": [\n${got.map((r) => `  ${JSON.stringify(r)}`).join(",\n")}\n ]\n}\n`);
  }
  const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  assert.deepEqual(got, want.checks);
});
