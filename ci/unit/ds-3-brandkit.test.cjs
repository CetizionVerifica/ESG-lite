// DS-3 brand kit and styles, pure parts: the contrast port matches the FE
// theme engine (src/theme/color.ts), the palette contrast report, and the
// style presets (6–12, deterministic, brand first, the body-text contrast
// filter, valid StylePresets). Runs against the build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const c = require(path.resolve("dist/studio/brandkit/contrast.js"));
const s = require(path.resolve("dist/studio/brandkit/styles.js"));
const { StylePresetSchema, BrandKitUpdateSchema } = require(path.resolve("dist/studio/contracts/index.js"));

const kit = (over = {}) => ({
  name: "Northwind",
  colors: { primary: "#1f2a44", accent: "#3b82f6", coverFrom: "#0d1526", coverTo: "#1f2a44" },
  fonts: { heading: null, body: null },
  palettes: [],
  ...over,
});

test("contrast port: WCAG ratios as the FE color.ts", () => {
  assert.equal(c.contrast("#ffffff", "#000000"), 21);
  assert.equal(c.contrast("#000", "#fff"), 21);
  assert.equal(c.contrast("#777777", "#777777"), 1);
  assert.equal(Math.round(c.contrast("#767676", "#ffffff") * 100) / 100, 4.54);
  assert.equal(c.normalizeHex("#ABC"), "#aabbcc");
  assert.throws(() => c.parseHex("teal"));
  assert.equal(c.mix("#000000", "#ffffff", 0.5), "#808080");
  // ensureContrast walks toward black until AA text passes on white.
  const fixed = c.ensureContrast("#f59e0b", ["#ffffff"], 4.5, "darken");
  assert.ok(c.contrast(fixed, "#ffffff") >= 4.5);
  assert.notEqual(fixed, "#000000");
});

test("palette contrast report: every pair once, with text and graphic verdicts", () => {
  const r = c.paletteContrast(["#0F5132", "#F59E0B", "#FFFFFF"]);
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((p) => [p.a, p.b]), [["#0f5132", "#f59e0b"], ["#0f5132", "#ffffff"], ["#f59e0b", "#ffffff"]]);
  const greenWhite = r[1];
  assert.ok(greenWhite.ratio > 9 && greenWhite.text && greenWhite.graphic);
  const amberWhite = r[2];
  assert.equal(amberWhite.text, false);
  assert.equal(amberWhite.graphic, false); // 2.15:1
  assert.equal(c.paletteContrast(["#000000"]).length, 0);
  assert.equal(c.paletteContrast(Array.from({ length: 10 }, (_, i) => `#0${i}0000`)).length, 45);
});

test("styles: 6–12 valid presets, deterministic, brand palette first with the brand fonts", () => {
  for (const kind of ["ghg", "sustainability"]) {
    for (const k of [kit(), kit({ fonts: { heading: "fraunces", body: "ibm-plex-sans" }, palettes: [{ name: "Primary", colors: ["#0F5132", "#F59E0B", "#111827", "#FFFFFF"] }] })]) {
      const list = s.buildStyles(k, kind);
      assert.ok(list.length >= 6 && list.length <= 12, `${kind}: ${list.length}`);
      for (const p of list) assert.ok(StylePresetSchema.safeParse(p).success, JSON.stringify(p));
      assert.equal(new Set(list.map((p) => p.id)).size, list.length, "unique ids");
      assert.deepEqual(s.buildStyles(k, kind), list, "same kit → same list");
      for (const p of list) assert.ok(s.bodyContrastOk(p), p.id);
    }
  }
  const withPalette = s.buildStyles(kit({ fonts: { heading: "fraunces", body: "ibm-plex-sans" }, palettes: [{ name: "Primary", colors: ["#0F5132", "#F59E0B", "#111827", "#FFFFFF"] }] }), "ghg");
  assert.equal(withPalette[0].id, "brand");
  assert.deepEqual(withPalette[0].palette, ["#0f5132", "#f59e0b", "#111827", "#ffffff", "#5f6b7c"]);
  assert.deepEqual(withPalette[0].fonts, { heading: "fraunces", body: "ibm-plex-sans" });
  // 2–3 alternative OFL pairs on the same palette, none equal to the brand pair.
  const alts = withPalette.filter((p) => p.id.startsWith("brand-alt-"));
  assert.ok(alts.length >= 2 && alts.length <= 3);
  for (const a of alts) {
    assert.deepEqual(a.palette, withPalette[0].palette);
    assert.notDeepEqual(a.fonts, withPalette[0].fonts);
  }
  // The three looks.
  for (const id of ["look-classic", "look-light", "look-night"]) assert.ok(withPalette.some((p) => p.id === id), id);
  const night = withPalette.find((p) => p.id === "look-night");
  assert.ok(c.luminance(night.palette[3]) < 0.05, "night surface is dark");
  assert.ok(c.contrast(night.palette[0], night.palette[3]) >= 3, "night primary lifted to 3:1");
  // Without palettes or fonts: the brand colours and the default pair.
  const plain = s.buildStyles(kit(), "ghg");
  assert.deepEqual(plain[0].fonts, { heading: "source-serif-4", body: "source-sans-3" });
  assert.equal(plain[0].palette[0], "#1f2a44");
});

test("styles: the body-text contrast filter drops unreadable presets", () => {
  const bad = { id: "x", name: "x", palette: ["#000000", "#000000", "#bbbbbb", "#ffffff", "#999999"], fonts: { heading: "fraunces", body: "noto-sans" } };
  assert.equal(s.bodyContrastOk(bad), false);
  assert.equal(s.bodyContrastOk({ ...bad, palette: ["#000000", "#000000", "#16202e", "#ffffff", "#999999"] }), true);
  // A palette whose own colours can't carry text falls back to the classic ink and surface.
  const roles = s.paletteRoles(["#f59e0b", "#fde68a"], "#3b82f6");
  assert.equal(roles[2], "#16202e");
  assert.equal(roles[3], "#ffffff");
  assert.ok(c.contrast(roles[4], roles[3]) >= 4.5, "muted readable");
  // A night look on a light cover colour still gets a dark surface.
  const night = s.lookPalettes({ primary: "#1f2a44", accent: "#3b82f6", coverFrom: "#f0f0f0", coverTo: "#ffffff" }).night;
  assert.equal(night[3], "#0d1526");
});

test("PUT body schema: fonts from the R12 set, voice ≤ 3,000, ≤ 10 hex colours per palette", () => {
  const ok = (b) => BrandKitUpdateSchema.safeParse(b).success;
  assert.ok(ok({ fonts: { heading: "fraunces", body: null }, voice: "Plain.", palettes: [{ name: "Primary", colors: ["#0F5132"] }] }));
  assert.ok(ok({}));
  assert.equal(ok({ fonts: { heading: "comic-sans", body: null } }), false);
  assert.equal(ok({ voice: "x".repeat(3001) }), false);
  assert.equal(ok({ palettes: [{ name: "P", colors: Array(11).fill("#000000") }] }), false);
  assert.equal(ok({ palettes: [{ name: "P", colors: ["red"] }] }), false);
  assert.equal(ok({ palettes: [{ name: " ", colors: ["#000000"] }] }), false);
  assert.equal(ok({ logos: { primary: "x" } }), false, "logos aren't writable here");
});
