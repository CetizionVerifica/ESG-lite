// DS-4 library (pure, on the build): the committed seeds equal the generator; every template and
// layout validates against ReportDocSchema for its format; the D9 / RS-3 set is complete; every
// element names a licence LICENSES.md lists and every icon element draws a real icon; composing and
// instantiating keep ids, placeholders and bindings right; the asset cleaner refuses unsafe SVG and
// strips EXIF; and the GHG templates render the same HTML in all three looks as the snapshot.
//
//   npm run build && node --test ci/unit/ds-4-library.test.cjs
//   UPDATE_SNAPSHOT=1 node --test ci/unit/ds-4-library.test.cjs    # after an intended template change
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const D = (p) => require(path.join(ROOT, "dist", p));
const { readLibrarySeeds, licenseIds, canon } = D("studio/library/seed.js");
const { composeTemplateDoc, instantiateTemplate, pageFromLayout, periodLabel } = D("studio/library/compose.js");
const { cleanImage, sniff, svgProblem } = D("studio/library/assets.js");
const C = D("studio/contracts/index.js");
const R = D("reporting/studio/render/index.js");
const { ICONS } = D("reporting/studio/render/icons.js");
const { LUCIDE_ICONS } = D("reporting/studio/render/iconsLucide.js");
const { ALL_FAMILIES } = D("studio/library/seeds/index.js");

const seeds = readLibrarySeeds(path.join(ROOT, "data/studio"));
const SNAPSHOT = path.join(ROOT, "ci/golden/ds/templates/snapshots.json");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

test("the committed data/studio files and render/iconsLucide.ts equal the generator", () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "dist/scripts/buildStudioSeeds.js"), "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("D9: four GHG templates in three looks; RS-3: Editorial, Night and Minimal sustainability designs", () => {
  const bySlug = Object.fromEntries(seeds.templates.map((t) => [t.slug, t]));
  for (const family of ["ghg-inventory", "ghg-iso14064", "ghg-board-brief", "ghg-one-page"]) {
    for (const look of ["classic", "light", "night"]) {
      const t = bySlug[`${family}-${look}`];
      assert.ok(t, `${family}-${look}`);
      assert.equal(t.kind, "ghg");
      assert.equal(t.doc.design.theme.look, look);
      assert.equal(t.doc.design.templateId, t.slug);
    }
  }
  assert.equal(bySlug["ghg-board-brief-classic"].format, "slide_16_9");
  assert.equal(bySlug["ghg-board-brief-classic"].purpose, "deck");
  const brief = bySlug["ghg-board-brief-classic"].page_count;
  assert.ok(brief >= 8 && brief <= 10, `board brief has ${brief} slides`);
  assert.equal(bySlug["ghg-one-page-classic"].page_count, 1);
  assert.equal(bySlug["ghg-one-page-classic"].purpose, "summary");
  const inv = bySlug["ghg-inventory-classic"].page_count;
  assert.ok(inv >= 18 && inv <= 25, `inventory has ${inv} pages`);
  assert.ok(bySlug["ghg-iso14064-classic"].page_count > inv, "ISO adds pages to the Inventory");
  for (const [d, look] of [["editorial", "classic"], ["night", "night"], ["minimal", "light"]]) {
    const t = bySlug[`sustainability-${d}`];
    assert.ok(t, d);
    assert.equal(t.kind, "sustainability");
    assert.equal(t.doc.design.theme.look, look);
    const layouts = seeds.layouts.filter((l) => l.family === `sustainability-${d}`);
    assert.ok(layouts.length >= 13, `${d}: ${layouts.length} layouts`);
    assert.deepEqual([...new Set(layouts.map((l) => l.page_kind))].sort(), C.LAYOUT_KINDS.filter((k) => k !== "blank").sort(), `${d} covers every layout kind`);
  }
});

test("every template doc and layout validates against ReportDocSchema for its format; frames stay on the page", () => {
  for (const t of seeds.templates) {
    const r = C.ReportDocSchema.safeParse(t.doc);
    assert.ok(r.success, `${t.slug}: ${r.success ? "" : JSON.stringify(r.error.issues.slice(0, 3))}`);
    assert.equal(t.doc.format, t.format);
    for (const p of t.doc.pages) {
      if (p.kind !== "freeform") continue;
      assert.match(p.layoutId, new RegExp(`^${t.family}/`), `${t.slug} ${p.id} names its layout`);
      for (const e of p.elements) {
        assert.ok(e.id.startsWith(`${p.id}.`), `${e.id} on ${p.id}`);
        assert.equal(e.source, "layout");
      }
    }
  }
  assert.ok(seeds.layouts.length >= 90, `${seeds.layouts.length} layouts`);
});

test("numbers come only from bindings: GHG templates bind ghg/input, sustainability templates kpi; market-based Scope 2 is bound (D7)", () => {
  const sources = (doc) => C.collectBindings(doc).map((b) => b.source);
  for (const t of seeds.templates) {
    const s = new Set(sources(t.doc));
    if (t.kind === "ghg") {
      assert.ok(!s.has("kpi") && !s.has("custom"), `${t.slug}: ${[...s]}`);
      assert.ok(s.has("ghg"), t.slug);
    } else {
      assert.ok(!s.has("ghg") && !s.has("custom"), `${t.slug}: ${[...s]}`);
      assert.ok(s.has("kpi"), t.slug);
    }
  }
  const inv = seeds.templates.find((t) => t.slug === "ghg-inventory-classic").doc;
  const metrics = new Set(C.collectBindings(inv).filter((b) => b.source === "ghg").map((b) => b.metric));
  for (const m of ["total", "scope1", "scope2_location", "scope2_market", "scope3", "biogenic_co2", "intensity_revenue", "base_year_total", "dq_score", "primary_data_pct"]) assert.ok(metrics.has(m), m);
  const inputs = new Set(C.collectBindings(inv).filter((b) => b.source === "input").map((b) => b.key));
  for (const k of ["consolidation_approach", "reporting_period", "base_year", "recalculation_policy", "exclusions", "verification", "uncertainty_statement", "gwp_set"]) assert.ok(inputs.has(k), k);
  const flows = inv.pages.filter((p) => p.kind === "flow").map((p) => p.flowType);
  for (const f of ["ghgp_index", "ghg_factor_table", "scope3_categories", "toc"]) assert.ok(flows.includes(f), f);
});

test("licences: every element names an id LICENSES.md lists; every icon element draws a real icon", () => {
  const ids = licenseIds(fs.readFileSync(path.join(ROOT, "data/studio/LICENSES.md"), "utf8"));
  assert.deepEqual(ids.sort(), ["lucide-isc", "ofl", "own", "sdg-colours"]);
  for (const g of C.ELEMENT_GROUPS) {
    const file = path.join(ROOT, `data/studio/elements/${g}.json`);
    assert.ok(fs.existsSync(file), g);
    for (const e of JSON.parse(fs.readFileSync(file, "utf8"))) {
      assert.ok(e.license, `${e.slug} has no licence`);
      assert.ok(ids.includes(e.license), `${e.slug}: licence ${e.license} isn't in LICENSES.md`);
    }
  }
  const icons = seeds.elements.filter((e) => e.group === "icons");
  assert.ok(icons.length >= 280, `${icons.length} icons`);
  const lucide = icons.filter((e) => e.payload.props.name.startsWith("lucide:"));
  assert.ok(lucide.length >= 250 && lucide.every((e) => e.license === "lucide-isc"));
  for (const e of icons) {
    const name = e.payload.props.name;
    const known = name.startsWith("lucide:") ? LUCIDE_ICONS[name.slice(7)] : ICONS[name];
    assert.ok(known, `${name} draws the fallback dot`);
    assert.ok(R.ICON_NAMES.includes(name), name);
  }
  for (const tag of ["esg", "energy", "transport", "industry"]) assert.ok(icons.some((e) => e.tags.includes(tag)), `icons tagged ${tag}`);
  assert.equal(seeds.elements.filter((e) => e.group === "sdg").length, 17);
  assert.equal(seeds.elements.filter((e) => e.group === "frames").length, 5);
  assert.deepEqual(seeds.elements.filter((e) => e.group === "grids").map((e) => e.payload.props.cells.length), [2, 3, 4, 6]);
});

test("the Elements library covers every element type except image (Uploads) and has the ESG graphics as groups", () => {
  const types = new Set();
  for (const e of seeds.elements) for (const p of e.payload.type === "group" ? e.payload.elements : [e.payload]) types.add(p.type);
  for (const t of C.ELEMENT_TYPES.filter((t) => t !== "image")) assert.ok(types.has(t), t);
  const esg = seeds.elements.filter((e) => e.group === "esg");
  assert.ok(esg.length >= 4 && esg.every((e) => e.payload.type === "group" && e.payload.elements.length > 3));
  for (const slug of ["esg-scope-diagram", "esg-pillars", "esg-value-chain-strip", "esg-scope3-wheel"]) assert.ok(esg.some((e) => e.slug === slug), slug);
  for (const e of esg) for (const c of e.payload.elements) assert.ok(c.frame.x >= 0 && c.frame.y >= 0 && c.frame.x + c.frame.w <= e.payload.w + 0.01 && c.frame.y + c.frame.h <= e.payload.h + 0.01, `${e.slug} ${c.id} inside its group box`);
});

test("compose: page and element ids, layoutId and text overrides; a missing layout fails", () => {
  const fam = ALL_FAMILIES().find((f) => f.template.family === "sustainability-minimal");
  const doc = composeTemplateDoc(fam.template, fam.layouts, "light");
  const chapters = doc.pages.filter((p) => p.layoutId === "sustainability-minimal/chapter");
  assert.equal(chapters.length, 3);
  const titles = chapters.map((p) => p.elements.find((e) => e.id === `${p.id}.title`).props.doc.content[0].content[0].text);
  assert.deepEqual(titles, ["Environment", "Social", "Governance"]);
  assert.equal(new Set(doc.pages.map((p) => p.id)).size, doc.pages.length);
  const page = pageFromLayout(fam.layouts[0], "sustainability-minimal", "new-page");
  assert.equal(page.id, "new-page");
  assert.ok(page.elements.every((e) => e.id.startsWith("new-page.")));
  assert.throws(() => composeTemplateDoc({ ...fam.template, pages: [{ layout: "nope" }] }, fam.layouts, "light"), /nope/);
});

test("instantiate: placeholders filled, meta set, 'all' bindings narrowed to the doc's sites; the template is unchanged", () => {
  const t = seeds.templates.find((x) => x.slug === "ghg-inventory-classic");
  const before = canon(t.doc);
  const doc = instantiateTemplate(t.doc, { company: "Northwind Metals", year: 2026, yearType: "FY", sites: [3, 4], frameworks: ["GHGP", "BRSR_P6"], compareYear: 2025 });
  assert.equal(canon(t.doc), before);
  assert.equal(doc.meta.title, "Northwind Metals GHG inventory FY 2026");
  assert.deepEqual([doc.meta.year, doc.meta.yearType, doc.meta.sites, doc.meta.compareYear], [2026, "FY", [3, 4], 2025]);
  assert.ok(!JSON.stringify(doc).includes("{{"), "no placeholder left");
  assert.ok(C.collectBindings(doc).filter((b) => b.source === "ghg").every((b) => JSON.stringify(b.sites) === "[3,4]"));
  assert.ok(C.ReportDocSchema.safeParse(doc).success);
  assert.equal(periodLabel("CY", 2025), "2025");
  const all = instantiateTemplate(t.doc, { company: "X", year: 2025, yearType: "CY" });
  assert.ok(C.collectBindings(all).filter((b) => b.source === "ghg").every((b) => b.sites === "all"));
});

test("assets: the bytes decide the type; unsafe SVG refused; JPEG re-encoded without EXIF", async () => {
  const sharp = require("sharp");
  assert.equal(sniff(Buffer.from("<?xml version='1.0'?>\n<svg xmlns='http://www.w3.org/2000/svg'/>")), "image/svg+xml");
  assert.equal(sniff(Buffer.from("GIF89a....")), null);
  assert.equal(sniff(Buffer.from("<html><svg/></html>")), null);
  const safe = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="40" height="20"/><use href="#g"/></svg>`;
  assert.equal(svgProblem(safe), null);
  for (const [bad, what] of [
    [`<svg><script>alert(1)</script></svg>`, "script"],
    [`<svg onload="alert(1)"></svg>`, "event attribute"],
    [`<svg><image href="https://evil.example/x.png"/></svg>`, "external reference"],
    [`<svg><a xlink:href="javascript:alert(1)">x</a></svg>`, "javascript url"],
    [`<svg><foreignObject><div/></foreignObject></svg>`, "foreignObject"],
    [`<svg><style>@import url(https://x)</style></svg>`, "stylesheet import"],
    [`<!DOCTYPE svg [<!ENTITY x "y">]><svg/>`, "entity"],
  ]) assert.equal(svgProblem(bad), what, bad);
  const clean = await cleanImage(Buffer.from(safe));
  assert.deepEqual([clean.mime, clean.w, clean.h], ["image/svg+xml", 40, 20]);
  await assert.rejects(cleanImage(Buffer.from(`<svg onload="x()"/>`)), (e) => e.code === "DS_ASSET_TYPE" && e.details.reason === "SVG_UNSAFE");
  await assert.rejects(cleanImage(Buffer.from("not an image")), (e) => e.code === "DS_ASSET_TYPE");
  await assert.rejects(cleanImage(Buffer.alloc(C.ASSET_MAX_BYTES + 1)), (e) => e.code === "DS_ASSET_TOO_LARGE");
  const jpeg = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#336699" } }).withMetadata({ exif: { IFD0: { Copyright: "secret-camera-owner" } }, orientation: 6 }).jpeg().toBuffer();
  assert.ok(jpeg.includes(Buffer.from("secret-camera-owner")), "the fixture carries EXIF");
  const out = await cleanImage(jpeg);
  assert.equal(out.mime, "image/jpeg");
  assert.ok(!out.bytes.includes(Buffer.from("secret-camera-owner")), "EXIF stripped");
  assert.deepEqual([out.w, out.h], [20, 30], "orientation applied");
  const meta = await sharp(out.bytes).metadata();
  assert.equal(meta.exif, undefined);
  await assert.rejects(cleanImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("garbage")])), (e) => e.code === "DS_ASSET_TYPE");
});

test("GHG templates render in all three looks (snapshot), with data marks and no placeholders left", () => {
  const actual = {};
  for (const t of seeds.templates.filter((x) => x.kind === "ghg")) {
    const doc = instantiateTemplate(t.doc, { company: "Seed Company Ltd", year: 2025, yearType: "CY" });
    const r = R.renderDocument(doc, R.emptyData(), { mode: "sheet" });
    assert.ok(!r.html.includes("{{"), t.slug);
    assert.ok(r.html.includes('data-source="ghg"'), `${t.slug} carries data marks`);
    assert.ok(r.html.includes("Seed Company Ltd"), t.slug);
    assert.equal(r.pageIds.length, doc.pages.length);
    actual[t.slug] = { sha256: sha(r.html + "\n" + r.css), bytes: r.html.length + r.css.length, pages: r.pageIds.length };
  }
  if (process.env.UPDATE_SNAPSHOT === "1" || !fs.existsSync(SNAPSHOT)) {
    fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
    fs.writeFileSync(SNAPSHOT, JSON.stringify({ renderHash: R.RENDER_HASH, templates: actual }, null, 1) + "\n");
  }
  const expected = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  assert.deepEqual(actual, expected.templates, "a GHG template's HTML changed: if intended, UPDATE_SNAPSHOT=1");
});
