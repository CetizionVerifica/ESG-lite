// DS-5 pure logic: the auto-build steps (template split and hints, assemble,
// placeholders, empty data pages and drops, element stamps, rebuild merge),
// readiness (GHG gaps and states, sustainability RS readiness), autosave
// timing and presence. Runs against the build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const dist = (p) => require(path.resolve("dist", p));
const build = dist("studio/docs/build.js");
const { splitTemplateDoc, blankTemplate } = dist("studio/docs/template.js");
const readiness = dist("studio/docs/readiness.js");
const store = dist("studio/docs/store.js");
const { ReportDocSchema, CreateDocBodySchema, PatchDocBodySchema } = dist("studio/contracts/index.js");

const TEMPLATE_DOC = require(path.resolve("ci/fixtures/studio/ds-5-template-ghg.json"));
const ROW = { id: 7, companyId: null, kind: "ghg", purpose: "report", format: "a4", name: "Inventory", version: 3, theme: {}, doc: TEMPLATE_DOC };
const CHOICES = { kind: "ghg", year: 2026, yearType: "FY", sites: "all", frameworks: ["GHGP", "GRI"], compareYear: 2025 };
const clone = (v) => JSON.parse(JSON.stringify(v));
const assembled = () => {
  const { doc } = splitTemplateDoc(clone(TEMPLATE_DOC));
  return build.assembleDoc(ROW, doc, CHOICES);
};
const ctx = (inputs = {}) => ({
  companyName: "CI Steel Co",
  title: "Inventory FY 2025–26",
  year: 2026,
  yearType: "FY",
  compareYear: 2025,
  sitesText: "All sites",
  frameworksText: "GHGP",
  inputs,
  periodText: "Financial year 2026",
});
const texts = (node, out = []) => {
  if (!node || typeof node !== "object") return out;
  if (node.type === "text") out.push(node.text);
  (node.content ?? []).forEach((c) => texts(c, out));
  return out;
};
const page = (doc, id) => doc.pages.find((p) => p.id === id);
const val = (value) => ({ source: "ghg", display: String(value), value, unit: "tCO₂e" });
const none = (reason = "NO_DATA") => ({ source: "ghg", display: "Not reported", value: null, unit: null, unavailable: { reason } });

test("periodLabel: FY 2026 is FY 2025–26; a calendar year is the year", () => {
  assert.equal(build.periodLabel("FY", 2026), "FY 2025–26");
  assert.equal(build.periodLabel("FY", 2000), "FY 1999–00");
  assert.equal(build.periodLabel("CY", 2025), "2025");
});

test("splitTemplateDoc strips page-level and top-level hints; the page-level value wins", () => {
  const raw = clone(TEMPLATE_DOC);
  raw.pages[0].keepEmpty = false;
  raw.pages[0].requires = "none";
  raw.build.pages["p-cover"] = { keepEmpty: true };
  raw.build.pages["p-bad"] = { keepEmpty: "yes" }; // malformed: ignored
  const { doc, hints } = splitTemplateDoc(raw);
  assert.equal(doc.build, undefined);
  assert.ok(doc.pages.every((p) => !("keepEmpty" in p) && !("requires" in p) && !("emptyText" in p)));
  assert.deepEqual(hints.get("p-cover"), { keepEmpty: false, requires: "none" });
  assert.deepEqual(hints.get("p-cat9"), { keepEmpty: true, emptyText: "Category 9 is not reported yet." });
  assert.equal(hints.has("p-bad"), false);
});

test("assembleDoc sets kind, meta and design from the row and the choices; frameworks of other kinds drop out", () => {
  const doc = assembled();
  assert.equal(doc.schemaVersion, 2);
  assert.equal(doc.kind, "ghg");
  assert.equal(doc.format, "a4");
  assert.deepEqual(doc.meta.frameworks, ["GHGP"]);
  assert.equal(doc.meta.title, "Inventory FY 2025–26");
  assert.equal(doc.meta.compareYear, 2025);
  assert.equal(doc.meta.subtitle, "Greenhouse gas inventory {{meta.periodShort}}");
  assert.deepEqual(doc.design, { templateId: "7", templateVersion: 3, theme: { look: "classic" } });
  assert.ok(ReportDocSchema.safeParse(doc).success, "the assembled template is a valid doc");
  const none = build.assembleDoc(ROW, splitTemplateDoc(clone(TEMPLATE_DOC)).doc, { ...CHOICES, frameworks: [] });
  assert.deepEqual(none.meta.frameworks, ["GHGP"], "an empty list gets the kind's first framework");
  const titled = build.assembleDoc(ROW, splitTemplateDoc(clone(TEMPLATE_DOC)).doc, { ...CHOICES, title: "Our footprint" });
  assert.equal(titled.meta.title, "Our footprint");
});

test("fillPlaceholders fills company, period and inputs everywhere; a missing input stays visible", () => {
  const doc = build.fillPlaceholders(assembled(), ctx({ consolidation_approach: { value: "Operational control", source: "company", updatedBy: null, updatedAt: "prefill" } }));
  assert.equal(doc.meta.subtitle, "Greenhouse gas inventory FY 2025–26");
  assert.deepEqual(texts(page(doc, "p-cover").elements[0].props.doc), ["Inventory FY 2025–26"]);
  assert.deepEqual(texts(page(doc, "p-cover").elements[1].props.doc), ["CI Steel Co · FY 2025–26"]);
  assert.equal(page(doc, "p-cover").elements[2].props.label, "tCO₂e in FY 2025–26");
  assert.deepEqual(texts(page(doc, "p-method").content), ["Consolidation approach: Operational control."]);
  const body = texts(page(doc, "p-summary").elements[1].props.doc);
  assert.equal(body[1], " tCO₂e. Prepared by [Responsible person: add it in Report details].");
  assert.ok(ReportDocSchema.safeParse(doc).success);
});

test("placeholderValue: compare year falls back to the prior year; unknown input keys stay as written", () => {
  const c = ctx();
  delete c.compareYear;
  assert.equal(build.placeholderValue("meta.compareYear", c), "FY 2024–25");
  assert.equal(build.fillText("{{input:not_a_key}}", c), "{{input:not_a_key}}");
  assert.equal(build.fillText("{{ meta.year }}/{{meta.sites}}", c), "2026/All sites");
  assert.equal(build.fillText("{{input:verification}}", ctx({ verification: { value: { status: "limited", provider: "Assure Co" }, source: "typed", updatedBy: 2, updatedAt: "x" } })), "Limited assurance by Assure Co");
});

test("pageDataSlots indexes bindings and chips per page in resolve order", () => {
  const doc = ReportDocSchema.parse(assembled());
  const slots = build.pageDataSlots(doc);
  assert.deepEqual(slots.get("p-cover"), { bindings: [0], tokens: [], sources: ["ghg"] });
  assert.deepEqual(slots.get("p-summary"), { bindings: [1], tokens: [0], sources: ["ghg", "ghg"] });
  assert.deepEqual(slots.get("p-market").bindings, [2]);
  assert.deepEqual(slots.get("p-cat9").bindings, [3]);
  assert.deepEqual(slots.get("p-method"), { bindings: [], tokens: [], sources: [] });
});

test("emptyDataPages: a page is empty when every GHG/KPI figure is unavailable or null; pages without data never are", () => {
  const doc = ReportDocSchema.parse(assembled());
  const empty = build.emptyDataPages(doc, { values: [val(12), val(4.3), none("NOT_RECORDED"), none()], tokens: [val(4.3)] });
  assert.deepEqual([...empty].sort(), ["p-cat9", "p-market"]);
  const series = build.emptyDataPages(doc, { values: [val(12), { ...none(), unavailable: undefined, series: [{ label: "2026", values: [{ key: "a", value: 2 }] }] }, none(), none()], tokens: [none()] });
  assert.equal(series.has("p-summary"), false, "a series with a value is data");
  assert.equal(build.hasData({ source: "kpi", display: "0", value: 0, unit: null }), true, "a KPI value of zero is reported");
  assert.equal(build.hasData({ source: "ghg", display: "0", value: 0, unit: null }), false, "GHG reads 0 when nothing is approved");
  assert.equal(build.hasData({ source: "ghg", display: "0", value: 0, unit: null, series: [{ label: "x", values: [{ key: "a", value: 0 }, { key: "b", value: 1.5 }] }] }), true);
});

test("dropEmptyPages leaves out empty pages unless kept; a kept page gets its empty text", () => {
  const { doc: tdoc, hints } = splitTemplateDoc(clone(TEMPLATE_DOC));
  const doc = build.assembleDoc(ROW, tdoc, CHOICES);
  const dropped = build.dropEmptyPages(doc, hints, new Set(["p-market", "p-cat9"]));
  assert.deepEqual(dropped.map((d) => d.pageId), ["p-market"]);
  assert.deepEqual(doc.pages.map((p) => p.id), ["p-cover", "p-summary", "p-cat9", "p-method"]);
  assert.deepEqual(texts(page(doc, "p-cat9").elements[1].props.doc), ["Category 9 is not reported yet."]);
  const keep = new Map([["p-market", { requires: "none" }]]);
  const doc2 = build.assembleDoc(ROW, splitTemplateDoc(clone(TEMPLATE_DOC)).doc, CHOICES);
  assert.equal(build.dropEmptyPages(doc2, keep, new Set(["p-market"])).length, 0);
});

test("stampElements marks bound elements and text with chips only", () => {
  const doc = build.stampElements(assembled(), "sha256:x");
  const cover = page(doc, "p-cover").elements;
  assert.equal(cover[0].basedOnHash, undefined);
  assert.equal(cover[2].basedOnHash, "sha256:x");
  assert.equal(page(doc, "p-summary").elements[1].basedOnHash, "sha256:x");
});

test("mergeRebuild keeps user elements, reviewed text, moved frames, page order and added pages", () => {
  const fresh = assembled();
  const current = clone(fresh);
  current.pages.reverse();
  const summary = page(current, "p-summary");
  summary.elements[0].frame = { ...summary.elements[0].frame, x: 30 }; // moved by a person
  summary.elements[1].reviewed = true;
  summary.elements[1].props.doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Edited" }] }] };
  summary.elements.push({ ...clone(fresh.pages[0].elements[0]), id: "u1", source: "user" });
  current.pages.push({ id: "p-extra", kind: "freeform", name: "Mine", background: {}, elements: [] });
  page(current, "p-cover").hidden = true;
  page(fresh, "p-cover").elements[0].props.align = "center"; // the template changed
  const { doc, rebuilt } = build.mergeRebuild(current, fresh);
  assert.deepEqual(doc.pages.map((p) => p.id), [...current.pages.map((p) => p.id)]);
  assert.deepEqual(rebuilt.sort(), ["p-cat9", "p-cover", "p-market", "p-method", "p-summary"]);
  const s = page(doc, "p-summary").elements;
  assert.equal(s[0].frame.x, 30);
  assert.deepEqual(texts(s[1].props.doc), ["Edited"]);
  assert.ok(s.some((e) => e.id === "u1"));
  assert.equal(page(doc, "p-cover").elements[0].props.align, "center");
  assert.equal(page(doc, "p-cover").hidden, true);
  const only = build.mergeRebuild(current, fresh, ["p-method"]);
  assert.deepEqual(only.rebuilt, ["p-method"]);
  assert.equal(page(only.doc, "p-cover").elements[0].props.align, "left", "pages not asked for stay as they are");
});

test("blankTemplate is one valid empty page in the format; the purpose follows the format", () => {
  const t = blankTemplate("ghg", "slide_16_9");
  assert.equal(t.purpose, "deck");
  const doc = build.assembleDoc(t, t.doc, { ...CHOICES, frameworks: [] });
  assert.equal(doc.design.templateId, "blank");
  assert.ok(ReportDocSchema.safeParse(doc).success);
});

test("request schemas: create needs kind, template, year; patch needs doc or title", () => {
  assert.ok(CreateDocBodySchema.safeParse({ kind: "ghg", templateId: 1, year: 2025, yearType: "CY" }).success);
  assert.ok(CreateDocBodySchema.safeParse({ kind: "ghg", templateId: "blank", year: 2025, yearType: "FY", format: "a4" }).success);
  assert.equal(CreateDocBodySchema.safeParse({ kind: "ghg", templateId: "x", year: 2025, yearType: "CY" }).success, false);
  assert.equal(CreateDocBodySchema.safeParse({ kind: "ghg", templateId: 1, year: 2025, yearType: "CY", extra: 1 }).success, false);
  assert.equal(PatchDocBodySchema.safeParse({ rev: 1 }).success, false);
  assert.ok(PatchDocBodySchema.safeParse({ rev: 1, title: "New" }).success);
});

const facts = (over = {}) => ({
  year: 2025,
  yearType: "CY",
  sites: [
    { id: 1, name: "Plant A" },
    { id: 2, name: "Plant B" },
    { id: 3, name: "Depot" },
  ],
  counts: { approved: 10, pending: 0, rejected: 0 },
  approvedBySite: new Map([
    [1, 8],
    [2, 2],
  ]),
  approvedMonths: new Map([
    [1, new Set(["2025-01", "2025-02", "2025-03"])],
    [2, new Set(["2025-01"])],
  ]),
  monthlySites: new Set([1, 2]),
  monthsSoFar: ["2025-01", "2025-02", "2025-03"],
  scope3: { reported: [1, 4, 6], excluded: [8, 4, 15] },
  ...over,
});

test("ghgReadiness: counts, sites, months, Scope 3 n/15, and a gap with a link for each", () => {
  const r = readiness.ghgReadiness(facts({ counts: { approved: 10, pending: 4, rejected: 1 } }));
  assert.equal(r.approvedRows, 10);
  assert.equal(r.pendingRows, 4);
  assert.equal(r.sitesCovered, 2);
  assert.equal(r.sitesTotal, 3);
  assert.deepEqual(r.sitesMissing, [{ id: 3, name: "Depot" }]);
  assert.equal(r.monthsCovered, 3);
  assert.equal(r.monthsExpected, 3);
  assert.deepEqual(r.monthsMissing, [{ siteId: 2, siteName: "Plant B", months: ["2025-02", "2025-03"] }]);
  assert.equal(r.scope3Addressed, "5/15");
  assert.deepEqual(r.scope3.excluded, [8, 15], "a reported category isn't counted as excluded too");
  assert.equal(r.scope3.unaddressed.length, 10);
  const kinds = r.gaps.map((g) => g.kind);
  assert.deepEqual(kinds, ["pending_entries", "rejected_entries", "site_no_data", "months_missing", "scope3_unaddressed"]);
  assert.equal(r.gaps[0].message, "4 entries wait for approval. A final needs them approved.");
  assert.equal(r.gaps[0].link, "/data/approvals");
  assert.equal(r.gaps[1].message, "1 rejected entry isn't corrected yet.");
  assert.equal(r.gaps[2].link, "/data/ledger?site=3");
  assert.equal(r.gaps[3].message, "Plant B has no approved data for Feb 2025, Mar 2025.");
  assert.equal(r.gaps[4].link, "/settings/scope3/screening");
  assert.match(r.gaps[4].message, /^Categories 2, 3, 5, 7, 9, 10, 11, 12, 13 and 14 are neither reported nor excluded\.$/);
  assert.equal(r.state, "almost");
});

test("ghgReadiness: nothing approved is not ready; everything covered is ready", () => {
  const empty = readiness.ghgReadiness(facts({ counts: { approved: 0, pending: 0, rejected: 0 }, approvedBySite: new Map(), approvedMonths: new Map() }));
  assert.equal(empty.state, "not_ready");
  assert.equal(empty.gaps[0].kind, "no_data");
  assert.equal(empty.monthsMissing.length, 0, "a site with nothing is reported once, as a site");
  const all = Array.from({ length: 15 }, (_, i) => i + 1);
  const ready = readiness.ghgReadiness(
    facts({
      sites: [{ id: 1, name: "Plant A" }],
      monthlySites: new Set([1]),
      scope3: { reported: all, excluded: [] },
    }),
  );
  assert.equal(ready.state, "ready");
  assert.deepEqual(ready.gaps, []);
  assert.equal(ready.scope3Addressed, "15/15");
  const yearly = readiness.ghgReadiness(facts({ monthlySites: new Set([1]) }));
  assert.equal(yearly.monthsMissing.length, 0, "a yearly site has no months to miss");
  assert.equal(readiness.categoriesText([9]), "Category 9");
});

test("monthsSoFar: past years have 12 months; the current year only those started", () => {
  assert.equal(readiness.monthsSoFar("CY", 2024, new Date("2026-10-20")).length, 12);
  assert.deepEqual(readiness.monthsSoFar("FY", 2027, new Date("2026-06-15T00:00:00Z")), ["2026-04", "2026-05", "2026-06"]);
  assert.deepEqual(readiness.monthsSoFar("CY", 2030, new Date("2026-06-15")), []);
  assert.equal(readiness.monthText("2025-03"), "Mar 2025");
});

test("sustainabilityReadiness: RS shape, grouped missing KPIs, lock and pending gaps; setup first", () => {
  const r = readiness.sustainabilityReadiness({
    year: 2026,
    yearType: "FY",
    setupDone: true,
    locked: false,
    lockedAt: null,
    coverage: [{ framework: "GRI", pct: 82 }],
    gaps: [
      { code: "WATER", kpi_name: "Water", site_id: 1, period_labels: ["Apr 2025"] },
      { code: "WATER", kpi_name: "Water", site_id: 2, period_labels: ["Apr 2025", "May 2025"] },
      { code: "BOARD", kpi_name: "Board", site_id: null, period_labels: ["FY 2025–26"] },
    ],
    pendingCount: 2,
  });
  assert.deepEqual(r.missing[0], { kpi: "WATER", name: "Water", sites: [1, 2], periods: ["Apr 2025", "May 2025"] });
  assert.deepEqual(r.missing[1].sites, []);
  assert.deepEqual(r.gaps.map((g) => g.kind), ["kpi_missing", "kpi_pending", "year_not_locked"]);
  assert.equal(r.state, "almost");
  const notSetUp = readiness.sustainabilityReadiness({ year: 2026, yearType: "FY", setupDone: false, locked: false, lockedAt: null, coverage: [], gaps: [], pendingCount: 0 });
  assert.equal(notSetUp.state, "not_ready");
  assert.deepEqual(notSetUp.gaps.map((g) => g.kind), ["kpi_setup"]);
});

test("autosaveDue every 10 minutes; presence counts other users seen in the last 45 s", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  assert.equal(store.autosaveDue(null, now), true);
  assert.equal(store.autosaveDue(new Date("2026-10-20T09:51:00Z"), now), false);
  assert.equal(store.autosaveDue(new Date("2026-10-20T09:50:00Z"), now), true);
  store.resetPresence();
  assert.equal(store.presence(1, 10, 1000), 0);
  assert.equal(store.presence(1, 11, 2000), 1);
  assert.equal(store.presence(1, 10, 3000), 1);
  assert.equal(store.presence(2, 10, 3000), 0, "per doc");
  assert.equal(store.presence(1, 10, 3000 + store.PRESENCE_TTL_MS + 1), 0, "an old heartbeat expires");
});
