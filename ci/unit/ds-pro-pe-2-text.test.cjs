// PE-2 · text effects, uploaded fonts (pure parts): font byte checks (magic bytes and
// structure), the effect → CSS mapping, @font-face output (family is ours, URLs are
// checked), per-box font fallback, data chips kept in every effect (curve included),
// and an unchanged render for boxes without effects. Needs dist/ (npm run build).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const R = require(path.join(ROOT, "dist/reporting/studio/render/index.js"));
const FX = require(path.join(ROOT, "dist/reporting/studio/render/textEffects.js"));
const S = require(path.join(ROOT, "dist/studio/fonts/service.js"));
const C = require(path.join(ROOT, "dist/studio/contracts/index.js"));
const F = require(path.join(ROOT, "ci/golden/ds/render/fixture.cjs"));

const sfnt = (magic = [0, 1, 0, 0]) => {
  const b = Buffer.alloc(32);
  Buffer.from(magic).copy(b, 0);
  b.writeUInt16BE(1, 4);
  b.write("head", 12, "latin1");
  b.writeUInt32BE(28, 20);
  b.writeUInt32BE(4, 24);
  return b;
};
const code = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return null;
};

test("font bytes: the magic bytes decide the format; broken tables and other files are refused", () => {
  const woff2 = fs.readFileSync(require.resolve("@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-400-normal.woff2", { paths: [ROOT] }));
  assert.equal(S.checkFont(woff2), "woff2");
  assert.equal(S.checkFont(sfnt()), "ttf");
  assert.equal(S.checkFont(sfnt([0x74, 0x72, 0x75, 0x65])), "ttf");
  assert.equal(S.checkFont(sfnt([0x4f, 0x54, 0x54, 0x4f])), "otf");
  assert.equal(code(() => S.checkFont(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"))), "DS_FONT_TYPE");
  assert.equal(code(() => S.checkFont(Buffer.from("wOFF" + "\0".repeat(60)))), "DS_FONT_TYPE", "WOFF 1 isn't accepted");
  assert.equal(code(() => S.checkFont(Buffer.from("<svg></svg>      "))), "DS_FONT_TYPE");
  const past = sfnt();
  past.writeUInt32BE(64, 24);
  assert.equal(code(() => S.checkFont(past)), "DS_FONT_TYPE");
  const noTables = sfnt();
  noTables.writeUInt16BE(0, 4);
  assert.equal(code(() => S.checkFont(noTables)), "DS_FONT_TYPE");
  const woffLen = Buffer.from(woff2);
  woffLen.writeUInt32BE(woff2.length + 1, 8);
  assert.equal(code(() => S.checkFont(woffLen)), "DS_FONT_TYPE");
  assert.equal(code(() => S.checkFont(Buffer.alloc(C.FONT_MAX_BYTES + 1))), "DS_FONT_TOO_LARGE");
});

test("upload fields: family names can't carry CSS; weights are 100..900; licence comes as 'true'", () => {
  const ok = C.FontUploadFieldsSchema.safeParse({ family: " Midal Sans ", weight: "700", licenceConfirmed: "true" });
  assert.ok(ok.success);
  assert.equal(ok.data.family, "Midal Sans");
  assert.equal(ok.data.weight, 700);
  assert.equal(ok.data.style, "normal");
  assert.equal(ok.data.licenceConfirmed, true);
  for (const family of ['a"b', "a;b", "a{b}", "a<b>", "a\\b", ""]) assert.equal(C.FontUploadFieldsSchema.safeParse({ family, licenceConfirmed: "true" }).success, false, family);
  assert.equal(C.FontUploadFieldsSchema.safeParse({ family: "X", weight: 450 }).success, false);
  assert.equal(C.FontUploadFieldsSchema.safeParse({ family: "X", licenceConfirmed: "yes" }).data.licenceConfirmed, false);
});

test("effects → CSS: the slider mapping is fixed (mm, so print matches the editor)", () => {
  const sh = FX.textEffectStyle({ shadow: { blur: 50, offsetX: -100, offsetY: 100, colour: "#102030", opacity: 25 } });
  assert.equal(sh.style, "text-shadow:-3mm 3mm 2mm rgba(16,32,48,0.25);");
  assert.deepEqual(sh.names, ["shadow"]);
  const lift = FX.textEffectStyle({ lift: { intensity: 100 } });
  assert.equal(lift.style, "text-shadow:0mm 1mm 3.6mm rgba(15,23,42,0.47);");
  const ol = FX.textEffectStyle({ outline: { width: 100, colour: "#ffffff" } });
  assert.match(ol.style, /^-webkit-text-stroke:1\.2mm #ffffff;paint-order:stroke fill;--ds-ol-fb:0\.6mm 0mm 0 #ffffff,/);
  assert.equal(ol.cls, " ds-fx-outline");
  assert.equal(FX.textEffectStyle({ outline: { width: 0, colour: "#ffffff" } }).style, "", "width 0 draws no outline");
  const hl = FX.textEffectStyle({ highlight: { colour: "#5EEAD4", radius: 100 } });
  assert.equal(hl.wrap, '<span class="ds-hl" style="background:#5EEAD4;border-radius:0.5em;">');
  assert.equal(hl.style, "");
  // Out-of-range or non-hex values never reach CSS.
  assert.equal(FX.textEffectStyle({ shadow: { blur: 9e9, offsetX: 0, offsetY: 0, colour: "red;}", opacity: 50 } }).style, "");
  assert.equal(FX.textEffectStyle({ highlight: { colour: "url(x)", radius: 0 } }).wrap, undefined);
  assert.equal(FX.textEffectStyle(undefined).style, "");
});

test("fonts: our family name, checked URLs, deleted fonts fall back, bundled ids use their stack", () => {
  assert.equal(FX.customFontFamily("custom:12"), "DS Brand 12");
  assert.equal(FX.customFontFamily("custom:0"), null);
  assert.equal(FX.customFontFamily('custom:1"'), null);
  const css = FX.customFontFaceCss([
    { ref: "custom:3", family: 'Evil"}', files: [{ weight: 700, style: "italic", format: "otf", url: "data:font/otf;base64,T1RUTw==" }, { weight: 400, style: "normal", format: "ttf", url: 'x") ; @import "y' }] },
  ]);
  assert.equal(css, '@font-face{font-family:"DS Brand 3";font-style:italic;font-weight:700;font-display:block;src:url("data:font/otf;base64,T1RUTw==") format("opentype");}');
  assert.ok(!css.includes("Evil"));
  const ctx = { customFonts: { "custom:3": { ref: "custom:3", family: "x", files: [] } } };
  assert.equal(FX.fontOverride("custom:3", ctx), '"DS Brand 3", "Noto Sans", sans-serif');
  assert.equal(FX.fontOverride("custom:4", ctx), "", "a font the render wasn't given falls back to the style's font");
  assert.equal(FX.fontOverride("ibm-plex-serif", ctx), R.fontStack("ibm-plex-serif"));
  assert.equal(FX.fontOverride(undefined, ctx), "");
  const doc = { pages: [{ kind: "freeform", elements: [{ type: "text", props: { font: "custom:9" } }, { type: "text", props: { font: "custom:2" } }, { type: "text", props: { font: "archivo" } }, { type: "shape", props: {} }] }, { kind: "flow" }] };
  assert.deepEqual(FX.customFontRefs(doc), ["custom:2", "custom:9"]);
});

const page = (props) => {
  const base = F.fixtureDoc("a4");
  const chip = base.pages.flatMap((p) => p.elements ?? []).find((e) => e.type === "text" && e.props.doc.content[0]?.content?.some((n) => n.type === "data"));
  const token = chip.props.doc.content[0].content.find((n) => n.type === "data");
  const el = { id: "t", type: "text", frame: { x: 10, y: 10, w: 100, h: 20, rotation: 0 }, z: 1, source: "user", props: { style: "heading", align: "left", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Total " }, token] }] }, ...props } };
  return { ...base, pages: [{ ...base.pages[0], elements: [el] }] };
};
const render = (doc, opts = {}) => R.renderDocument(doc, F.fixtureData(R.renderData), { mode: "sheet", assets: F.assets, ...opts }).html;

test("data chips keep their resolved display under every effect, curve included; nothing is retyped", () => {
  const plain = render(page({}));
  const display = /<span class="ds-chip"[^>]*>([^<]+)<\/span>/.exec(plain)[1];
  for (const effects of [{ shadow: { blur: 10, offsetX: 5, offsetY: 5, colour: "#000000", opacity: 50 } }, { lift: { intensity: 40 } }, { outline: { width: 30, colour: "#000000" } }, { highlight: { colour: "#FDE68A", radius: 20 } }, { curve: { radius: 50 } }, { curve: { radius: -50 }, outline: { width: 10, colour: "#000000" } }]) {
    const html = render(page({ effects }));
    assert.ok(html.includes(`>${display}</`), JSON.stringify(effects));
    assert.ok(html.includes('data-source="ghg"'), "the chip keeps its data marks");
  }
  const curve = render(page({ effects: { curve: { radius: 50 } } }));
  assert.match(curve, /<textPath href="#ds-curve-t" startOffset="0%" text-anchor="start">Total <tspan class="ds-chip"/);
  assert.match(curve, /d="M 0 [0-9.]+ A [0-9.]+ [0-9.]+ 0 0 1 377\.953 [0-9.]+"/, "an upward arc across the frame width (100 mm = 377.953 px)");
  assert.match(render(page({ effects: { curve: { radius: -50 } } })), / 0 0 0 377\.953 /, "a downward arc");
  assert.ok(!render(page({ effects: { curve: { radius: 0 } } })).includes("<svg"), "radius 0 is straight text");
});

test("a text box without effects or font renders exactly as before PE-2", () => {
  const html = render(page({}));
  assert.ok(/<div class="ds-text ts-heading" style="text-align:left;justify-content:flex-start;"><div class="ds-text-in"><p>Total <span class="ds-chip"/.test(html));
  assert.ok(!html.includes("data-effects") && !html.includes("data-font"));
});

test("contracts: shadow and lift exclude each other; effect values are slider integers", () => {
  assert.equal(C.TextEffectsSchema.safeParse({ shadow: { blur: 1, offsetX: 0, offsetY: 0, colour: "#000000", opacity: 50 }, lift: { intensity: 1 } }).success, false);
  assert.equal(C.TextEffectsSchema.safeParse({ outline: { width: 101, colour: "#000000" } }).success, false);
  assert.equal(C.TextEffectsSchema.safeParse({ curve: { radius: -100 } }).success, true);
});
