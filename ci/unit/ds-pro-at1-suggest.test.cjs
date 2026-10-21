// AT-1 template suggestions, pure parts (src/studio/suggest/rules.ts):
//   - brief ↔ kind checks; rule shortlist (kind, format, purpose, one look per family by tone,
//     rule fit from purpose, length, frameworks, audience);
//   - data units per template (data pages; Scope 3 category flow = one unit per category) and
//     readiness scoring from counts (score, level, badges, "Not reported" pages counted once);
//   - ranking (rule fit 60 % + readiness 40 %);
//   - the model's answer guard: ids in the shortlist, no literal numbers except the counts
//     offered (and years), page ids and layout slugs filtered, tokens refused.
// Runs against the build:   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const r = require(path.resolve("dist/studio/suggest/rules.js"));

const tpl = (id, over = {}) => ({
  id,
  companyId: null,
  kind: "ghg",
  purpose: "report",
  format: "a4",
  name: `T${id}`,
  tags: [],
  version: 1,
  thumbnailUrl: null,
  pageCount: 20,
  slug: `fam${id}-classic`,
  family: `fam${id}`,
  look: "classic",
  description: "",
  frameworks: ["GHGP"],
  ...over,
});
const brief = (over = {}) => ({ purpose: "ghg_inventory", frameworks: ["GHGP"], audience: "verifier", length: "medium", ...over });

test("briefIssues: purpose and frameworks must belong to the kind", () => {
  assert.deepEqual(r.briefIssues("ghg", brief()), []);
  assert.equal(r.briefIssues("sustainability", brief()).length, 2); // ghg_inventory + GHGP
  assert.equal(r.briefIssues("ghg", brief({ purpose: "sustainability_report" }))[0].path, "brief.purpose");
  assert.deepEqual(r.briefIssues("ghg", brief({ purpose: "board_brief" })), []);
  assert.equal(r.briefIssues("ghg", brief({ frameworks: ["GRI"] }))[0].path, "brief.frameworks.0");
});

test("ruleShortlist: kind and format are hard filters; purpose filters when any template has it", () => {
  const ts = [tpl(1), tpl(2, { purpose: "deck", format: "slide_16_9", pageCount: 10 }), tpl(3, { kind: "sustainability" }), tpl(4, { purpose: "summary", pageCount: 2 })];
  const a = r.ruleShortlist(ts, { kind: "ghg", brief: brief(), enabledFrameworks: [] });
  assert.equal(a.considered, 3);
  assert.deepEqual(a.entries.map((e) => e.template.id), [1]); // report only
  const b = r.ruleShortlist(ts, { kind: "ghg", brief: brief({ purpose: "board_brief", length: "short", audience: "board" }), enabledFrameworks: [] });
  assert.deepEqual(b.entries.map((e) => e.template.id), [4, 2]); // deck and summary fit; 2 pages wins on length
  const c = r.ruleShortlist(ts, { kind: "ghg", brief: brief({ purpose: "board_brief" }), format: "a4", enabledFrameworks: [] });
  assert.deepEqual(c.entries.map((e) => e.template.id), [4]);
  // No template has the purpose: the format's templates are kept
  const d = r.ruleShortlist([tpl(1)], { kind: "ghg", brief: brief({ purpose: "site_fact_sheet" }), enabledFrameworks: [] });
  assert.deepEqual(d.entries.map((e) => e.template.id), [1]);
});

test("ruleShortlist: one look per family, the one the tone prefers", () => {
  const ts = [tpl(1, { family: "inv", look: "classic" }), tpl(2, { family: "inv", look: "light" }), tpl(3, { family: "inv", look: "night" })];
  const pick = (tone) => r.ruleShortlist(ts, { kind: "ghg", brief: brief({ tone }), enabledFrameworks: [] }).entries.map((e) => e.template.id);
  assert.deepEqual(pick("formal"), [1]);
  assert.deepEqual(pick("plain"), [2]);
  assert.deepEqual(pick("engaging"), [3]);
  assert.deepEqual(pick(undefined), [1]);
});

test("ruleFit: frameworks and length move the fit", () => {
  const iso = tpl(1, { frameworks: ["GHGP", "ISO14064"] });
  const gp = tpl(2, { frameworks: ["GHGP"] });
  const b = brief({ frameworks: ["ISO14064"] });
  assert.ok(r.ruleFit(iso, b, ["ISO14064"]) > r.ruleFit(gp, b, ["ISO14064"]));
  assert.ok(r.ruleFit(tpl(3, { pageCount: 20 }), brief(), []) > r.ruleFit(tpl(4, { pageCount: 40 }), brief(), []));
  // the tone's look counts across families
  assert.ok(r.ruleFit(tpl(5, { look: "night" }), brief({ tone: "engaging" }), []) > r.ruleFit(tpl(6, { look: "classic" }), brief({ tone: "engaging" }), []));
  // wanted frameworks are limited to what the company has on
  assert.deepEqual(r.wantedFrameworks({ kind: "sustainability", brief: { ...brief(), purpose: "sustainability_report", frameworks: ["GRI", "ESRS"] }, enabledFrameworks: ["GRI"] }), ["GRI"]);
  assert.deepEqual(r.wantedFrameworks({ kind: "sustainability", brief: { ...brief(), purpose: "sustainability_report", frameworks: [] }, enabledFrameworks: ["BRSR"] }), ["BRSR"]);
});

test("templateFrameworks: meta frameworks, index pages and tags", () => {
  const doc = { meta: { frameworks: ["GHGP"] }, pages: [{ id: "p1", kind: "flow", flowType: "iso_index" }] };
  assert.deepEqual(r.templateFrameworks("ghg", doc, []), ["GHGP", "ISO14064"]);
  assert.deepEqual(r.templateFrameworks("sustainability", { pages: [] }, ["gri", "esrs"]), ["GRI", "ESRS"]);
});

const ghgB = (metric, extra = {}) => ({ source: "ghg", metric, years: { last: 1 }, sites: "all", ...extra });
const el = (id, binding) => ({ id, type: "bignumber", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, z: 1, source: "template", props: { binding } });
const doc = (pages) => ({ schemaVersion: 2, kind: "ghg", purpose: "report", format: "a4", meta: { year: 2025, yearType: "CY", sites: "all", frameworks: ["GHGP"], title: "x", language: "en" }, design: {}, pages, assets: [] });
const page = (id, elements) => ({ id, kind: "freeform", name: id, elements });

test("templateDataUnits + scoreReadiness: counts, badges, pages counted once", () => {
  const d = doc([
    page("cover", []),
    page("s1", [el("a", ghgB("scope1"))]),
    page("s3", [el("b", ghgB("scope3"))]),
    page("base", [el("c", ghgB("total", { compare: "base" }))]),
    { id: "p9-scope3_categories", kind: "flow", name: "Scope 3 categories", flowType: "scope3_categories", options: { categories: [1, 2, 3, 4] } },
  ]);
  const units = r.templateDataUnits(d, new Set(["base"]), [1, 4]);
  assert.equal(units.length, 3 + 4); // cover has no data
  const facts = { kind: "ghg", scope12Months: { have: 12, of: 12 }, scope3: { reported: [1, 4], excluded: [2] }, kpiCoverage: [], targets: 0, baseYear: false };
  const rd = r.scoreReadiness(units, facts, ["GHGP"]);
  assert.equal(rd.notReportedPages, 3); // base page + categories 2 and 3
  assert.equal(rd.score, Math.round((100 * 4) / 7));
  assert.equal(rd.level, "partial");
  const by = Object.fromEntries(rd.badges.map((b) => [b.key, b]));
  assert.deepEqual([by.scope12_months.have, by.scope12_months.of, by.scope12_months.status], [12, 12, "ok"]);
  assert.equal(by.scope12_months.label, "Scope 1 and 2: 12 of 12 months approved");
  assert.deepEqual([by.scope3_categories.have, by.scope3_categories.of, by.scope3_categories.notReportedPages], [2, 15, 2]);
  assert.match(by.scope3_categories.label, /^Scope 3: 2 of 15 categories have data · 2 pages/);
  assert.deepEqual([by.base_year.status, by.base_year.notReportedPages], ["missing", 1]);
  assert.equal(by.kpi_coverage, undefined);
  // No data pages at all: ready
  assert.deepEqual(r.scoreReadiness([], facts, []), { score: 100, level: "ready", badges: [], notReportedPages: 0 });
});

test("scoreReadiness: KPI coverage per framework and targets (sustainability)", () => {
  const kpiB = (compare) => ({ source: "kpi", kpis: ["GRI-302-1"], years: { last: 1 }, sites: "all", ...(compare ? { compare } : {}) });
  const d = doc([page("energy", [el("a", kpiB())]), page("targets", [el("b", kpiB("target"))])]);
  const units = r.templateDataUnits(d, new Set(["targets"]), []);
  const facts = { kind: "sustainability", scope12Months: { have: 0, of: 12 }, scope3: { reported: [], excluded: [] }, kpiCoverage: [{ framework: "GRI", pct: 72.4 }, { framework: "ESRS", pct: 10 }], targets: 0, baseYear: false };
  const rd = r.scoreReadiness(units, facts, ["GRI"]);
  const keys = rd.badges.map((b) => `${b.key}:${b.framework ?? ""}:${b.have}`);
  assert.deepEqual(keys, ["kpi_coverage:GRI:72", "targets::0"]);
  assert.equal(rd.badges[1].label, "Targets page needs a target set in KPI tracking");
  assert.equal(rd.score, 50);
});

test("rankCandidates: fit 60 % + readiness 40 %", () => {
  const c = (id, fit, score) => ({ template: { id }, fit, readiness: { score } });
  assert.deepEqual(r.rankCandidates([c(1, 90, 0), c(2, 70, 100), c(3, 70, 100)]).map((x) => x.template.id), [2, 3, 1]);
});

const cand = (id, over = {}) => ({
  template: tpl(id, { pageCount: 22 }),
  fit: 80,
  readiness: { score: 60, level: "partial", notReportedPages: 6, badges: [{ key: "scope3_categories", label: "", have: 9, of: 15, status: "partial", notReportedPages: 6 }] },
  pages: [{ id: "p1-cover", name: "Cover" }, { id: "p5-boundary", name: "Boundary" }],
  addable: ["fam1/targets"],
  ...over,
});

test("readPicks: ids from the shortlist only, counts and years allowed, other numbers refused", () => {
  const cands = [cand(1), cand(2)];
  const allowed = r.offeredNumbers(cands);
  allowed.add(2025);
  const ok = r.readPicks(JSON.stringify({ picks: [{ templateId: 2, reasons: ["Built for verification of 2025.", "Scope 3: 9 of 15 categories have data; 6 pages say why."], pagesToDrop: ["p5-boundary", "nope"], pagesToAdd: ["fam1/targets", "other/x"] }] }), cands, allowed);
  assert.ok(Array.isArray(ok), JSON.stringify(ok));
  assert.deepEqual(ok[0], { templateId: 2, reasons: ["Built for verification of 2025.", "Scope 3: 9 of 15 categories have data; 6 pages say why."], pagesToDrop: ["p5-boundary"], pagesToAdd: ["fam1/targets"] });

  const bad = r.readPicks(JSON.stringify({ picks: [{ templateId: 99, reasons: ["x"] }] }), cands, allowed);
  assert.match(bad.issues[0], /templateId 99 isn't in TEMPLATES/);
  const fig = r.readPicks(JSON.stringify({ picks: [{ templateId: 1, reasons: ["Emissions fell to 4,210 tCO2e."] }] }), cands, allowed);
  assert.ok(fig.issues.some((i) => /4,210/.test(i)), JSON.stringify(fig));
  const pct = r.readPicks(JSON.stringify({ picks: [{ templateId: 1, reasons: ["Cuts 37% of pages."] }] }), cands, allowed);
  assert.ok(pct.issues.length);
  const tok = r.readPicks(JSON.stringify({ picks: [{ templateId: 1, reasons: ["Total {{data:total|current|value}}."] }] }), cands, allowed);
  assert.ok(tok.issues.some((i) => /tokens/.test(i)));
  assert.match(r.readPicks("not json", cands, allowed).issues[0], /JSON/);
  assert.ok(r.readPicks(JSON.stringify({ picks: [] }), cands, allowed).issues.length); // zod: min 1
  const dup = r.readPicks(JSON.stringify({ picks: [{ templateId: 1, reasons: ["a"] }, { templateId: 1, reasons: ["b"] }] }), cands, allowed);
  assert.match(dup.issues[0], /twice/);
});

test("scrubPromptText: no emails, phones, company names or figures; years, codes and small counts stay", () => {
  const names = ["CI Steel Co", "CI Steel", "x"];
  const out = r.scrubPromptText(
    "CI Steel Co (ci steel) wants a 2025 report for ISO 14064-1 and GRI 305-1. Mail esg.team@ci-steel.example or call +91 98765 43210. " +
      "We cut 4,210 tCO2e, 12.5% less, spent ₹3 crore and $1.2m, 12,34,567 kWh, 250 t of coal, 123456 litres. Scope 3: 9 of 15 categories, 2024-2025.",
    names,
  );
  for (const bad of ["CI Steel", "ci steel", "@", "98765", "4,210", "12.5", "₹3", "$1.2", "12,34,567", "250 t", "123456"]) assert.ok(!out.includes(bad), `${bad} in: ${out}`);
  for (const ok of ["the company", "2025", "ISO 14064-1", "GRI 305-1", "[email]", "[phone]", "[figure]", "9 of 15 categories", "2024-2025"]) assert.ok(out.includes(ok), `${ok} missing: ${out}`);
  assert.equal(r.scrubPromptText("Classic GHG inventory, about 20 pages", names), "Classic GHG inventory, about 20 pages");
  assert.equal(r.scrubPromptText("", names), "");
});
