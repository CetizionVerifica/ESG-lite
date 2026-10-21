// PE-1 · photo edits in the shared renderer (docs/design-studio/pro/PE-1.md):
//  - pure: the slider → CSS filter mapping, the presets, clamping, the SVG filter for warmth and
//    duotone, and that an image without edits renders byte for byte as before PE-1;
//  - Chromium (skipped where it can't launch, as in GitHub CI): the same doc drawn three ways —
//    the editor's shadow-root sheet, the paged PNG and the screen PDF (rasterised with pdf.js) —
//    gives the same pixel colours for duotone, brightness, a preset, warmth and transparency.
//   npm run build && node --test ci/unit/ds-pro-pe-1-photo.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const R = require(path.resolve("dist/reporting/studio/render/index.js"));
const H = require(path.resolve("dist/reporting/studio/html.js"));
const P = require(path.resolve("dist/reporting/studio/print.js"));
const sharp = require("sharp");

test("mapping: sliders and presets → CSS filter functions (preset first, then the sliders)", () => {
  assert.equal(R.imageFilterCss({}), "");
  assert.equal(R.imageFilterCss({ filter: "none", adjust: { brightness: 0, contrast: 0 } }), "");
  assert.equal(R.imageFilterCss({ adjust: { brightness: 12 } }), "brightness(1.06)");
  assert.equal(R.imageFilterCss({ adjust: { brightness: -100 } }), "brightness(0.5)");
  assert.equal(R.imageFilterCss({ adjust: { brightness: 100 } }), "brightness(1.5)");
  assert.equal(R.imageFilterCss({ adjust: { contrast: 8 } }), "contrast(1.04)");
  assert.equal(R.imageFilterCss({ adjust: { saturation: -100 } }), "saturate(0)");
  assert.equal(R.imageFilterCss({ adjust: { saturation: 100 } }), "saturate(2)");
  assert.equal(R.imageFilterCss({ adjust: { blur: 100 } }), "blur(3mm)");
  assert.equal(R.imageFilterCss({ filter: "mono", adjust: { brightness: 10 } }), "grayscale(1) contrast(1.1) brightness(1.05)");
  for (const [name, css] of Object.entries(R.IMAGE_FILTER_CSS)) assert.equal(R.imageFilterCss({ filter: name }), css, name);
  assert.deepEqual(Object.keys(R.IMAGE_FILTER_CSS).sort(), ["cool", "fade", "mono", "vivid", "warm"]);
  // Out of range and junk are clamped / ignored, never passed into the style attribute.
  assert.equal(R.imageFilterCss({ adjust: { brightness: 900, blur: -5 } }), "brightness(1.5)");
  assert.equal(R.imageFilterCss({ adjust: { brightness: "1);x:y" } }), "");
  assert.equal(R.imageFilterCss({ filter: "evil" }), "");
  // Warmth is not a CSS function: it lives in the SVG layer.
  assert.equal(R.imageFilterCss({ adjust: { warmth: 50 } }), "");
});

test("SVG layer: only for warmth or duotone; the tables hold the two colours", () => {
  assert.equal(R.needsSvgFilter({}), false);
  assert.equal(R.needsSvgFilter({ duotone: null }), false);
  assert.equal(R.needsSvgFilter({ duotone: { dark: "red", light: "#ffffff" } }), false, "only hex colours");
  assert.equal(R.needsSvgFilter({ adjust: { warmth: 1 } }), true);
  assert.equal(R.needsSvgFilter({ duotone: { dark: "#000000", light: "#ffffff" } }), true);
  const f = R.imageSvgFilter("ds-fx-x", { duotone: { dark: "#000000", light: "#ff8000" } });
  assert.match(f, /^<filter id="ds-fx-x" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">/);
  assert.match(f, /<feFuncR type="table" tableValues="0 1"\/><feFuncG type="table" tableValues="0 0.502"\/><feFuncB type="table" tableValues="0 0"\/>/);
  const w = R.imageSvgFilter("w", { adjust: { warmth: 100 } });
  assert.match(w, /values="1.15 0 0 0 0 0 1 0 0 0 0 0 0.85 0 0 0 0 0 1 0"/);
  assert.equal(R.imageSvgFilter("n", { adjust: { warmth: 0 } }), "");
  assert.notEqual(R.imageFilterId("a.b"), R.imageFilterId("a_b"), "ids that sanitise alike still differ");
  assert.match(R.imageFilterId('x"><script>'), /^ds-fx-[A-Za-z0-9_-]+$/);
});

// ---------------------------------------------------------------------------
// Chromium: editor sheet = PNG = PDF
// ---------------------------------------------------------------------------
const { chromium } = require("playwright");
let browser = null;
let why = "";
test.before(async () => {
  try {
    browser = await chromium.launch();
  } catch (err) {
    why = `Chromium is not installed (${String(err.message).split("\n")[0]})`;
  }
});
test.after(async () => {
  if (browser) await browser.close();
});
const btest = (name, fn) =>
  test(name, async (t) => {
    if (!browser) return t.skip(why);
    await fn(t);
  });

const solid = async (hex) => `data:image/png;base64,${(await sharp({ create: { width: 40, height: 40, channels: 3, background: hex } }).png().toBuffer()).toString("base64")}`;
const DUO = { dark: "#0b223a", light: "#2572c0" };
// [id, asset colour, props, opacity, expected colour (r, g, b) or null to compare surfaces only]
const CASES = [
  ["duo-white", "#ffffff", { duotone: DUO }, undefined, [0x25, 0x72, 0xc0]],
  ["duo-black", "#000000", { duotone: DUO }, undefined, [0x0b, 0x22, 0x3a]],
  ["dark-white", "#ffffff", { adjust: { brightness: -100 } }, undefined, [128, 128, 128]],
  ["mono-red", "#ff0000", { filter: "mono" }, undefined, null],
  ["warm-grey", "#808080", { adjust: { warmth: 100 } }, undefined, [147, 128, 109]],
  ["half-black", "#000000", {}, 0.5, [128, 128, 128]],
  ["plain-red", "#ff0000", {}, undefined, [255, 0, 0]],
];

async function photoDoc() {
  const urls = {};
  const elements = [];
  let i = 0;
  for (const [id, colour, props, opacity] of CASES) {
    urls[`a-${id}`] = await solid(colour);
    const x = 10 + (i % 4) * 48;
    const y = 10 + Math.floor(i / 4) * 48;
    elements.push({ id, type: "image", frame: { x, y, w: 40, h: 40, rotation: 0 }, z: i + 1, source: "user", ...(opacity !== undefined ? { opacity } : {}), props: { assetId: `a-${id}`, fit: "cover", alt: id, ...props } });
    i++;
  }
  const doc = {
    version: 2,
    kind: "ghg",
    format: "a4",
    meta: { title: "PE-1 photo edits", year: 2025, yearType: "CY", sites: "all", frameworks: ["GHGP"], language: "en" },
    design: { templateId: "t", templateVersion: 1, theme: { look: "light" } },
    pages: [{ id: "p1", kind: "freeform", name: "Photos", background: { color: "#ffffff" }, elements }],
    assets: [],
    inputs: {},
  };
  return { doc, assets: { urls } };
}

/** Centre of an element in CSS px from the page's top left. */
const centre = (doc, id) => {
  const e = doc.pages[0].elements.find((x) => x.id === id);
  const px = (mm) => (mm * 96) / 25.4;
  return [px(e.frame.x + e.frame.w / 2), px(e.frame.y + e.frame.h / 2)];
};

async function pixelsOf(pngBuffer, points, scale) {
  const { data, info } = await sharp(pngBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return points.map(([x, y]) => {
    const i = (Math.round(y * scale) * info.width + Math.round(x * scale)) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  });
}

const near = (a, b, tol, what) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) <= tol), `${what}: ${JSON.stringify(a)} vs ${JSON.stringify(b)} (±${tol})`);

btest("editor sheet, paged PNG and screen PDF draw every photo edit with the same colours", async () => {
  const { doc, assets } = await photoDoc();
  const points = CASES.map(([id]) => centre(doc, id));

  // 1. The editor: renderSheet into an open shadow root (as FE renderHost.mountSheet).
  const sheet = R.renderSheet(doc.pages[0], doc, null, { mode: "sheet", assets });
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff"><div id="host"></div></body></html>`);
  await page.evaluate(({ css, html }) => {
    const root = document.getElementById("host").attachShadow({ mode: "open" });
    root.innerHTML = `<style>:host{display:block;}${css}</style>${html}`;
  }, sheet);
  await page.waitForFunction(() => [...document.getElementById("host").shadowRoot.querySelectorAll("img")].every((i) => i.complete));
  const box = await page.evaluate(() => {
    const r = document.getElementById("host").shadowRoot.querySelector(".ds-sheet").getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  const editorPng = await page.screenshot({ type: "png", fullPage: true });
  await page.close();
  const editor = await pixelsOf(editorPng, points.map(([x, y]) => [x + box.x, y + box.y]), 1);

  // 2. The paged PNG (Page view / PNG download path).
  const [png] = await P.renderPng(doc, null, [1], 1, { browser, assets });
  const paged = await pixelsOf(png.png, points, 1);

  // 3. The screen PDF, rasterised in Chromium with pdf.js at 96 dpi.
  const { pdf } = await P.renderPdf(doc, null, "screen", { browser, assets });
  const pdfPage = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
  await pdfPage.setContent("<!doctype html><html><body></body></html>");
  const lib = fs.readFileSync(require.resolve("pdfjs-dist/build/pdf.min.mjs"), "utf8");
  const worker = fs.readFileSync(require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"), "utf8");
  const pdfPng = await pdfPage.evaluate(
    async ({ lib, worker, b64 }) => {
      const libUrl = URL.createObjectURL(new Blob([lib], { type: "text/javascript" }));
      const pdfjs = await import(libUrl);
      pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([worker], { type: "text/javascript" }));
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const docu = await pdfjs.getDocument({ data: bytes }).promise;
      const p1 = await docu.getPage(1);
      const vp = p1.getViewport({ scale: 96 / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await p1.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { lib, worker, b64: pdf.toString("base64") },
  );
  await pdfPage.close();
  const printed = await pixelsOf(Buffer.from(pdfPng, "base64"), points, 1);

  CASES.forEach(([id, , , , want], i) => {
    if (want) near(editor[i], want, 4, `${id} in the editor`);
    near(paged[i], editor[i], 3, `${id}: PNG vs editor`);
    near(printed[i], editor[i], 6, `${id}: PDF vs editor`);
  });
  // mono really is grey (all channels equal), and differs from the plain red one.
  const mono = editor[CASES.findIndex((c) => c[0] === "mono-red")];
  assert.ok(Math.abs(mono[0] - mono[1]) <= 2 && Math.abs(mono[1] - mono[2]) <= 2, `mono: ${mono}`);
});
