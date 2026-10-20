// DS-7 text and flow (pure): the footnote mark in the contract, footnote
// numbering (per page in reading order, per flow section), the superscripts
// and the notes the renderer prints, and that a page without footnotes renders
// exactly as before (no new CSS, no new markup).
//   npm run build && node --test ci/unit/ds-7-text.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const R = require(path.resolve("dist/reporting/studio/render/index.js"));
const C = require(path.resolve("dist/studio/contracts/index.js"));
const F = require(path.resolve("ci/golden/ds/render/fixture.cjs"));

const fixture = JSON.parse(fs.readFileSync(path.resolve("ci/fixtures/studio/ghg-doc.json"), "utf8"));
const fn = (note) => ({ type: "footnote", attrs: { note } });
const t = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const para = (...content) => ({ type: "paragraph", content });
const tdoc = (...blocks) => ({ type: "doc", content: blocks });
const chip = { type: "data", attrs: { binding: { source: "ghg", metric: "scope1", years: { last: 1 }, sites: "all" }, measure: "value" } };
const textEl = (id, x, y, doc, extra = {}) => ({ id, type: "text", frame: { x, y, w: 80, h: 20, rotation: 0 }, z: 1, props: { style: "body", align: "left", doc }, ...extra });
const page = (elements) => ({ id: "p1", kind: "freeform", name: "Methodology", background: {}, elements });
const docWith = (pages) => ({ kind: "ghg", format: "a4", meta: { title: "T", year: 2025, yearType: "FY" }, design: { theme: {} }, pages, assets: [] });

test("contract: a footnote mark needs a note of 1–500 characters; marks stay limited to the allowed set", () => {
  assert.ok(C.TEXT_MARK_TYPES.includes("footnote"));
  const ok = (marks) => C.TextDocSchema.safeParse(tdoc(para(t("Grid factor", marks)))).success;
  assert.ok(ok([fn("CEA CO2 database v20, 2024")]));
  assert.ok(ok([{ type: "bold" }, { type: "italic" }, { type: "highlight" }, { type: "link", attrs: { href: "https://x.example" } }, fn("n")]), "all five marks at once");
  assert.ok(!ok([fn("")]), "empty note");
  assert.ok(!ok([fn("   ")]), "blank note");
  assert.ok(!ok([fn("x".repeat(501))]), "too long");
  assert.ok(!ok([{ type: "footnote" }]), "no attrs");
  assert.ok(!ok([{ type: "footnote", attrs: { note: "a", html: "<b>" } }]), "unknown attr");
  assert.ok(!ok([{ type: "underline" }]), "marks outside the contract are still refused");
});

test("contract: the GHG fixture with footnotes on a page validates as a whole doc", () => {
  const doc = JSON.parse(JSON.stringify(fixture));
  const pg = doc.pages.find((p) => p.kind === "freeform" && p.elements.some((e) => e.type === "text"));
  const el = pg.elements.find((e) => e.type === "text");
  el.props.doc = tdoc(para(t("Emission factors"), t(" (2024)", [fn("DEFRA 2024 conversion factors")])));
  const r = C.ReportDocSchema.safeParse(doc);
  assert.ok(r.success, JSON.stringify(r.error?.issues?.slice(0, 3)));
});

test("runs: one number per run; a chip inside a run doesn't split it; another note or plain text does", () => {
  const d = tdoc(
    para(t("Scope 1 was ", [fn("A")]), chip, t(" tCO₂e", [fn("A")]), t(" and "), t("Scope 2", [fn("A")])),
    { type: "heading", attrs: { level: 2 }, content: [t("Method", [fn("B")]), t(" notes", [{ type: "bold" }, fn("B")]), t("!", [fn("C")])] },
  );
  assert.deepEqual(R.footnoteNotes(d), ["A", "A", "B", "C"]);
  const p = page([textEl("x", 15, 30, d)]);
  const html = R.renderSheet(p, docWith([p]), null, { mode: "sheet" }).html;
  // The superscript follows the last text of each run: after " tCO₂e", "Scope 2", " notes" (inside bold) and "!".
  assert.match(html, /<p>Scope 1 was <span class="ds-chip.*? tCO₂e<sup class="ds-fn-ref" data-fn="1">1<\/sup> and Scope 2<sup class="ds-fn-ref" data-fn="2">2<\/sup><\/p>/);
  assert.match(html, /<h2>Method<strong> notes<\/strong><sup class="ds-fn-ref" data-fn="3">3<\/sup>!<sup class="ds-fn-ref" data-fn="4">4<\/sup><\/h2>/);
});

test("sheet: superscripts follow reading order (top to bottom, then left to right) and the notes print at the page foot", () => {
  const els = [
    textEl("lower", 15, 120, tdoc(para(t("Lower text", [fn("Lower note")])))),
    textEl("upper-right", 110, 30, tdoc(para(t("Right", [fn("Right note")])))),
    textEl("upper-left", 15, 30, tdoc(para(t("Left", [fn("Left note one")]), t(" and "), t("more", [fn("Left note two")])))),
    textEl("hidden", 15, 10, tdoc(para(t("Hidden", [fn("Hidden note")]))), { hidden: true }),
    { id: "callout", type: "callout", frame: { x: 15, y: 200, w: 80, h: 20, rotation: 0 }, z: 2, props: { doc: tdoc(para(t("Callout", [fn("Callout note")]))), tone: "accent" } },
  ];
  const p = page(els);
  const f = R.pageFootnotes(p);
  assert.deepEqual(f.bases, { "upper-left": 1, "upper-right": 3, lower: 4, callout: 5 });
  assert.deepEqual(f.notes, ["Left note one", "Left note two", "Right note", "Lower note", "Callout note"]);

  const html = R.renderSheet(p, docWith([p]), null, { mode: "sheet" }).html;
  const refsOf = (id) => {
    const at = html.indexOf(`data-el-id="${id}"`);
    const end = html.indexOf('data-el-id="', at + 10);
    return [...html.slice(at, end < 0 ? undefined : end).matchAll(/data-fn="(\d+)"/g)].map((m) => Number(m[1]));
  };
  assert.deepEqual(refsOf("upper-left"), [1, 2]);
  assert.deepEqual(refsOf("upper-right"), [3]);
  assert.deepEqual(refsOf("lower"), [4]);
  assert.deepEqual(refsOf("callout"), [5]);
  assert.ok(!html.includes("Hidden note"), "hidden elements have no footnotes");
  const foot = html.slice(html.indexOf('class="ds-footnotes'));
  assert.match(foot, /^class="ds-footnotes ts-footnote" role="note"/);
  assert.deepEqual([...foot.matchAll(/<sup>(\d+)<\/sup> ([^<]+)<\/p>/g)].map((m) => `${m[1]} ${m[2]}`), ["1 Left note one", "2 Left note two", "3 Right note", "4 Lower note", "5 Callout note"]);
  assert.match(foot, /bottom:\d+(\.\d+)?mm/, "anchored at the foot of the safe area");
});

test("sheet: moving an element renumbers its footnotes", () => {
  const a = textEl("a", 15, 30, tdoc(para(t("A", [fn("Note A")]))));
  const b = textEl("b", 15, 90, tdoc(para(t("B", [fn("Note B")]))));
  assert.deepEqual(R.pageFootnotes(page([a, b])).notes, ["Note A", "Note B"]);
  const moved = { ...a, frame: { ...a.frame, y: 150 } };
  assert.deepEqual(R.pageFootnotes(page([moved, b])).notes, ["Note B", "Note A"]);
  assert.deepEqual(R.pageFootnotes(page([moved, b])).bases, { b: 1, a: 2 });
});

test("sheet: note text is escaped", () => {
  const p = page([textEl("x", 15, 30, tdoc(para(t("X", [fn('<script>alert(1)</script> & "q"')]))))]);
  const html = R.renderSheet(p, docWith([p]), null, { mode: "sheet" }).html;
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;"));
});

test("flow: footnotes number per section and print after the section's content", () => {
  const s1 = { id: "f1", kind: "flow", name: "Methodology", flowType: "methodology", options: {}, content: tdoc(para(t("Factors", [fn("DEFRA 2024")]), t(" and "), t("GWP", [fn("IPCC AR6")]))) };
  const s2 = { id: "f2", kind: "flow", name: "Narrative", flowType: "narrative", options: {}, content: tdoc(para(t("Grid", [fn("CEA v20")]))) };
  const doc = docWith([s1, s2]);
  const html = R.renderDocument(doc, null, { mode: "paged" }).html;
  const sec = (id) => html.slice(html.indexOf(`data-page-id="${id}"`), html.indexOf("</section>", html.indexOf(`data-page-id="${id}"`)));
  assert.deepEqual([...sec("f1").matchAll(/data-fn="(\d+)"/g)].map((m) => m[1]), ["1", "2"]);
  assert.deepEqual([...sec("f2").matchAll(/data-fn="(\d+)"/g)].map((m) => m[1]), ["1"], "numbering restarts per section");
  assert.match(sec("f1"), /<aside class="ds-footnotes ts-footnote"[^>]*><p class="ds-fn" style="margin:0;"><sup>1<\/sup> DEFRA 2024<\/p><p class="ds-fn" style="margin:0;"><sup>2<\/sup> IPCC AR6<\/p><\/aside>$/);
  assert.deepEqual(R.sectionFootnotes(s2), ["CEA v20"]);
});

test("no footnotes: the fixture renders without footnote markup and the CSS is unchanged", () => {
  const data = F.fixtureData(R.renderData);
  const a4 = F.fixtureDoc("a4");
  const r = R.renderDocument(a4, data, { mode: "paged", assets: F.assets });
  assert.ok(!r.html.includes("ds-footnotes"));
  assert.ok(!r.html.includes("ds-fn-ref"));
  assert.ok(!r.css.includes("ds-fn"), "footnote styles are inline, so documents without footnotes keep their CSS");
});

test("flow settings: scope3_categories honours categories, show DQ and show method (the settings drawer writes these)", () => {
  const section = { id: "s3", kind: "flow", name: "Scope 3", flowType: "scope3_categories", options: { categories: [1, 4], showDq: false, showMethod: true } };
  const rows = [
    { n: 1, name: "Purchased goods and services", status: "reported", display: "1,200", method: "Spend-based", dq: "3" },
    { n: 4, name: "Upstream transportation and distribution", status: "excluded", reason: "Not relevant" },
    { n: 6, name: "Business travel", status: "reported", display: "40", method: "Distance-based", dq: "2" },
  ];
  const html = R.renderFlow(section, docWith([section]), { values: {}, tokens: {}, scope3: { s3: rows } }, { mode: "sheet" }).html;
  assert.deepEqual([...html.matchAll(/data-category="(\d+)"/g)].map((m) => m[1]), ["1", "4"]);
  assert.ok(html.includes("<th>Method</th>"));
  assert.ok(!html.includes("<th>Data quality</th>"));
  assert.ok(C.FlowOptionsSchema.safeParse(section.options).success);
  assert.ok(!C.FlowOptionsSchema.safeParse({ categories: [16] }).success);
});
