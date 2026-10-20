// DS-10 resize (pure, on the build): the engine file hashes to RESIZE_HASH (the FE mirror checks the
// same value); the purpose × format table; the mapping for every seed template × every Resize target
// (valid docs of the target format, bindings unchanged, every bound element moved or listed as dropped,
// the copy linked to its source); the deck's slide plan, chapters and picked pages; flow sections → one
// "See the full report" slide; text cut to its slot (chips whole, marks kept) and AI summaries accepted
// only without new numbers; TEXT_TRUNCATED is an info check; and the golden: Inventory → Board deck
// renders 8–10 slides with the source's numbers (ci/golden/ds/resize/inventory-deck.json).
//
//   npm run build && node --test ci/unit/ds-10-resize.test.cjs
//   UPDATE_SNAPSHOT=1 node --test ci/unit/ds-10-resize.test.cjs    # after an intended mapping change
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const D = (p) => require(path.join(ROOT, "dist", p));
const E = D("studio/resize/engine.js");
const { RESIZE_HASH } = D("studio/resize/hash.js");
const { acceptSummary } = D("studio/resize/service.js");
const C = D("studio/contracts/index.js");
const R = D("reporting/studio/render/index.js");
const S = D("studio/sources/doc.js");
const { readLibrarySeeds } = D("studio/library/seed.js");
const { instantiateTemplate } = D("studio/library/compose.js");

const seeds = readLibrarySeeds(path.join(ROOT, "data/studio"));
const SIZES = C.PAGE_FORMAT_SIZES;
const LINK = { docId: 41, rev: 7, dataHash: "sha256:source" };
const GOLDEN = path.join(ROOT, "ci/golden/ds/resize/inventory-deck.json");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const clone = (v) => JSON.parse(JSON.stringify(v));

const templateDoc = (slug) => {
  const t = seeds.templates.find((x) => x.slug === slug);
  assert.ok(t, slug);
  return instantiateTemplate(t.doc, { company: "Seed Company Ltd", year: 2025, yearType: "CY" });
};
const resize = (doc, target, extra = {}) => {
  const t = typeof target === "string" ? E.RESIZE_TARGETS.find((x) => x.id === target) : target;
  return E.resizeDocument(doc, { purpose: t.purpose, format: t.format, sizes: SIZES, link: LINK, ...extra });
};
const bound = (e) => E.isBound(e);
const bindingsOf = (doc) => [...S.docBindings(doc), ...S.collectTokens(doc).map((t) => t.attrs.binding)].map((b) => JSON.stringify(b));
const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const chip = (metric = "total") => ({ type: "data", attrs: { binding: { source: "ghg", metric, years: { last: 1 }, sites: "all" }, measure: "value" } });

test("the engine file hashes to RESIZE_HASH (the FE mirror src/lib/studio/resize.ts must match)", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/studio/resize/engine.ts"), "utf8");
  assert.equal(sha(src), RESIZE_HASH, "engine.ts changed: update src/studio/resize/hash.ts and run sync:studio-resize in the FE");
});

test("purpose × format: decks 16:9 or A4 landscape, summaries A4/Letter/A5, social square or 1.91:1, booklets A5/A4/Letter", () => {
  assert.equal(E.resizeTargetFor("deck", "slide_16_9"), "deck");
  assert.equal(E.resizeTargetFor("deck", "a4_landscape"), "deck");
  assert.equal(E.resizeTargetFor("summary", "a4"), "summary");
  assert.equal(E.resizeTargetFor("social", "square"), "social");
  assert.equal(E.resizeTargetFor("social", "social_191"), "social");
  assert.equal(E.resizeTargetFor("report", "a5"), "booklet");
  assert.equal(E.resizeTargetFor("deck", "a4"), null);
  assert.equal(E.resizeTargetFor("social", "slide_16_9"), null);
  assert.deepEqual(
    E.RESIZE_TARGETS.map((t) => [t.id, t.purpose, t.format]),
    [
      ["deck", "deck", "slide_16_9"],
      ["summary", "summary", "a4"],
      ["social_square", "social", "square"],
      ["social_wide", "social", "social_191"],
      ["booklet", "report", "a5"],
    ],
  );
  for (const t of E.RESIZE_TARGETS) assert.ok(C.PAGE_FORMATS.includes(t.format) && C.DOC_PURPOSES.includes(t.purpose), t.id);
  const r = resize(templateDoc("ghg-inventory-classic"), { purpose: "deck", format: "a4" });
  assert.deepEqual([r.ok, r.error], [false, "FORMAT_INVALID"]);
});

test("every seed template × every target: a valid linked doc of the target format; bindings unchanged; each bound element moved or listed", () => {
  const families = seeds.templates.filter((t) => !/-(light|night)$/.test(t.slug) || t.kind === "sustainability");
  assert.ok(families.length >= 7);
  for (const t of families) {
    const source = instantiateTemplate(t.doc, { company: "Seed Company Ltd", year: 2025, yearType: "FY", sites: [1, 2] });
    const srcBindings = new Set(bindingsOf(source));
    for (const target of E.RESIZE_TARGETS) {
      const label = `${t.slug} → ${target.id}`;
      const r = resize(source, target);
      if (target.profile === "booklet" && source.format !== "a4") {
        // A booklet keeps the page shape: a 16:9 deck can't become an A5 booklet.
        if (source.format === "slide_16_9") {
          assert.deepEqual([r.ok, r.error], [false, "UNSUPPORTED"], label);
          continue;
        }
      }
      assert.ok(r.ok, `${label}: ${r.detail}`);
      const v = C.ReportDocSchema.safeParse(r.doc);
      assert.ok(v.success, `${label}: ${JSON.stringify(v.error?.issues?.slice(0, 3))}`);
      assert.equal(r.doc.format, target.format, label);
      assert.equal(r.doc.purpose, target.purpose, label);
      assert.equal(r.doc.kind, source.kind, label);
      assert.deepEqual(r.doc.source, LINK, label);
      assert.deepEqual(r.doc.design, source.design, `${label}: the brand and look stay`);
      assert.deepEqual(r.doc.meta.sites, [1, 2], label);
      for (const b of bindingsOf(r.doc)) assert.ok(srcBindings.has(b), `${label}: a binding the source doesn't have: ${b}`);
      // Conservation: bound elements of the pages used = moved + dropped.
      const used = new Set(r.report.pages.flatMap((p) => p.from));
      const sourceBound = source.pages.filter((p) => used.has(p.id) && p.kind === "freeform").flatMap((p) => p.elements.filter((e) => !e.hidden && bound(e)));
      const copyBound = r.doc.pages.filter((p) => p.kind === "freeform").flatMap((p) => p.elements.filter(bound));
      if (target.profile !== "booklet") assert.equal(copyBound.length + r.report.dropped.length, sourceBound.length, `${label}: moved + dropped = bound`);
      for (const d of r.report.dropped) assert.ok(d.label && d.elementId && d.pageId, label);
      if (target.profile === "summary" || target.profile === "social") assert.equal(r.doc.pages.length, 1, label);
      if (target.profile === "booklet") assert.equal(r.doc.pages.length, source.pages.length, label);
      if (target.profile === "social") assert.ok(copyBound.length >= 1, `${label}: the card shows a number`);
    }
  }
});

test("Inventory → Board deck: 10 slides, title first and close last, by layout role", () => {
  const source = templateDoc("ghg-inventory-classic");
  const r = resize(source, "deck");
  assert.ok(r.ok);
  assert.deepEqual(
    r.report.pages.map((p) => `${p.layout}<${p.from.join(",")}`),
    [
      "title<p01-cover",
      "highlights<p04-exec_summary",
      "chart<p08-scope1",
      "chart<p09-scope2",
      "chart<p10-scope3",
      "chart<p12-sites",
      "chart<p15-trend",
      "text<p17-initiatives",
      `full_report<${["p11-scope3_categories", "p20-ghg_factor_table", "p21-ghgp_index", "p22-glossary"].join(",")}`,
      "close<p23-back_cover",
    ],
  );
  const hl = r.doc.pages[1];
  const metrics = hl.elements.filter((e) => e.id.includes(".hero")).map((e) => e.props.binding.metric);
  assert.deepEqual(metrics, ["total", "scope1", "scope2_location", "scope3"], "exec summary → the four headline figures");
  assert.ok(hl.elements.every((e) => e.type !== "big_number"), "narrow highlight slots take KPI tile cards");
  assert.equal(r.doc.pages[0].elements.find((e) => e.id.endsWith(".hero1")).type, "big_number", "the title slide keeps the big number");
  // Dropped and listed: the exec summary's bridge chart and market-based tile, the cover's conformance fact.
  const dropped = r.report.dropped.map((d) => `${d.pageId}/${d.elementId}`);
  for (const id of ["p01-cover/p01-cover.conformance", "p04-exec_summary/p04-exec_summary.waterfall", "p04-exec_summary/p04-exec_summary.market", "p10-scope3/p10-scope3.table"]) assert.ok(dropped.includes(id), id);
  // Pages left out by default are named on the "See the full report" slide.
  const full = r.doc.pages.find((p) => p.id.endsWith("full_report"));
  const text = E.plainText(full.elements.find((e) => e.id.endsWith(".body")).props.doc);
  assert.match(text, /Methodology/);
  assert.match(text, /Scope 3 categories/);
  assert.match(text, /and more\.$/, "a long list ends with 'and more'");
  assert.ok(r.report.omitted.some((o) => o.pageId === "p07-methodology" && o.reason === "not_selected"));
  // Element ids are new and unique; slide ids say their layout.
  assert.ok(r.doc.pages.every((p, i) => p.id.startsWith(`r${String(i + 1).padStart(2, "0")}-`)));
});

test("chapters: GHG Summary … Annexes with page ids; picking pages maps them by role and drops the full-report slide", () => {
  const source = templateDoc("ghg-inventory-classic");
  const ch = E.resizeChapters(source, SIZES);
  assert.deepEqual(
    ch.map((c) => [c.id, c.defaultOn]),
    [
      ["summary", true],
      ["scope12", true],
      ["scope3", true],
      ["trend", true],
      ["methodology", false],
      ["annexes", false],
    ],
  );
  assert.ok(ch.find((c) => c.id === "scope3").pageIds.includes("p11-scope3_categories"));
  assert.ok(!ch.some((c) => c.pageIds.includes("p23-back_cover")), "the back cover is always in, not a choice");
  const pick = [...ch.find((c) => c.id === "summary").pageIds, ...ch.find((c) => c.id === "methodology").pageIds.filter((id) => id !== "p20-ghg_factor_table")];
  const r = resize(source, "deck", { pageIds: pick });
  assert.ok(r.ok);
  const layouts = r.report.pages.map((p) => `${p.layout}<${p.from[0] ?? ""}`);
  assert.ok(layouts.includes("chart<p07-methodology"), "a picked methodology page → a chart slide");
  assert.ok(layouts.includes("text<p02-compliance"), "a picked compliance page → a text slide");
  assert.ok(!layouts.some((l) => l.startsWith("full_report")), "no flow picked: no full-report slide");
  assert.equal(layouts[layouts.length - 1], "close<p23-back_cover");
  const withFlow = resize(source, "deck", { pageIds: ["p10-scope3", "p11-scope3_categories"] });
  assert.deepEqual(
    withFlow.report.pages.map((p) => `${p.layout}<${p.from.join(",")}`),
    ["title<", "chart<p10-scope3", "full_report<p11-scope3_categories", "close<p23-back_cover"],
    "a picked flow section → the full-report slide; no cover picked → a title slide from the doc",
  );
  const bad = resize(source, "deck", { pageIds: ["nope"] });
  assert.deepEqual([bad.ok, bad.error, bad.detail], [false, "PAGES_UNKNOWN", "nope"]);
  // Sustainability chapters
  const sus = E.resizeChapters(templateDoc("sustainability-editorial"), SIZES).map((c) => c.id);
  assert.deepEqual(sus, ["summary", "environment", "social", "governance", "annexes"]);
});

test("summary and social collect from highlights first; flow-only docs can't become a card; hidden pages stay out", () => {
  const source = templateDoc("ghg-inventory-classic");
  const sum = resize(source, "summary");
  const one = sum.doc.pages[0];
  assert.deepEqual(
    one.elements.filter((e) => /\.hero\d$/.test(e.id)).map((e) => e.props.binding.metric),
    ["total", "scope1", "scope2_location", "scope3"],
  );
  assert.equal(one.elements.filter((e) => e.type === "chart").length, 3);
  assert.equal(E.plainText(one.elements.find((e) => e.id.endsWith(".title")).props.doc), "Seed Company Ltd GHG inventory 2025", "the summary is titled after the report");
  const card = resize(source, "social_square").doc.pages[0];
  assert.equal(card.elements.find((e) => e.id.endsWith(".hero1")).props.binding.metric, "total");
  assert.equal(card.elements.find((e) => e.id.endsWith(".hero1")).type, "big_number");
  const flowOnly = { ...clone(source), pages: source.pages.filter((p) => p.kind === "flow") };
  const r = resize(flowOnly, "social_wide");
  assert.deepEqual([r.ok, r.error], [false, "UNSUPPORTED"]);
  const deckOfFlows = resize(flowOnly, "deck");
  assert.ok(deckOfFlows.ok);
  assert.deepEqual(deckOfFlows.report.pages.map((p) => p.layout), ["title", "full_report"]);
  const hidden = clone(source);
  hidden.pages.find((p) => p.id === "p04-exec_summary").hidden = true;
  const h = resize(hidden, "deck");
  assert.ok(!h.report.pages.some((p) => p.from.includes("p04-exec_summary")));
  assert.ok(h.report.omitted.some((o) => o.pageId === "p04-exec_summary" && o.reason === "hidden"));
});

test("a booklet scales every page (lines and crops too) and keeps flow sections", () => {
  const source = templateDoc("ghg-inventory-classic");
  const r = resize(source, "booklet");
  assert.ok(r.ok);
  const k = 148 / 210;
  const a = source.pages.find((p) => p.id === "p08-scope1").elements[2];
  const b = r.doc.pages.find((p) => p.id === "p08-scope1").elements[2];
  assert.equal(b.id, a.id, "a booklet keeps ids");
  assert.ok(Math.abs(b.frame.w - a.frame.w * k) < 0.01 && Math.abs(b.frame.y - a.frame.y * (210 / 297)) < 0.01);
  assert.equal(r.doc.pages.filter((p) => p.kind === "flow").length, source.pages.filter((p) => p.kind === "flow").length);
  const withLine = clone(source);
  withLine.pages[0].elements.push({ id: "ln", type: "line", frame: { x: 10, y: 10, w: 100, h: 10, rotation: 0 }, z: 99, source: "user", props: { x1: 0, y1: 0, x2: 100, y2: 10, strokeWidth: 1, dash: "solid" } });
  const lr = resize(withLine, "booklet");
  assert.equal(lr.doc.pages[0].elements.find((e) => e.id === "ln").props.x2, Math.round(100 * k * 100) / 100);
});

test("text: cut at a word with an ellipsis, chips whole, marks kept, lists flattened; long slot text is listed", () => {
  const long = { type: "doc", content: [para("Total emissions fell sharply this year because the main plant switched to renewable electricity and the fleet moved to electric vans."), para("Second paragraph.")] };
  const cut = E.truncateTextDoc(long, 60);
  assert.equal(cut.truncated, true);
  const t = E.plainText(cut.doc);
  assert.ok(t.endsWith("…") && t.length <= 60, t);
  assert.ok(!/\s…$/.test(t) && !/[a-z]…$/.test(t.replace(/(\w+)…$/, "")), t);
  assert.equal(E.truncateTextDoc(long, 10000).doc, long, "text that fits is unchanged (same object)");
  const withChip = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Total was ", marks: [{ type: "bold" }] }, chip(), { type: "text", text: " tCO₂e, which is a very long explanation of the year" }] }] };
  const c2 = E.truncateTextDoc(withChip, 25);
  const nodes = c2.doc.content[0].content;
  assert.equal(nodes[0].marks[0].type, "bold", "marks stay");
  assert.equal(nodes[1].type, "data", "the chip stays whole");
  assert.ok(E.plainText(c2.doc).endsWith("…"));
  const c3 = E.truncateTextDoc(withChip, 12);
  assert.ok(!c3.doc.content[0].content.some((n) => n.type === "data"), "a chip that doesn't fit goes whole");
  const list = { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [para("First point that is long enough")] }, { type: "listItem", content: [para("Second point")] }] }] };
  const c4 = E.truncateTextDoc(list, 40);
  assert.equal(c4.doc.content[0].type, "paragraph");
  assert.match(E.plainText(c4.doc), /^• First point/);
  assert.ok(C.TextDocSchema.safeParse(c4.doc).success && C.TextDocSchema.safeParse(c2.doc).success && C.TextDocSchema.safeParse(cut.doc).success);
  // In a resize: the exec summary's body text is longer than the highlights slot.
  const source = templateDoc("ghg-inventory-classic");
  const ex = source.pages.find((p) => p.id === "p04-exec_summary").elements.find((e) => e.id.endsWith(".summary"));
  ex.props.doc = { type: "doc", content: [para("x ".repeat(200).trim())] };
  const r = resize(source, "deck");
  const tr = r.report.truncated.find((x) => x.fromElementId === ex.id);
  assert.ok(tr, "the cut text is listed");
  assert.equal(tr.maxChars, 220);
  assert.equal(tr.chars, 399);
  const moved = r.doc.pages[1].elements.find((e) => e.id === tr.elementId);
  assert.ok(E.textLength(moved.props.doc) <= 220);
  assert.deepEqual(tr.original, ex.props.doc, "the full text is kept for an AI summary");
});

test("AI summaries are used only as TipTap text whose chips come from the original and with no new digits", () => {
  const original = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Emissions were " }, chip(), { type: "text", text: " in 2025 after a long year of work on every site." }] }] };
  const ok = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Emissions: " }, chip(), { type: "text", text: "." }] }] };
  assert.deepEqual(acceptSummary(original, ok, 200), ok);
  assert.equal(acceptSummary(original, { type: "doc", content: [{ type: "paragraph", content: [chip("scope3")] }] }, 200), null, "a chip the original didn't have");
  assert.equal(acceptSummary(original, { type: "doc", content: [para("Emissions were 95,710 tCO2e in 2025.")] }, 200), null, "typed numbers");
  assert.equal(acceptSummary(original, "<b>html</b>", 200), null);
  assert.equal(acceptSummary(original, { type: "doc", content: [{ type: "script" }] }, 200), null);
  const long = { type: "doc", content: [para("word ".repeat(80).trim())] };
  assert.ok(E.textLength(acceptSummary(original, long, 50)) <= 50, "a long summary is cut too");
});

test("TEXT_TRUNCATED is an info check for both kinds", () => {
  assert.deepEqual(C.CHECK_RULES.TEXT_TRUNCATED, { severity: "info", kinds: ["ghg", "sustainability"] });
  assert.ok(C.checksFor("ghg").includes("TEXT_TRUNCATED") && C.checksFor("sustainability").includes("TEXT_TRUNCATED"));
});

test("golden: Inventory → Board deck renders 8–10 slides with the source's numbers", () => {
  const source = templateDoc("ghg-inventory-classic");
  const r = resize(source, "deck");
  // Made-up figures, one per binding (deterministic), in the shape POST /resolve answers.
  const figure = (b) => {
    const n = parseInt(sha(JSON.stringify(b)).slice(0, 6), 16) % 90000 + 1000;
    return { source: b.source, value: n, display: n.toLocaleString("en-US"), unit: "tCO₂e" };
  };
  const data = (doc) => {
    const bs = S.docBindings(doc);
    const ts = S.collectTokens(doc);
    return R.renderData(bs, ts, { values: bs.map(figure), tokens: ts.map((t) => figure(t.attrs.binding)), unavailable: [] });
  };
  const deck = R.renderDocument(r.doc, data(r.doc), { mode: "paged" });
  const report = R.renderDocument(source, data(source), { mode: "paged" });
  assert.ok(deck.pageIds.length >= 8 && deck.pageIds.length <= 10, `${deck.pageIds.length} slides`);
  // Every headline figure on a slide is printed, and the same binding prints the same figure in the report.
  const shown = [];
  for (const p of r.doc.pages) {
    for (const e of p.elements) {
      if (!["big_number", "kpi_tile"].includes(e.type) || e.props.binding.source !== "ghg") continue;
      const f = figure(e.props.binding).display;
      assert.ok(deck.html.includes(f), `${e.id} shows ${f}`);
      assert.ok(report.html.includes(f), `${e.id}: the report shows ${f} too`);
      shown.push({ slide: p.id, element: e.id, type: e.type, metric: e.props.binding.metric, figure: f });
    }
  }
  assert.ok(shown.length >= 8);
  const actual = { slides: r.doc.pages.map((p) => ({ id: p.id, elements: p.elements.map((e) => `${e.id.split(".")[1]}:${e.type}`) })), figures: shown, dropped: r.report.dropped.map((d) => d.elementId) };
  if (process.env.UPDATE_SNAPSHOT === "1" || !fs.existsSync(GOLDEN)) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify(actual, null, 1) + "\n");
  }
  assert.deepEqual(actual, JSON.parse(fs.readFileSync(GOLDEN, "utf8")), "the Inventory deck changed: if intended, UPDATE_SNAPSHOT=1");
});
