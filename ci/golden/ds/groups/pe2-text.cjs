// PE-2 golden group "pe2-text": text effects and uploaded brand fonts through the one renderer
// (docs/design-studio/pro/PE-2.md). One case per effect (pe2-text/effect/<effect>): a text box
// with that effect (and a data chip, which keeps its resolved display) on an A4 sheet. The golden
// keeps the element's HTML as rendered, its sha256, and the @font-face for the custom-font case.
// The handler also proves "identical everywhere": the element HTML is byte-equal in sheet
// (editor), paged (Page view, PNG, proof PDF) and print (print PDF) modes, so a mismatch throws.
const crypto = require("crypto");
const path = require("path");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

const FONT = { ref: "custom:7", family: "Midal Sans", files: [{ weight: 400, style: "normal", format: "woff2", url: "data:font/woff2;base64,d09GMgABAAA=" }, { weight: 700, style: "normal", format: "ttf", url: "data:font/ttf;base64,AAEAAA==" }] };

const EFFECTS = {
  shadow: { effects: { shadow: { blur: 30, offsetX: 20, offsetY: 40, colour: "#0F172A", opacity: 35 } } },
  lift: { effects: { lift: { intensity: 50 } } },
  outline: { effects: { outline: { width: 50, colour: "#1E5D9D" } } },
  highlight: { effects: { highlight: { colour: "#5EEAD4", radius: 40 } } },
  "curve-up": { effects: { curve: { radius: 60 } }, align: "center" },
  "curve-down": { effects: { curve: { radius: -45 } }, align: "left" },
  "custom-font": { font: "custom:7" },
  "custom-font-deleted": { font: "custom:8" },
  "bundled-font": { font: "ibm-plex-serif" },
  combined: { effects: { outline: { width: 20, colour: "#FFFFFF" }, shadow: { blur: 10, offsetX: 0, offsetY: 10, colour: "#000000", opacity: 50 }, highlight: { colour: "#FDE68A", radius: 0 } }, font: "custom:7" },
  "curve-outline-shadow": { effects: { curve: { radius: 100 }, outline: { width: 30, colour: "#0F5132" }, lift: { intensity: 80 } }, align: "right" },
};

module.exports = async function pe2Text(ctx, kase) {
  const R = require(path.join(ctx.root, "dist/reporting/studio/render/index.js"));
  const F = require(path.join(ctx.root, "ci/golden/ds/render/fixture.cjs"));
  const { effect } = kase.params;
  const spec = EFFECTS[effect];
  if (!spec) throw new Error(`unknown effect ${effect}`);
  const base = F.fixtureDoc("a4");
  const page = base.pages.find((p) => p.kind === "freeform");
  const chip = base.pages.flatMap((p) => p.elements ?? []).find((e) => e.type === "text" && e.props.doc.content[0]?.content?.some((n) => n.type === "data"));
  const token = JSON.parse(JSON.stringify(chip.props.doc.content[0].content.find((n) => n.type === "data")));
  const el = {
    id: `pe2.${effect}`,
    type: "text",
    frame: { x: 20, y: 40, w: 170, h: 30, rotation: 0 },
    z: 1,
    source: "user",
    props: {
      style: "title",
      align: spec.align ?? "left",
      ...(spec.effects ? { effects: spec.effects } : {}),
      ...(spec.font ? { font: spec.font } : {}),
      doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Net zero by 2040: " }, { type: "text", text: "Scope 1", marks: [{ type: "bold" }] }, { type: "text", text: " " }, token] }] },
    },
  };
  const doc = { ...base, pages: [{ ...page, id: "p-pe2", name: "PE-2", elements: [el] }] };
  const frag = (mode) => {
    const r = R.renderDocument(doc, F.fixtureData(R.renderData), { mode, assets: F.assets, customFonts: [FONT] });
    const at = r.html.indexOf(`data-el-id="${el.id}"`);
    const start = r.html.lastIndexOf("<div", at);
    const end = r.html.indexOf("</section>", at);
    return { html: r.html.slice(start, end), css: r.css };
  };
  const sheet = frag("sheet");
  for (const mode of ["paged", "print", "present"]) if (frag(mode).html !== sheet.html) throw new Error(`${effect}: the ${mode} HTML differs from the editor sheet`);
  const editor = R.renderSheet(doc.pages[0], doc, F.fixtureData(R.renderData), { mode: "sheet", assets: F.assets, customFonts: [FONT] }).html;
  if (!editor.includes(sheet.html)) throw new Error(`${effect}: renderSheet (editor) differs from renderDocument`);
  return {
    effect,
    props: { effects: spec.effects ?? null, font: spec.font ?? null, align: el.props.align },
    html: sheet.html,
    sha256: sha(sheet.html),
    ...(spec.font && spec.font.startsWith("custom:") ? { fontFace: R.customFontFaceCss([FONT]) } : {}),
    outlineFallbackCss: /@supports not \(-webkit-text-stroke:1px\)\{[^}]+\}\}/.exec(sheet.css)?.[0] ?? null,
  };
};
