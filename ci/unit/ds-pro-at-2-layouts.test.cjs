// AT-2 pure logic: page composition from library layouts (suggest_layouts) and the
// template swap. Every option keeps every element id with its props (only frame
// and z move), adds only layout decoration, re-validates with ElementSchema and the
// doc schema and brings no new DS-12 layout finding; the model's answer is checked
// (slugs, slots, kinds, literal numbers) before the server builds the pages.
// No network and no DB: the library is read from data/studio, answers are inline.
//   npm run build && node --test ci/unit/ds-pro-at-2-layouts.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const dist = (p) => require(path.resolve("dist", p));
const compose = dist("studio/swap/compose.js");
const layouts = dist("studio/swap/layouts.js");
const { readLibrarySeeds } = dist("studio/library/seed.js");
const { ReportDocSchema, SuggestionSchema, ElementSchema } = dist("studio/contracts/index.js");

const SEEDS = readLibrarySeeds();
const LAYOUTS = SEEDS.layouts.map((l, i) => ({ id: i + 1, companyId: null, kind: l.kind, format: l.format, pageKind: l.page_kind, name: l.name, thumbnailUrl: null, page: l.page, slug: l.slug, family: l.family, role: l.role, sort: l.sort }));
const clone = (v) => JSON.parse(JSON.stringify(v));
const templateDoc = (slug) => clone(SEEDS.templates.find((t) => t.slug === slug).doc);
const pageOf = (doc, role) => doc.pages.find((p) => p.kind === "freeform" && p.layoutId && p.layoutId.endsWith(`/${role}`));
const forDoc = (doc) => LAYOUTS.filter((l) => l.kind === doc.kind && l.format === doc.format);
const decorFromOldLayout = (page, e) => compose.isDecor(e) && e.id.startsWith(`${page.id}.`);
const withoutPos = (e) => JSON.stringify({ ...e, frame: undefined, z: undefined });

test("composition keeps every element id and its props on every candidate layout (only frame and z move)", () => {
  const doc = templateDoc("ghg-inventory-classic");
  for (const role of ["scope1", "exec_summary", "scope3", "sites"]) {
    const page = pageOf(doc, role);
    assert.ok(page, role);
    const ranked = compose.rankLayouts(page, forDoc(doc));
    assert.ok(ranked.length >= 3, `${role}: at least three candidates`);
    for (const { layout } of ranked) {
      const out = compose.composePage(doc, page, layout, compose.autoAssign(page, layout));
      const now = new Map(out.page.elements.map((e) => [e.id, e]));
      for (const e of page.elements) {
        if (decorFromOldLayout(page, e)) continue;
        assert.ok(now.has(e.id), `${role} on ${layout.slug}: ${e.id} kept`);
        assert.equal(withoutPos(now.get(e.id)), withoutPos(e), `${role} on ${layout.slug}: ${e.id} props unchanged`);
        assert.ok(out.placedElementIds.includes(e.id));
      }
      const before = new Set(page.elements.map((e) => e.id));
      for (const e of out.page.elements) {
        if (!before.has(e.id)) assert.ok(compose.isDecor(e), `${layout.slug}: only decoration is new (${e.id} is ${e.type})`);
        assert.ok(ElementSchema.safeParse(e).success, e.id);
      }
      assert.equal(out.page.id, page.id);
      assert.equal(out.page.layoutId, layout.slug);
      assert.deepEqual(compose.layoutOptionIssues(doc, page, out.page), [], `${role} on ${layout.slug}`);
    }
  }
});

test("ranking: the page's own layout and the shown ones are left out; covers only for covers", () => {
  const doc = templateDoc("ghg-inventory-classic");
  const page = pageOf(doc, "scope1");
  const ranked = compose.rankLayouts(page, forDoc(doc)).map((r) => r.layout);
  assert.ok(!ranked.some((l) => l.slug === page.layoutId), "own layout left out");
  assert.ok(!ranked.some((l) => l.pageKind === "cover" || l.pageKind === "back_cover"), "no covers for a data page");
  const shapes = ranked.map(compose.layoutShape);
  assert.equal(new Set(shapes).size, shapes.length, "families sharing a page design are listed once");
  const first = ranked.slice(0, 3).map((l) => l.slug);
  const more = compose.rankLayouts(page, forDoc(doc), { exclude: first }).map((r) => r.layout.slug);
  assert.ok(first.every((s) => !more.includes(s)), "More ideas skips what was shown");
  const cover = pageOf(doc, "cover");
  assert.ok(compose.rankLayouts(cover, forDoc(doc)).every((r) => r.layout.pageKind === "cover" || r.layout.pageKind === "back_cover"));
});

test("locked and template-locked elements never move; decoration ids stay unique in the doc", () => {
  const doc = templateDoc("ghg-inventory-classic");
  const page = pageOf(doc, "scope1");
  const chart = page.elements.find((e) => e.type === "chart");
  chart.locked = true;
  const tl = page.elements.find((e) => e.type === "big_number");
  tl.templateLocked = true;
  for (const { layout } of compose.rankLayouts(page, forDoc(doc)).slice(0, 5)) {
    const out = compose.composePage(doc, page, layout, compose.autoAssign(page, layout));
    assert.deepEqual(out.page.elements.find((e) => e.id === chart.id), chart);
    assert.deepEqual(out.page.elements.find((e) => e.id === tl.id), tl);
    assert.ok(out.unplaced.some((u) => u.elementId === chart.id && u.reason === "locked"));
    const all = [...compose.docElementIds(doc, page.id), ...out.page.elements.map((e) => e.id)];
    assert.equal(new Set(all).size, all.length, "ids unique across the doc");
    assert.ok(ReportDocSchema.safeParse({ ...doc, pages: doc.pages.map((p) => (p.id === page.id ? out.page : p)) }).success);
  }
});

test("option check: a moved prop, a lost element or an invented text box is refused", () => {
  const doc = templateDoc("ghg-inventory-classic");
  const page = pageOf(doc, "scope1");
  const layout = compose.rankLayouts(page, forDoc(doc))[0].layout;
  const ok = compose.composePage(doc, page, layout, compose.autoAssign(page, layout)).page;
  const chartId = page.elements.find((e) => e.type === "chart").id;
  const changed = clone(ok);
  changed.elements.find((e) => e.id === chartId).props.title = "Typed 4,120 t";
  assert.match(compose.layoutOptionIssues(doc, page, changed).join(";"), /changed more than its position/);
  const lost = clone(ok);
  lost.elements = lost.elements.filter((e) => e.id !== chartId);
  assert.match(compose.layoutOptionIssues(doc, page, lost).join(";"), /is missing/);
  const invented = clone(ok);
  invented.elements.push({ ...clone(page.elements.find((e) => e.type === "text")), id: `${page.id}.extra` });
  assert.match(compose.layoutOptionIssues(doc, page, invented).join(";"), /isn't a layout block/);
});

test("model answer: valid pairs build three options; bad slugs, slots, kinds and literal numbers are issues for the retry", () => {
  const doc = templateDoc("ghg-inventory-classic");
  const page = pageOf(doc, "scope1");
  const ranked = compose.rankLayouts(page, forDoc(doc)).map((r) => r.layout);
  const cands = ranked.slice(0, layouts.LAYOUT_CANDIDATES);
  const chart = page.elements.find((e) => e.type === "chart");
  const chartSlot = (l) => compose.layoutSlots(l).find((s) => s.cls === "chart");
  const withChart = cands.filter((l) => chartSlot(l));
  assert.ok(withChart.length >= 2);
  const good = {
    options: withChart.slice(0, 2).map((l, i) => ({ layoutSlug: l.slug, name: i ? "Full-width chart" : "Chart + story", reason: "The chart answers where Scope 1 comes from first.", slots: [{ slot: chartSlot(l).slot, elementId: chart.id }] })),
  };
  const r = layouts.interpretLayouts(JSON.stringify(good), doc, page, cands);
  assert.ok(!("issues" in r), JSON.stringify(r.issues));
  assert.equal(r.options.length, 2);
  assert.deepEqual(r.options[0].page.elements.find((e) => e.id === chart.id).frame, chartSlot(withChart[0]).element.frame, "the model's pair is used");
  const three = layouts.completeOptions(doc, page, r.options, ranked);
  assert.equal(three.length, 3, "the best remaining candidate fills the gap");
  assert.equal(new Set(three.map((o) => o.meta.layoutSlug)).size, 3);
  const s = layouts.toLayoutSuggestion("stub", three);
  assert.ok(SuggestionSchema.safeParse(s).success, JSON.stringify(SuggestionSchema.safeParse(s).error?.issues));
  assert.deepEqual(s.payload.layoutOptions.map((o) => o.id), ["A", "B", "C"]);
  for (const p of s.payload.pages) assert.equal(p.id, page.id);

  const bad = (o) => layouts.interpretLayouts(JSON.stringify({ options: [{ ...good.options[0], ...o }] }), doc, page, cands);
  assert.match(bad({ layoutSlug: "nope/none" }).issues.join(";"), /isn't one of the LAYOUTS/);
  assert.match(bad({ slots: [{ slot: "no_such_slot", elementId: chart.id }] }).issues.join(";"), /has no slot/);
  assert.match(bad({ slots: [{ slot: chartSlot(withChart[0]).slot, elementId: "ghost" }] }).issues.join(";"), /isn't a movable element/);
  const textSlot = compose.layoutSlots(withChart[0]).find((x) => x.cls === "text");
  if (textSlot) assert.match(bad({ slots: [{ slot: textSlot.slot, elementId: chart.id }] }).issues.join(";"), /holds a text/);
  assert.ok(bad({ reason: "Scope 1 is 4,120 tCO2e, so lead with it." }).issues.length > 0, "a typed figure in the reason");
  assert.ok(bad({ name: "Layout with 3,000 t" }).issues.length > 0, "a typed figure in the name");
  assert.ok("issues" in layouts.interpretLayouts("not json", doc, page, cands));
  assert.ok("issues" in layouts.interpretLayouts(JSON.stringify({ options: [] }), doc, page, cands), "zod: at least one option");
});

test("target page: missing, unknown, flow, hidden or empty pages are refused before any model call", () => {
  const doc = templateDoc("ghg-inventory-classic");
  const flow = doc.pages.find((p) => p.kind === "flow");
  const page = pageOf(doc, "scope1");
  assert.throws(() => layouts.layoutTargetPage(doc, undefined), (e) => e.code === "DS_VALIDATION");
  assert.throws(() => layouts.layoutTargetPage(doc, { pageId: "nope" }));
  assert.throws(() => layouts.layoutTargetPage(doc, { pageId: flow.id }));
  const hidden = clone(doc);
  pageOf(hidden, "scope1").hidden = true;
  assert.throws(() => layouts.layoutTargetPage(hidden, { pageId: page.id }));
  assert.equal(layouts.layoutTargetPage(doc, { pageId: page.id }).id, page.id);
  assert.deepEqual(layouts.shownSlugs({ differentFrom: "a/b, c/d,," }), ["a/b", "c/d"]);
  // The prompt shows chips as ⟨figure⟩, never a resolved value.
  const els = layouts.promptElements(doc, page);
  assert.ok(els.length > 0);
  assert.ok(els.every((e) => !/\{\{/.test(e.excerpt)));
});

test("template swap: another look keeps every element, restyles the theme and maps each page by role", () => {
  const doc = templateDoc("ghg-inventory-classic");
  doc.design.theme = { ...doc.design.theme, colors: { primary: "#0F5132" } };
  const target = { slug: "ghg-inventory-night", version: 1, theme: { look: "night" }, layouts: LAYOUTS.filter((l) => l.family === "ghg-inventory") };
  const r = compose.swapTemplate(doc, target);
  assert.ok(ReportDocSchema.safeParse(r.doc).success);
  assert.equal(r.doc.design.templateId, "ghg-inventory-night");
  assert.equal(r.doc.design.theme.look, "night");
  assert.deepEqual(r.doc.design.theme.colors, { primary: "#0F5132" }, "brand colours stay");
  const ids = (d) => d.pages.flatMap((p) => (p.elements || []).filter((e) => !compose.isDecor(e)).map((e) => e.id)).sort();
  assert.deepEqual(ids(r.doc), ids(doc), "every content element kept");
  for (const p of doc.pages) {
    const m = r.pages.find((x) => x.pageId === p.id);
    assert.ok(m, p.id);
    assert.equal(m.status, p.kind === "flow" ? "kept" : "mapped", p.id);
  }
  assert.equal(compose.docHash(r.doc), compose.docHash(compose.swapTemplate(doc, target).doc), "deterministic: the preview hash is stable");
});

test("template swap across families keeps content and data bindings; pages with no matching role are kept", () => {
  const doc = templateDoc("ghg-inventory-classic");
  const target = { slug: "ghg-iso14064-classic", version: 1, theme: { look: "classic" }, layouts: LAYOUTS.filter((l) => l.family === "ghg-iso14064") };
  const r = compose.swapTemplate(doc, target);
  assert.ok(ReportDocSchema.safeParse(r.doc).success);
  const before = new Map(doc.pages.flatMap((p) => p.elements || []).map((e) => [e.id, e]));
  for (const p of r.doc.pages) {
    for (const e of p.elements || []) {
      const old = before.get(e.id);
      if (!old) {
        assert.ok(compose.isDecor(e), `${e.id} is new decoration`);
        continue;
      }
      const strip = (x) => JSON.stringify({ ...x, frame: 0, z: 0, props: { ...x.props, style: 0, align: 0 } });
      assert.equal(strip(e), strip(old), `${e.id}: content and bindings unchanged`);
    }
  }
  const odd = clone(doc);
  odd.pages[0].layoutId = "custom";
  odd.pages[0].id = "custom-page";
  for (const e of odd.pages[0].elements) e.id = e.id.replace(/^[^.]+\./, "custom-page.");
  const k = compose.swapTemplate(odd, target).pages.find((x) => x.pageId === "custom-page");
  assert.equal(k.status, "kept");
  assert.equal(k.toLayoutId, null);
});
