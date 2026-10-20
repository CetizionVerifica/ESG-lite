// DS-0 contract tests: enums, error codes, check ids and AI actions match
// docs/design-studio/01-contracts.md; the ReportDoc v2 zod schema accepts both
// fixture docs (ci/fixtures/studio/) and rejects bad ones (a frame outside the
// format first); upgradeV1 turns an RS v1 doc into a valid v2 doc; the FE
// snapshot (ci/studio-contracts.json) is current. Runs against the build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const c = require(path.resolve("dist/studio/contracts/index.js"));
const fixture = (name) => JSON.parse(fs.readFileSync(path.resolve(`ci/fixtures/studio/${name}.json`), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));
const issues = (doc) => {
  const r = c.ReportDocSchema.safeParse(doc);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

test("§1 enums hold the contract values", () => {
  assert.deepEqual([...c.REPORT_KINDS], ["ghg", "sustainability"]);
  assert.deepEqual([...c.PAGE_FORMATS], ["a4", "a4_landscape", "letter", "a5", "slide_16_9", "square", "social_191"]);
  assert.deepEqual([...c.DOC_PURPOSES], ["report", "summary", "deck", "social"]);
  assert.deepEqual([...c.DATA_SOURCES], ["kpi", "ghg", "input", "custom"]);
  assert.deepEqual([...c.DOWNLOAD_KINDS], ["pdf_screen", "pdf_print", "png_pages"]);
  assert.deepEqual([...c.JOB_KINDS], ["proof", "final", "thumbnail", "png", "print"]);
  assert.deepEqual([...c.APPROVAL_STATES], ["none", "requested", "approved", "changes_requested"]);
  assert.deepEqual([...c.VERSION_KINDS], ["snapshot", "review", "final", "autosave"]);
  for (const t of ["frame", "grid", "line", "big_number", "progress", "callout", "qr", "text", "kpi_tile", "placeholder"]) assert.ok(c.ELEMENT_TYPES.includes(t), t);
  assert.equal(c.ELEMENT_TYPES.length, 18);
  for (const k of ["scope_split", "category_bars", "gas_split", "site_bars", "monthly_stack", "base_year_waterfall", "intensity_line", "treemap", "sankey"]) assert.ok(c.CHART_KINDS.includes(k), k);
  assert.equal(c.GHG_METRICS.length, 19);
  assert.deepEqual([...c.GHG_BREAKDOWNS], ["scope", "scope3_category", "site", "month", "quarter", "gas", "fuel", "source_category"]);
  for (const f of ["ghgp_index", "iso_index", "ghg_factor_table", "scope3_categories", "gri_index"]) assert.ok(c.FLOW_TYPES.includes(f), f);
  assert.equal(c.REPORT_INPUT_KEYS.length, 18);
  assert.deepEqual(c.inputKeysFor("sustainability"), ["reporting_period", "verification", "leadership_message", "about_company"]);
  assert.ok(c.inputKeysFor("ghg").includes("exclusions"));
  // Page sizes (DS-1 §1 table).
  assert.deepEqual(c.PAGE_FORMAT_SIZES.a4, { wMm: 210, hMm: 297, bleedMm: 3 });
  assert.deepEqual(c.PAGE_FORMAT_SIZES.slide_16_9, { wMm: 338.7, hMm: 190.5, bleedMm: 0 });
  assert.equal(c.PAGE_FORMAT_SIZES.social_191.hMm, 166.1);
});

test("§5 error codes: DS codes with their statuses, RS codes renamed", () => {
  const expect = {
    DS_STUDIO_OFF: 403, DS_KIND_OFF: 403, DS_FORMAT_INVALID: 422, DS_SOURCE_UNAVAILABLE: 422, DS_SHARE_EXPIRED: 410,
    DS_APPROVAL_PENDING: 409, DS_RESIZE_UNSUPPORTED: 422, DS_ROLE: 403, DS_SITES_SCOPE: 403, DS_DOC_NOT_FOUND: 404,
    DS_VERSION_CONFLICT: 409, DS_FINAL_IMMUTABLE: 409, DS_DOC_INVALID: 422, DS_DOC_TOO_LARGE: 413, DS_BINDING_INVALID: 422,
    DS_LAYOUT_NOT_FOUND: 404, DS_ASSET_TYPE: 415, DS_ASSET_TOO_LARGE: 413, DS_YEAR_NOT_LOCKED: 409, DS_CHECKS_BLOCKING: 409,
    DS_JOB_RUNNING: 409, DS_JOB_FAILED: 500, DS_AI_UNAVAILABLE: 503, DS_AI_BUDGET_EXCEEDED: 429, DS_AI_OUTPUT_INVALID: 502,
    DS_VALIDATION: 400, DS_COMPANY_REQUIRED: 400,
  };
  assert.deepEqual(Object.fromEntries(Object.entries(c.DS_ERRORS).map(([k, v]) => [k, v.status])), expect);
  assert.ok(c.DS_ERROR_CODES.every((code) => code.startsWith("DS_")));
  const e = new c.DsError("DS_STUDIO_OFF");
  assert.equal(e.status, 403);
  assert.deepEqual(e.toBody(), { code: "DS_STUDIO_OFF", message: "Design Studio isn't turned on for this company." });
  assert.deepEqual(new c.DsError("DS_SOURCE_UNAVAILABLE", { reason: "not_recorded" }).toBody().details, { reason: "not_recorded" });
});

test("§6 checks: RS ids kept, GHG ids added, kinds and default severities", () => {
  assert.equal(c.CHECK_IDS.length, 14 + 23 + 1); // DS-10: + TEXT_TRUNCATED
  assert.deepEqual(c.CHECK_RULES.YEAR_NOT_LOCKED.kinds, ["sustainability"]);
  assert.deepEqual(c.CHECK_RULES.GHG_PENDING_ENTRIES, { severity: "error", kinds: ["ghg"], finalOnly: true });
  assert.equal(c.CHECK_RULES.SCOPE2_MARKET_MISSING.severity, "warning");
  assert.equal(c.CHECK_RULES.UNCERTAINTY_MISSING.severity, "info");
  assert.equal(c.ISO_ESCALATION.RESPONSIBLE_PERSON_MISSING, "error");
  assert.ok(!c.checksFor("ghg").includes("YEAR_NOT_LOCKED"));
  assert.ok(!c.checksFor("sustainability").includes("GHG_PENDING_ENTRIES"));
  assert.ok(c.checksFor("sustainability").includes("UNLINKED_DATA"));
});

test("§8 AI actions: RS actions plus the DS ones", () => {
  assert.equal(c.AI_ACTIONS.length, 21 + 9);
  for (const a of ["design_from_brief", "exclusion_reason_draft", "apply_brand_voice", "draft_report", "missing_disclosures"]) assert.ok(c.AI_ACTIONS.includes(a), a);
  assert.ok(c.ChatTurnSchema.safeParse({ role: "user", text: "Make page 3 shorter" }).success);
  assert.ok(!c.ChatTurnSchema.safeParse({ role: "system", text: "x" }).success);
});

test("ReportDoc v2 accepts both fixture docs", () => {
  assert.deepEqual(issues(fixture("ghg-doc")), []);
  assert.deepEqual(issues(fixture("sustainability-doc")), []);
  assert.ok(c.docBytes(fixture("ghg-doc")) < c.MAX_DOC_BYTES);
});

test("the fixtures between them use every element type and every data source", () => {
  const types = new Set();
  const sources = new Set();
  for (const name of ["ghg-doc", "sustainability-doc"]) {
    const doc = fixture(name);
    for (const page of doc.pages) for (const e of page.elements ?? []) types.add(e.type);
    for (const b of c.collectBindings(c.ReportDocSchema.parse(doc))) sources.add(b.source);
  }
  assert.deepEqual([...c.ELEMENT_TYPES].filter((t) => !types.has(t)), []);
  assert.deepEqual([...sources].sort(), ["custom", "ghg", "input", "kpi"]);
});

test("rejects a frame outside the format", () => {
  const doc = fixture("ghg-doc");
  const bad = clone(doc);
  bad.pages[1].elements[0].frame = { x: 150, y: 20, w: 70, h: 15, rotation: 0 }; // 220 mm > 210 mm
  assert.ok(issues(bad).some((m) => m.startsWith("pages.1.elements.0.frame") && m.includes("outside the a4 page")));

  // The same frame fits once the doc is landscape (297 mm wide)…
  const wide = clone(bad);
  wide.format = "a4_landscape";
  wide.pages.forEach((p) => (p.elements ?? []).forEach((e) => (e.frame = { x: 10, y: 10, w: 20, h: 20, rotation: 0 })));
  wide.pages[1].elements[0].frame = { x: 150, y: 20, w: 70, h: 15, rotation: 0 };
  assert.deepEqual(issues(wide), []);
  // …but not on a 16:9 slide that is only 190.5 mm tall.
  const slide = clone(doc);
  slide.format = "slide_16_9";
  assert.ok(issues(slide).some((m) => m.includes("outside the slide_16_9 page")));

  // Bleed: a flagged image may reach 3 mm past the edge on A4, not 4 mm, and never on a screen format.
  const bleed = clone(doc);
  assert.equal(bleed.pages[0].elements[0].props.bleed, true);
  bleed.pages[0].elements[0].frame = { x: -4, y: -3, w: 217, h: 160, rotation: 0 };
  assert.ok(issues(bleed).some((m) => m.startsWith("pages.0.elements.0.frame")));
  const unflagged = clone(doc);
  delete unflagged.pages[0].elements[0].props.bleed;
  assert.ok(issues(unflagged).some((m) => m.startsWith("pages.0.elements.0.frame")));
  assert.ok(c.frameOnPage({ x: -3, y: -3, w: 216, h: 303 }, "a4", 3));
  assert.ok(!c.frameOnPage({ x: -3, y: -3, w: 216, h: 303 }, "a4", 0));
});

test("rejects other bad docs", () => {
  const doc = fixture("ghg-doc");
  const bad = (mutate) => {
    const d = clone(doc);
    mutate(d);
    return issues(d);
  };
  assert.ok(bad((d) => (d.schemaVersion = 1)).length);
  assert.ok(bad((d) => (d.format = "a3")).length, "unknown format");
  assert.ok(bad((d) => (d.meta.frameworks = ["GRI"])).some((m) => m.includes("isn't a framework of a ghg report")));
  assert.ok(bad((d) => (d.pages[1].id = d.pages[0].id)).some((m) => m.includes("Duplicate page id")));
  assert.ok(bad((d) => (d.pages[1].elements[1].id = d.pages[1].elements[0].id)).some((m) => m.includes("Duplicate element id")));
  assert.ok(bad((d) => (d.pages[1].elements[0].type = "video")).length, "unknown element type");
  assert.ok(bad((d) => (d.pages[1].elements[2].props.kind = "pie3d")).length, "unknown chart kind");
  assert.ok(bad((d) => (d.pages[1].elements[2].props.binding.metric = "scope4")).length, "unknown GHG metric");
  assert.ok(bad((d) => delete d.pages[2].elements[1].props.binding.scope3Category).some((m) => m.includes("scope3Category")));
  assert.ok(bad((d) => (d.pages[2].elements[3].props.binding.rows = [["2024"]])).some((m) => m.includes("one cell per column")));
  assert.ok(bad((d) => (d.pages[1].elements[5].props.binding = { source: "custom", columns: ["a"], rows: [] })).length, "a tile takes no custom data");
  assert.ok(bad((d) => (d.pages[0].elements[3].props.url = "javascript:alert(1)")).length, "QR links are http(s)");
  // Text: only the allowed nodes, heading levels 2–4, v1 kpi tokens are not v2.
  const body = (d) => d.pages[1].elements[1].props.doc.content[0];
  assert.ok(bad((d) => body(d).content.push({ type: "image", attrs: { src: "x" } })).length);
  assert.ok(bad((d) => (d.pages[1].elements[0].props.doc.content[0].attrs.level = 1)).some((m) => m.includes("level 2, 3 or 4")));
  assert.ok(bad((d) => body(d).content.push({ type: "kpi", attrs: { kpi: "ENERGY_TOTAL", year: "current", measure: "value" } })).length);
  assert.ok(bad((d) => body(d).content.push({ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:x" } }] })).length);
  assert.ok(bad((d) => (d.pages[1].elements[1].props.doc.content[0].content[0].text = "")).some((m) => m.includes("needs text")));
  // A doc over 2 MB is measured, not parsed.
  assert.ok(c.docBytes({ big: "x".repeat(c.MAX_DOC_BYTES) }) > c.MAX_DOC_BYTES);
});

test("report inputs: per-key value shapes", () => {
  const meta = { source: "typed", updatedBy: 2, updatedAt: "2026-10-20T10:00:00Z" };
  const ok = (inputs) => c.ReportInputsSchema.safeParse(inputs).success;
  assert.ok(ok({}));
  assert.ok(ok({
    consolidation_approach: { value: "operational control", source: "company", updatedBy: null, updatedAt: "2026-10-20" },
    exclusions: { value: [{ what: "Category 14 Franchises", reason: "No franchises" }], ...meta },
    verification: { value: { status: "limited", provider: "Verifier Ltd" }, ...meta },
    conformance: { value: ["GHGP", "ISO14064"], ...meta },
    revenue: { value: 1250000, source: "kpi", updatedBy: 2, updatedAt: "2026-10-20" },
    gwp_set: { value: "MIXED", ...meta },
  }));
  assert.ok(!ok({ revenue: { value: -1, ...meta } }));
  assert.ok(!ok({ verification: { value: { status: "full" }, ...meta } }));
  assert.ok(!ok({ exclusions: { value: [{ what: "" , reason: "x" }], ...meta } }));
  assert.ok(!ok({ favourite_colour: { value: "blue", ...meta } }));
  assert.ok(!ok({ revenue: { value: 10, source: "guess", updatedBy: 1, updatedAt: "x" } }));
});

test("upgradeV1: an RS v1 doc becomes a valid sustainability v2 doc, losing nothing", () => {
  const v1 = {
    schemaVersion: 1,
    meta: { title: "Annual report 2025", year: 2025, yearType: "FY", sites: [1, 2], frameworks: ["GRI"], language: "en" },
    design: { designId: "classic", designVersion: 3, theme: { look: "night" } },
    pages: [
      {
        id: "p1", kind: "freeform", name: "Highlights", background: {},
        elements: [
          { id: "p1.tile", type: "kpi_tile", frame: { x: 10, y: 10, w: 50, h: 30, rotation: 0 }, z: 0, source: "layout",
            props: { binding: { kpis: ["ENERGY_TOTAL"], years: { last: 2 }, sites: "all", unit: "GJ" }, showDelta: true, showSparkline: false, variant: "card" } },
          { id: "p1.text", type: "text", frame: { x: 10, y: 50, w: 190, h: 30, rotation: 0 }, z: 1, source: "user",
            props: { style: "body", align: "left", doc: { type: "doc", content: [{ type: "paragraph", content: [
              { type: "text", text: "Energy fell to " },
              { type: "kpi", attrs: { kpi: "ENERGY_TOTAL", year: "current", measure: "value", unit: "GJ", format: "int" } },
              { type: "text", text: ", from " },
              { type: "kpi", attrs: { kpi: "ENERGY_TOTAL", year: 2024, measure: "value", sites: [1] } },
            ] }] } } },
        ],
      },
      { id: "p2", kind: "flow", name: "Notes", flowType: "narrative", options: {},
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "kpi", attrs: { kpi: "WATER", year: "prior", measure: "change_pct" } }] }] } },
    ],
    assets: [],
  };
  const v2 = c.upgradeV1(v1);
  assert.deepEqual(issues(v2), []);
  assert.equal(v2.kind, "sustainability");
  assert.equal(v2.format, "a4");
  assert.equal(v2.purpose, "report");
  assert.deepEqual(v2.design, { templateId: "classic", templateVersion: 3, theme: { look: "night" } });
  assert.deepEqual(v2.pages[0].elements[0].props.binding, { source: "kpi", kpis: ["ENERGY_TOTAL"], years: { last: 2 }, sites: "all", unit: "GJ" });
  const chips = v2.pages[0].elements[1].props.doc.content[0].content.filter((n) => n.type === "data");
  assert.deepEqual(chips[0].attrs, { binding: { source: "kpi", kpis: ["ENERGY_TOTAL"], years: { last: 1 }, sites: [1, 2], unit: "GJ" }, measure: "value", format: "int", year: "current" });
  assert.deepEqual(chips[1].attrs, { binding: { source: "kpi", kpis: ["ENERGY_TOTAL"], years: [2024], sites: [1] }, measure: "value", year: 2024 });
  assert.deepEqual(v2.pages[1].content.content[0].content[0].attrs.year, "prior");
  assert.equal(c.upgradeV1(v2), v2, "a v2 doc comes back unchanged");
  assert.throws(() => c.upgradeV1({ schemaVersion: 7 }), /Unknown schemaVersion/);
  assert.equal(v1.pages[0].elements[0].props.binding.source, undefined, "the input is not mutated");
});

test("ci/studio-contracts.json (the FE mirror's reference) is current", () => {
  const r = spawnSync(process.execPath, [path.resolve("scripts/studio-contracts-snapshot.cjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});
