// DS-2 pure logic: number formatting (the one rounding place), derived
// figures (zero, negative, null), data hash stability, report inputs (patch
// validation per key, prefill merge, exclusions, display text), GHG binding
// years / top-N folding / reporting months, the EDE intensity join, data
// token measures and materiality points. Runs against the build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const dist = (p) => require(path.resolve("dist", p));
const { formatNumber, formatChangePct, formatChangeAbs, MINUS, EMPTY } = dist("studio/sources/format.js");
const derived = dist("studio/sources/derived.js");
const { dataHash, stableStringify, bindingsHash, elementHash } = dist("studio/sources/hash.js");
const inputs = dist("studio/sources/inputs.js");
const ghg = dist("studio/sources/ghg.js");
const { reportingMonthKeys } = dist("studio/sources/ghg/rows.js");
const { monthlyIntensity } = dist("reporting/intensity.js");
const { resolveToken, checkSites } = dist("studio/sources/resolve.js");
const { materialityPoints } = dist("studio/sources/materiality.js");

test("formatNumber rounds once per NumberFormat, with a true minus and an em dash for null", () => {
  assert.equal(formatNumber(12345.678, "auto"), "12,346");
  assert.equal(formatNumber(12.345, "auto"), "12.35");
  assert.equal(formatNumber(0.012345, "auto"), "0.0123");
  assert.equal(formatNumber(0, "auto"), "0");
  assert.equal(formatNumber(-4.5, "1dp"), `${MINUS}4.5`);
  assert.equal(formatNumber(-0.001, "int"), "0", "a value that rounds to 0 has no sign");
  assert.equal(formatNumber(1234567, "indian"), "12,34,567");
  assert.equal(formatNumber(1500000, "compact"), "1.5M");
  assert.equal(formatNumber(12.345, "pct1"), "12.3%");
  assert.equal(formatNumber(12.5, "pct0"), "13%");
  assert.equal(formatNumber(2, "2dp"), "2.00");
  assert.equal(formatNumber(null), EMPTY);
  assert.equal(formatNumber(Infinity), EMPTY);
  assert.equal(formatChangePct(4.24), "+4.2%");
  assert.equal(formatChangePct(-12), `${MINUS}12.0%`);
  assert.equal(formatChangePct(0), "0.0%");
  assert.equal(formatChangeAbs(120), "+120");
  assert.equal(formatChangeAbs(-4.5, "1dp"), `${MINUS}4.5`);
});

test("derived figures: zero, negative and missing give null with a reason, never 0 or Infinity", () => {
  assert.deepEqual(derived.changePct(110, 100), { value: 10 });
  assert.deepEqual(derived.changePct(90, -100), { value: 190 }, "divides by |previous|");
  assert.deepEqual(derived.changePct(5, 0), { value: null, reason: "DIVIDE_BY_ZERO" });
  assert.deepEqual(derived.changePct(null, 10), { value: null, reason: "MISSING_INPUT" });
  assert.deepEqual(derived.changeAbs(3, 5), { value: -2 });
  assert.deepEqual(derived.share(25, 200), { value: 12.5 });
  assert.deepEqual(derived.share(1, 0), { value: null, reason: "DIVIDE_BY_ZERO" });
  assert.deepEqual(derived.progressPct(80, 100, 60), { value: 50 }, "halfway from 100 to 60");
  assert.deepEqual(derived.progressPct(100, 100, 100), { value: null, reason: "DIVIDE_BY_ZERO" });
  assert.deepEqual(derived.intensity(500, 4), { value: 125 });
  assert.deepEqual(derived.intensity(500, undefined), { value: null, reason: "MISSING_INPUT" });
  assert.deepEqual(derived.shares([{ key: "a", value: 30 }, { key: "b", value: 10 }, { key: "c", value: null }]), [
    { key: "a", value: 75 },
    { key: "b", value: 25 },
    { key: "c", value: null },
  ]);
});

const R = (value, extra = {}) => ({ source: "ghg", display: String(value), value, unit: "tCO₂e", approvedAt: "2026-04-12T00:00:00.000Z", ...extra });
const hashOf = (values, inputsV = {}, sites = [1, 2]) => dataHash({ year: 2025, yearType: "CY", siteIds: sites, values, inputs: inputsV });

test("dataHash is stable across runs, value order and key order, and changes when data does", () => {
  const a = hashOf([R(10), R(20)]);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.equal(hashOf([R(10), R(20)]), a, "same input, same hash");
  assert.equal(hashOf([R(20), R(10)]), a, "value order doesn't matter");
  assert.equal(hashOf([R(10), R(20)], {}, [2, 1]), a, "site order doesn't matter");
  assert.equal(hashOf([{ unit: "tCO₂e", value: 10, display: "10", source: "ghg", approvedAt: "2026-04-12T00:00:00.000Z" }, R(20)]), a, "key order doesn't matter");
  assert.equal(hashOf([R(10, { display: "10.0" }), R(20)]), a, "presentation (display) of a ghg value isn't data");
  assert.notEqual(hashOf([R(10.01), R(20)]), a, "a value changed");
  assert.notEqual(hashOf([R(10, { approvedAt: "2026-05-01T00:00:00.000Z" }), R(20)]), a, "an approval changed");
  assert.notEqual(hashOf([R(10), R(20)], {}, [1]), a, "sites changed");
  const withInput = hashOf([R(10), R(20)], { responsible_person: { value: "A. Shah", source: "typed", updatedBy: 2, updatedAt: "x" } });
  assert.notEqual(withInput, a, "an input changed");
  assert.equal(hashOf([R(10), R(20)], { responsible_person: { value: "A. Shah", source: "typed", updatedBy: 3, updatedAt: "y" } }), withInput, "who edited an input isn't data");
  assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
  assert.equal(bindingsHash([{ source: "ghg", metric: "total" }]), bindingsHash([{ metric: "total", source: "ghg" }]));
  assert.notEqual(elementHash([R(1)]), elementHash([R(2)]));
});

test("applyInputPatch validates each key for the doc's kind and wraps values with source and editor", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  const next = inputs.applyInputPatch({}, { responsible_person: { value: "A. Shah" }, revenue: { value: 250, source: "typed" }, conformance: { value: ["GHGP", "ISO14064"], source: "company" } }, "ghg", 2, now);
  assert.deepEqual(next.responsible_person, { value: "A. Shah", source: "typed", updatedBy: 2, updatedAt: "2026-10-20T10:00:00.000Z" });
  assert.equal(next.conformance.source, "company");
  const removed = inputs.applyInputPatch(next, { revenue: null }, "ghg", 2, now);
  assert.equal(removed.revenue, undefined);
  assert.equal(removed.responsible_person.value, "A. Shah");
  const bad = (patch, kind = "ghg") => {
    try {
      inputs.applyInputPatch({}, patch, kind, 2, now);
      return null;
    } catch (e) {
      return e.code + " " + e.details.issues.map((i) => i.path).join(",");
    }
  };
  assert.equal(bad({ revenue: { value: -1 } }), "DS_VALIDATION inputs.revenue");
  assert.equal(bad({ significance_threshold_pct: { value: 150 } }), "DS_VALIDATION inputs.significance_threshold_pct");
  assert.equal(bad({ verification: { value: { status: "partial" } } }), "DS_VALIDATION inputs.verification.status");
  assert.equal(bad({ exclusions: { value: [{ what: "", reason: "x" }] } }), "DS_VALIDATION inputs.exclusions.0.what");
  assert.equal(bad({ nonsense: { value: 1 } }), "DS_VALIDATION inputs.nonsense");
  assert.equal(bad({ leadership_message: { value: "Hi" } }), "DS_VALIDATION inputs.leadership_message", "a sustainability input on a GHG doc");
  assert.equal(bad({ consolidation_approach: { value: "Operational control" } }, "sustainability"), "DS_VALIDATION inputs.consolidation_approach");
  assert.equal(bad({ responsible_person: "A. Shah" }), "DS_VALIDATION inputs.responsible_person", "a bare value isn't an entry");
  assert.equal(bad([]), "DS_VALIDATION inputs");
});

test("effectiveInputs: stored entries win over prefill; prefill fills the rest", () => {
  const eff = inputs.effectiveInputs(
    { revenue: { value: 300, source: "typed", updatedBy: 2, updatedAt: "t" } },
    { revenue: { value: 250, source: "kpi" }, conformance: { value: ["GHGP"], source: "company" } },
  );
  assert.equal(eff.revenue.value, 300);
  assert.equal(eff.revenue.source, "typed");
  assert.deepEqual(eff.conformance, { value: ["GHGP"], source: "company", updatedBy: null, updatedAt: "prefill" });
});

test("exclusions name a Scope 3 category by number or by name; inputs show as text", () => {
  const i = { exclusions: { value: [{ what: "Category 8 · Upstream leased assets", reason: "No leased assets" }, { what: "Franchises", reason: "No franchises" }, { what: "cat. 15 investments", reason: "None held" }] } };
  assert.equal(inputs.exclusionFor(i, 8).reason, "No leased assets");
  assert.equal(inputs.exclusionFor(i, 14).reason, "No franchises");
  assert.equal(inputs.exclusionFor(i, 15).reason, "None held");
  assert.equal(inputs.exclusionFor(i, 1), null);
  assert.equal(inputs.exclusionFor({}, 8), null);
  assert.equal(inputs.categoryWhat(8), "Category 8 · Upstream leased assets");
  assert.equal(inputs.inputDisplay("verification", { status: "limited", provider: "TÜV" }), "Limited assurance by TÜV");
  assert.equal(inputs.inputDisplay("verification", { status: "none" }), "Not verified");
  assert.equal(inputs.inputDisplay("conformance", ["GHGP", "ISO14064"]), "GHG Protocol Corporate Standard and ISO 14064-1");
  assert.equal(inputs.inputDisplay("exclusions", i.exclusions.value.slice(0, 1)), "Category 8 · Upstream leased assets: No leased assets");
  assert.equal(inputs.inputDisplay("significance_threshold_pct", 5), "5%");
  assert.equal(inputs.inputDisplay("revenue", 1234.567), "1,234.57");
  assert.equal(inputs.periodText("CY", 2025), "Calendar year 2025 (1 January 2025 – 31 December 2025)");
  assert.equal(inputs.periodText("FY", 2025), "Financial year 2025 (1 April 2024 – 31 March 2025)");
});

test("GHG binding years, reporting months and top-N folding", () => {
  assert.deepEqual(ghg.bindingYears({ last: 3 }, 2025), { years: [2023, 2024, 2025], current: 2025 });
  assert.deepEqual(ghg.bindingYears([2024, 2022, 2024], 2025), { years: [2022, 2024], current: 2024 });
  assert.deepEqual(ghg.bindingYears([2025, 2023], 2025), { years: [2023, 2025], current: 2025 });
  assert.deepEqual(reportingMonthKeys("CY", 2025).slice(0, 2), ["2025-01", "2025-02"]);
  assert.deepEqual([reportingMonthKeys("FY", 2025)[0], reportingMonthKeys("FY", 2025)[11]], ["2024-04", "2025-03"]);
  const folded = ghg.applyTop(
    [
      { year: 2024, points: [{ key: "a", value: 1 }, { key: "b", value: 5 }, { key: "c", value: 2 }] },
      { year: 2025, points: [{ key: "a", value: 9 }, { key: "b", value: 3 }, { key: "c", value: 4 }] },
    ],
    2025,
    1,
  );
  assert.deepEqual(folded[1].points, [{ key: "a", value: 9 }, { key: "Other", value: 7 }], "top by the current year");
  assert.deepEqual(folded[0].points, [{ key: "a", value: 1 }, { key: "Other", value: 7 }], "same keys in every year");
  assert.equal(ghg.applyTop(folded, 2025, undefined), folded);
});

test("every GHG metric has a unit and label; breakdowns are listed per metric", () => {
  const { GHG_METRICS, GHG_BREAKDOWNS } = dist("studio/contracts/index.js");
  for (const m of GHG_METRICS) {
    assert.ok(m in ghg.METRIC_UNITS, `unit for ${m}`);
    assert.ok(ghg.METRIC_LABELS[m], `label for ${m}`);
  }
  for (const list of Object.values(ghg.BREAKDOWNS_BY_METRIC)) for (const b of list) assert.ok(GHG_BREAKDOWNS.includes(b), b);
  assert.deepEqual(ghg.BREAKDOWNS_BY_METRIC.total, ["scope", "site", "month", "quarter", "gas", "fuel", "source_category"]);
  assert.equal(ghg.BREAKDOWNS_BY_METRIC.scope2_market, undefined, "market-based Scope 2 has no breakdown");
  assert.deepEqual(ghg.ghgFilters(2025, "FY", [1, 2]), { siteIds: [1, 2], yearType: "FY", year: 2025, frequency: "yearly" });
});

test("monthlyIntensity: the EDE join (production by site and month, 6 dp, 0 without production)", () => {
  const rows = monthlyIntensity(
    [
      { month: "2025-01", siteId: "1", siteName: "A", emissions: "20380" },
      { month: "2025-02", siteId: 1, siteName: "A", emissions: 10 },
    ],
    [{ month: "2025-01", siteId: 1, siteName: "A", production: "1200", unit: "tonne" }],
  );
  assert.deepEqual(rows, [
    { siteId: 1, siteName: "A", month: "2025-01", emissions: 20380, production: 1200, intensity: 16.983333, unit: "tonne" },
    { siteId: 1, siteName: "A", month: "2025-02", emissions: 10, production: 0, intensity: 0, unit: "unit" },
  ]);
});

test("data token measures read the resolved binding; unavailable stays unavailable", () => {
  const r = { source: "ghg", display: "120", value: 120, unit: "tCO₂e", total: 480, compare: { against: "prior", year: 2024, value: 100, change_abs: 20, change_pct: 20 }, series: [{ label: "Total", values: [{ key: "2024", value: 100 }, { key: "2025", value: 120 }] }] };
  const tok = (measure, extra = {}) => ({ type: "data", attrs: { binding: { source: "ghg", metric: "total", years: { last: 2 }, sites: "all" }, measure, ...extra } });
  assert.equal(resolveToken(r, tok("value", { format: "1dp" })).display, "120.0");
  assert.equal(resolveToken(r, tok("change_pct")).display, "+20.0%");
  assert.equal(resolveToken(r, tok("change_abs")).display, "+20");
  assert.equal(resolveToken(r, tok("share")).display, "25.0%");
  assert.equal(resolveToken(r, tok("value", { year: 2024 })).display, "100");
  assert.equal(resolveToken(r, tok("value", { year: "prior" })).display, "100");
  assert.equal(resolveToken(r, tok("progress")).display, EMPTY, "no target");
  const off = { source: "ghg", display: "Not reported", value: null, unit: "tCO₂e", unavailable: { reason: "NOT_RECORDED" } };
  assert.equal(resolveToken(off, tok("change_pct")), off);
  const kpi = { source: "kpi", display: "80", value: 80, unit: "t", target: { baseline_year: 2020, baseline_value: 100, target_year: 2030, target_value: 60, progress_pct: 50, status: "on_track" } };
  assert.equal(resolveToken(kpi, tok("progress")).display, "50%");
  assert.equal(resolveToken(kpi, tok("target")).display, "60");
  assert.equal(resolveToken(kpi, tok("baseline")).display, "100");
});

test("checkSites: unreadable ids are not found; 'all' needs every site", () => {
  assert.deepEqual(checkSites([2, 1, 2], [1, 2, 3], true), [1, 2]);
  assert.deepEqual(checkSites("all", [1, 2], true), [1, 2]);
  assert.throws(() => checkSites([3], [1, 2], true), (e) => e.code === "DS_DOC_NOT_FOUND");
  assert.throws(() => checkSites("all", [1], false), (e) => e.code === "DS_SITES_SCOPE");
});

test("materialityPoints: null until every material topic is scored", () => {
  const t = (topic, material, i, f) => ({ esrs_topic: topic, name: topic, material, impact_score: i, financial_score: f });
  assert.equal(materialityPoints([]), null);
  assert.equal(materialityPoints([t("E1", true, 7, null)]), null);
  assert.deepEqual(materialityPoints([t("E1", true, 7, 8.5), t("E3", false, null, null)]), [{ topic: "E1", label: "E1", impact: 7, financial: 8.5 }]);
});

test("a doc's tokens and element bindings are collected in page order (fixture docs)", () => {
  const fs = require("fs");
  const { ReportDocSchema } = dist("studio/contracts/index.js");
  const { collectTokens, docBindings } = dist("studio/sources/doc.js");
  for (const name of ["ghg-doc", "sustainability-doc"]) {
    const doc = ReportDocSchema.parse(JSON.parse(fs.readFileSync(path.resolve(`ci/fixtures/studio/${name}.json`), "utf8")));
    const tokens = collectTokens(doc);
    const bindings = docBindings(doc);
    const text = JSON.stringify(doc);
    assert.equal(tokens.length, (text.match(/"type":"data"/g) ?? []).length, `${name}: every chip`);
    for (const t of tokens) assert.equal(t.type, "data");
    for (const b of bindings) assert.ok(["ghg", "kpi", "input", "custom"].includes(b.source), `${name}: ${b.source}`);
    const { collectBindings } = dist("studio/contracts/index.js");
    assert.equal(collectBindings(doc).length, bindings.length + tokens.length, `${name}: contracts collectBindings = elements + chips`);
  }
});
